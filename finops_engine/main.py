import os
import json
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional
from databases import Database
import redis.asyncio as aioredis
import httpx
from fastapi import FastAPI
import uvicorn

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "finops_engine", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
ALERT_SERVICE_URL = os.getenv("ALERT_SERVICE_URL", "http://alert_service:8003")
STREAM_KEY = "cloud_logs"
CONSUMER_GROUP = "finops_group"
CONSUMER_NAME = "finops_engine_1"


# ─── FinOps Detection Rules ───────────────────────────────────

def detect_idle_resource(log: dict, metrics: dict) -> Optional[dict]:
    """Detect resources with CPU < 5% average over 7 days."""
    avg_cpu_7d = metrics.get("avg_cpu_7d", 100)
    if avg_cpu_7d < 5:
        estimated_savings = metrics.get("avg_cost_30d", 0) * 0.8  # 80% savings potential
        return {
            "waste_type": "idle_resource",
            "estimated_savings": round(estimated_savings, 2),
            "severity": "high" if estimated_savings > 500 else "medium",
            "details": {
                "avg_cpu_7d": round(avg_cpu_7d, 2),
                "threshold_cpu": 5,
                "avg_monthly_cost": round(metrics.get("avg_cost_30d", 0) * 30, 2),
            }
        }
    return None


def detect_overprovisioned(log: dict, metrics: dict) -> Optional[dict]:
    """Detect resources where allocated > 2x average usage."""
    cpu_usage = log.get("cpu_usage", 50)
    memory_usage = log.get("memory_usage", 50)
    avg_cpu = metrics.get("avg_cpu_30d", 50)

    if avg_cpu > 0 and cpu_usage > (avg_cpu * 2):
        estimated_savings = metrics.get("avg_cost_30d", 0) * 0.3  # 30% savings
        return {
            "waste_type": "overprovisioned",
            "estimated_savings": round(estimated_savings, 2),
            "severity": "medium",
            "details": {
                "current_cpu": round(cpu_usage, 2),
                "avg_cpu_30d": round(avg_cpu, 2),
                "ratio": round(cpu_usage / max(avg_cpu, 0.01), 2),
                "memory_usage": round(memory_usage, 2),
            }
        }
    return None


def detect_cost_spike(log: dict, metrics: dict) -> Optional[dict]:
    """Detect >20% cost increase month-over-month."""
    avg_cost_30d = metrics.get("avg_cost_30d", 0)
    avg_cost_prev_30d = metrics.get("avg_cost_prev_30d", avg_cost_30d)

    if avg_cost_prev_30d > 0:
        change_pct = ((avg_cost_30d - avg_cost_prev_30d) / avg_cost_prev_30d) * 100
        if change_pct > 20:
            estimated_savings = (avg_cost_30d - avg_cost_prev_30d) * 30
            return {
                "waste_type": "cost_spike",
                "estimated_savings": round(estimated_savings, 2),
                "severity": "critical" if change_pct > 50 else "high",
                "details": {
                    "current_avg_cost": round(avg_cost_30d, 4),
                    "prev_avg_cost": round(avg_cost_prev_30d, 4),
                    "increase_pct": round(change_pct, 1),
                    "forecast_30d": round(avg_cost_30d * 30, 2),
                }
            }
    return None


def calculate_forecast(metrics: dict) -> dict:
    """30-day moving average forecast."""
    avg_cost_30d = metrics.get("avg_cost_30d", 0)
    return {
        "forecast_30d_cost": round(avg_cost_30d * 30, 2),
        "forecast_90d_cost": round(avg_cost_30d * 90, 2),
        "avg_daily_cost": round(avg_cost_30d, 4),
    }


# ─── Database Helpers ─────────────────────────────────────────

async def get_or_create_resource(db: Database, resource_id: str, account_id: Optional[str] = None) -> Optional[str]:
    """Ensure resource exists, auto-create if missing."""
    row = await db.fetch_one("SELECT id FROM resources WHERE id = :id", {"id": resource_id})
    if row:
        return str(row["id"])
    # Auto-create a placeholder resource
    await db.execute("""
        INSERT INTO resources (id, cloud_provider, resource_type, region, aws_account_id)
        VALUES (:id, 'aws', 'ec2', 'us-east-1', :account_id)
        ON CONFLICT (id) DO NOTHING
    """, {"id": resource_id, "account_id": account_id})
    return resource_id


