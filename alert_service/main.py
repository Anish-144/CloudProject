import os
import json
import hashlib
import logging
import asyncio
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional, AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from databases import Database
import redis.asyncio as redis

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "alert_service", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

database = Database(DATABASE_URL)
redis_client = None

# ─── Priority Scoring ─────────────────────────────────────────
SEVERITY_SCORE = {"low": 1, "medium": 2, "high": 3, "critical": 4}
TYPE_IMPACT = {"finops": 2, "compliance": 3, "combined": 4}


def calculate_priority(severity: str, alert_type: str, created_at: datetime) -> float:
    """priority = severity × impact × recency"""
    sev = SEVERITY_SCORE.get(severity, 1)
    impact = TYPE_IMPACT.get(alert_type, 1)
    age_hours = (datetime.utcnow() - created_at).total_seconds() / 3600
    recency = max(0.1, 1.0 / (1.0 + age_hours * 0.1))  # Decays over time
    return round(sev * impact * recency, 4)


def build_dedupe_key(alert_type: str, source_id: str, message: str) -> str:
    raw = f"{alert_type}:{source_id}:{message[:80]}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


# ─── Role Routing Map ─────────────────────────────────────────
ALERT_ROLE_ROUTING = {
    "finops": ["finops_manager", "it_admin", "cloud_admin"],
    "compliance": ["compliance_manager", "it_admin", "cloud_admin"],
    "combined": ["finops_manager", "compliance_manager", "it_admin", "cloud_admin"],
}


async def subscribe_alerts():
    """Subscribe to Redis alerts_stream and store alerts."""
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("alerts_stream")
    logger.info("Subscribed to alerts_stream")
    
    while True:
        try:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message:
                data = json.loads(message["data"])
                payload = AlertPayload(**data)
                await receive_alert(payload)
            else:
                await asyncio.sleep(0.1)
        except Exception as e:
            logger.error(f"Error processing Redis message: {e}")
            await asyncio.sleep(1)


# ─── Models ───────────────────────────────────────────────────
class AlertPayload(BaseModel):
    severity: str
    type: str
    message: str
    resource_id: Optional[str] = None
    aws_resource_id: Optional[str] = None
    timestamp: Optional[str] = None
    details: Optional[dict] = {}
    iam_user: Optional[str] = None


# ─── App Lifespan ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    logger.info("Alert Service starting...")
    
    # Retry logic for database connection
    max_retries = 5
    retry_interval = 2
    for i in range(max_retries):
        try:
            await database.connect()
            logger.info("Database connected.")
            break
        except Exception as e:
            if i == max_retries - 1:
                logger.error(f"Failed to connect to database after {max_retries} attempts: {e}")
                raise
            logger.warning(f"Database connection attempt {i+1} failed ({e}). Retrying in {retry_interval}s...")
            await asyncio.sleep(retry_interval)
            
    redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    logger.info("Connected to DB and Redis.")
    
    # Start Redis subscriber in background
    asyncio.create_task(subscribe_alerts())
    
    yield
    await database.disconnect()
    if redis_client:
        await redis_client.close()