async def get_resource_metrics(db: Database, resource_id: str) -> dict:
    """Fetch cached metrics for a resource."""
    row = await db.fetch_one(
        "SELECT * FROM resource_metrics WHERE resource_id = :id",
        {"id": resource_id}
    )
    if row:
        return dict(row)
    # Compute on-the-fly from usage_logs
    now = datetime.utcnow()
    prev_30d_start = now - timedelta(days=60)
    curr_30d_start = now - timedelta(days=30)
    week_start = now - timedelta(days=7)

    metrics_row = await db.fetch_one("""
        SELECT
            AVG(CASE WHEN timestamp > :week_start THEN cpu_usage END) AS avg_cpu_7d,
            AVG(CASE WHEN timestamp > :curr_start THEN cpu_usage END) AS avg_cpu_30d,
            AVG(CASE WHEN timestamp > :curr_start THEN cost END) AS avg_cost_30d,
            AVG(CASE WHEN timestamp BETWEEN :prev_start AND :curr_start THEN cost END) AS avg_cost_prev_30d
        FROM usage_logs
        WHERE resource_id = :resource_id
    """, {
        "resource_id": resource_id,
        "week_start": week_start,
        "curr_start": curr_30d_start,
        "prev_start": prev_30d_start
    })

    result = dict(metrics_row) if metrics_row else {}
    # Cache the results
    await db.execute("""
        INSERT INTO resource_metrics (resource_id, avg_cpu_7d, avg_cpu_30d, avg_cost_30d, avg_cost_prev_30d, last_updated)
        VALUES (:resource_id, :avg_cpu_7d, :avg_cpu_30d, :avg_cost_30d, :avg_cost_prev_30d, NOW())
        ON CONFLICT (resource_id) DO UPDATE SET
            avg_cpu_7d = EXCLUDED.avg_cpu_7d,
            avg_cpu_30d = EXCLUDED.avg_cpu_30d,
            avg_cost_30d = EXCLUDED.avg_cost_30d,
            avg_cost_prev_30d = EXCLUDED.avg_cost_prev_30d,
            last_updated = NOW()
    """, {
        "resource_id": resource_id,
        "avg_cpu_7d": result.get("avg_cpu_7d") or 50,
        "avg_cpu_30d": result.get("avg_cpu_30d") or 50,
        "avg_cost_30d": result.get("avg_cost_30d") or 0,
        "avg_cost_prev_30d": result.get("avg_cost_prev_30d") or 0,
    })
    return result


async def store_log(db: Database, log: dict, resource_id: str):
    """Persist usage log to database."""
    ts = log.get("timestamp")
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts)
        except Exception:
            ts = datetime.utcnow()
    elif ts is None:
        ts = datetime.utcnow()

    await db.execute("""
        INSERT INTO usage_logs (resource_id, cpu_usage, memory_usage, cost, network_in_gb, network_out_gb, timestamp)
        VALUES (:resource_id, :cpu_usage, :memory_usage, :cost, :net_in, :net_out, :timestamp)
    """, {
        "resource_id": resource_id,
        "cpu_usage": log.get("cpu_usage", 0),
        "memory_usage": log.get("memory_usage", 0),
        "cost": log.get("cost", 0),
        "net_in": log.get("network_in_gb", 0),
        "net_out": log.get("network_out_gb", 0),
        "timestamp": ts,
    })


# ─── Alert Publisher ──────────────────────────────────────────

async def publish_alert(client: httpx.AsyncClient, resource_id: str, finding: dict):
    payload = {
        "type": "finops",
        "source_id": resource_id,
        "severity": finding["severity"],
        "message": f"[FinOps] {finding['waste_type'].replace('_', ' ').title()} detected on resource {resource_id}",
        "details": finding,
    }
    try:
        resp = await client.post(f"{ALERT_SERVICE_URL}/internal/alerts", json=payload, timeout=5)
        resp.raise_for_status()
        logger.info(f"Alert published: {finding['waste_type']} for {resource_id}")
    except Exception as e:
        logger.error(f"Failed to publish alert: {e}")


# ─── Main Consumer Loop ───────────────────────────────────────

async def process_log(db: Database, client: httpx.AsyncClient, log: dict):
    resource_id = log.get("resource_id")
    if not resource_id:
        return

    account_id = log.get("aws_account_id")
    await get_or_create_resource(db, resource_id, account_id)
    await store_log(db, log, resource_id)
    metrics = await get_resource_metrics(db, resource_id)

    detectors = [detect_idle_resource, detect_overprovisioned, detect_cost_spike]
    for detector in detectors:
        finding = detector(log, metrics)
        if finding:
            await publish_alert(client, resource_id, finding)


# ─── Health check server ──────────────────────────────────────
health_app = FastAPI()


@health_app.get("/health")
async def health():
    return {"status": "ok", "service": "finops_engine"}


async def run_health_server():
    config = uvicorn.Config(health_app, host="0.0.0.0", port=8001, log_level="error")
    server = uvicorn.Server(config)
    await server.serve()


async def main():
    logger.info("FinOps Engine starting...")
    # Start health check server in background
    asyncio.create_task(run_health_server())

    db = Database(DATABASE_URL)
    await db.connect()
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)

    # Create consumer group (ignore if already exists)
    try:
        await redis.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
    except Exception:
        pass

    async with httpx.AsyncClient() as client:
        logger.info(f"Listening to Redis Stream '{STREAM_KEY}'...")
        while True:
            try:
                messages = await redis.xreadgroup(
                    CONSUMER_GROUP, CONSUMER_NAME,
                    {STREAM_KEY: ">"},
                    count=10, block=2000
                )
                for stream, entries in messages:
                    for entry_id, fields in entries:
                        try:
                            log = json.loads(fields["data"])
                            await process_log(db, client, log)
                            await redis.xack(STREAM_KEY, CONSUMER_GROUP, entry_id)
                        except Exception as e:
                            logger.error(f"Error processing log {entry_id}: {e}")
            except Exception as e:
                logger.error(f"Stream error: {e}")
                await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main())