app = FastAPI(
    title="CloudGuard Alert Service",
    description="Centralized alert deduplication, priority scoring, and SSE streaming",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Internal Endpoint (called by engines) ────────────────────
@app.post("/internal/alerts")
async def receive_alert(payload: AlertPayload):
    """Receive alert from FinOps or Compliance engine, deduplicate, store, notify."""
    now = datetime.utcnow()
    if payload.timestamp:
        try:
            now = datetime.fromisoformat(payload.timestamp)
        except:
            pass
    dedupe_key = build_dedupe_key(payload.type.lower(), payload.resource_id or "", payload.message)

    # Check for existing active duplicate
    existing = await database.fetch_one(
        "SELECT id FROM alerts WHERE dedupe_key = :key AND status = 'active' AND created_at > NOW() - INTERVAL '24 hours'",
        {"key": dedupe_key}
    )
    if existing:
        logger.info(f"Deduplicated alert: {dedupe_key[:12]}...")
        return {"status": "deduplicated", "existing_id": str(existing["id"])}

    priority = calculate_priority(payload.severity.lower(), payload.type.lower(), now)

    # Auto-compute target_roles from alert type if not explicitly set
    target_roles = ALERT_ROLE_ROUTING.get(payload.type.lower(), ["cloud_admin"])

    alert_id = await database.execute("""
        INSERT INTO alerts (type, source_id, severity, message, details, status, priority, dedupe_key, target_roles, iam_user, created_at)
        VALUES (:type, :source_id, :severity, :message, :details, 'active', :priority, :dedupe_key, :target_roles, :iam_user, :created_at)
        RETURNING id
    """, {
        "type": payload.type.lower(),
        "source_id": payload.resource_id,
        "severity": payload.severity.lower(),
        "message": payload.message,
        "details": json.dumps(payload.details or {}),
        "priority": priority,
        "dedupe_key": dedupe_key,
        "target_roles": target_roles,
        "iam_user": payload.iam_user,
        "created_at": now,
    })

    logger.info(f"Stored alert [{payload.severity}] {payload.message[:60]} priority={priority}")
    return {"status": "created", "alert_id": str(alert_id), "priority": priority}


# ─── Health ───────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "healthy", "service": "cloudguard-alert-service"}


# ─── Public APIs ──────────────────────────────────────────────
@app.get("/alerts/summary")
async def get_alerts_summary():
    """Get alert counts by severity."""
    row = await database.fetch_one("""
        SELECT
            COUNT(CASE WHEN severity = 'critical' THEN 1 END) AS critical,
            COUNT(CASE WHEN severity = 'high' THEN 1 END) AS high,
            COUNT(CASE WHEN severity = 'medium' THEN 1 END) AS medium,
            COUNT(CASE WHEN severity = 'low' THEN 1 END) AS low,
            COUNT(*) AS total
        FROM alerts
        WHERE status = 'active'
    """)
    return dict(row) if row else {"critical": 0, "high": 0, "medium": 0, "low": 0, "total": 0}


@app.get("/alerts/recent")
async def get_recent_alerts(limit: int = 20):
    """Get recent alerts."""
    rows = await database.fetch_all("""
        SELECT id, severity, type, message, source_id as resource_id, created_at as timestamp, status
        FROM alerts
        WHERE status = 'active'
        ORDER BY created_at DESC
        LIMIT :limit
    """, {"limit": limit})
    return [dict(r) for r in rows]


@app.get("/alerts")
async def get_alerts(limit: int = 50, offset: int = 0):
    """Get all alerts."""
    rows = await database.fetch_all("""
        SELECT id, severity, type, message, source_id as resource_id, created_at as timestamp, status
        FROM alerts
        ORDER BY created_at DESC
        LIMIT :limit OFFSET :offset
    """, {"limit": limit, "offset": offset})
    return [dict(r) for r in rows]


@app.get("/alerts/stream")
async def alerts_stream(request: Request):
    """Server-sent events for real-time alerts with 15-second keepalive pings."""
    async def event_generator():
        pubsub = redis_client.pubsub()
        await pubsub.subscribe("alerts_stream")
        logger.info("SSE client connected to alerts_stream")
        last_ping = asyncio.get_event_loop().time()

        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    logger.info("SSE client disconnected")
                    break

                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.5)
                if message:
                    try:
                        data = json.loads(message["data"])
                        data["created_at"] = data.get("timestamp", datetime.utcnow().isoformat())
                        yield f"event: alert\ndata: {json.dumps(data)}\n\n"
                    except Exception as e:
                        logger.error(f"SSE message parse error: {e}")

                # Send heartbeat every 15 seconds to keep connection alive
                now = asyncio.get_event_loop().time()
                if now - last_ping >= 15:
                    yield f"event: ping\ndata: {{\"ts\": \"{datetime.utcnow().isoformat()}\"}}\n\n"
                    last_ping = now

                await asyncio.sleep(0.1)
        except Exception as e:
            logger.error(f"SSE generator error: {e}")
        finally:
            try:
                await pubsub.close()
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ─── Auto-Remediation Simulation ─────────────────────────────
@app.post("/internal/remediate/{alert_id}")
async def simulate_remediation(alert_id: str):
    """Simulates auto-remediation: marks alert resolved and logs action."""
    row = await database.fetch_one("SELECT * FROM alerts WHERE id = :id", {"id": alert_id})
    if not row:
        return JSONResponse(status_code=404, content={"detail": "Alert not found"})

    await database.execute(
        "UPDATE alerts SET status = 'resolved' WHERE id = :id", {"id": alert_id}
    )

    remediation_event = {
        "type": "remediation",
        "alert_id": alert_id,
        "action": "auto_stop_idle_vm" if row["type"] == "finops" else "auto_restrict_access",
        "message": f"[AutoRemediation] Alert {alert_id} automatically resolved.",
        "timestamp": datetime.utcnow().isoformat(),
    }
    # Notice: redis_client.publish has been removed
    logger.info(f"Remediation simulated for alert {alert_id}")
    return remediation_event
