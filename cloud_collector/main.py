"""
CloudGuard Cloud Data Collector — Main Orchestrator

Coordinates all Boto3 collectors (EC2, CloudWatch, S3, IAM) for a
single AWS account using default credentials.

Flow:
  1. Create boto3 session with default credentials
  2. Run collectors (EC2, S3, IAM)
  3. Store results in PostgreSQL via incoming_logs table
  4. Update resource and compliance check records

Supports three modes:
  - "simulated"  → Collector disabled (engines use mock data only)
  - "aws_live"   → Only real AWS data
  - "hybrid"     → Both mock generator and AWS collector run (default)
"""

import os
import json
import asyncio
import logging
import httpx
import uvicorn
from fastapi import FastAPI
from datetime import datetime, timezone
from dateutil.parser import isoparse
from typing import Optional

from databases import Database
import boto3
from botocore.exceptions import ClientError, NoCredentialsError

from collectors import EC2Collector, CloudWatchCollector, S3Collector, IAMCollector

# ── Logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "cloud_collector", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL")
ALERT_SERVICE_URL = os.getenv("ALERT_SERVICE_URL", "http://alert_service:8003")
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
DATA_SOURCE_MODE = os.getenv("DATA_SOURCE_MODE", "hybrid")

# Polling intervals (seconds)
EC2_INTERVAL = int(os.getenv("COLLECTOR_EC2_INTERVAL", "300"))       # 5 min
S3_INTERVAL = int(os.getenv("COLLECTOR_S3_INTERVAL", "900"))         # 15 min
IAM_INTERVAL = int(os.getenv("COLLECTOR_IAM_INTERVAL", "1800"))      # 30 min

# Use STS AssumeRole or fallback to .env credentials
USE_STS = False

STREAM_KEY = "cloud_logs"


# ── Database Helpers ──────────────────────────────────────────

async def load_active_accounts(db: Database) -> list[dict]:
    """Load all active AWS accounts from the database."""
    rows = await db.fetch_all("""
        SELECT id, account_name, account_id, role_arn, external_id, regions, is_active
        FROM aws_accounts
        WHERE is_active = true
        ORDER BY account_name
    """)
    accounts = []
    for row in rows:
        accounts.append({
            "id": str(row["id"]),
            "account_name": row["account_name"],
            "account_id": row["account_id"],
            "role_arn": row["role_arn"],
            "external_id": row["external_id"],
            "regions": row["regions"] or [AWS_REGION],
        })
    logger.info(f"Loaded {len(accounts)} active AWS accounts from database")
    return accounts


async def update_account_status(
    db: Database, account_db_id: str, status: str, error: Optional[str] = None
):
    """Update scan status for an account."""
    await db.execute("""
        UPDATE aws_accounts
        SET scan_status = :status,
            last_scanned = CASE WHEN :status = 'success' THEN NOW() ELSE last_scanned END,
            error_message = :error
        WHERE id = :id
    """, {"status": status, "error": error, "id": account_db_id})


async def upsert_aws_resource(db: Database, resource: dict, account_db_id: Optional[str] = None) -> str:
    """Insert or update an AWS resource record and return the UUID from the resources table."""
    aws_id = resource["aws_resource_id"]
    resource_type = resource["resource_type"]
    region = resource.get("region", AWS_REGION)
    status = resource.get("status", "unknown")
    metadata = json.dumps(resource.get("metadata", {}))

    # Upsert into aws_resources (now includes account_id)
    if account_db_id:
        await db.execute("""
            INSERT INTO aws_resources (aws_resource_id, resource_type, region, metadata, status, last_seen, account_id)
            VALUES (:aws_id, :type, :region, :metadata, :status, NOW(), :acct_id)
            ON CONFLICT (aws_resource_id) DO UPDATE SET
                status = EXCLUDED.status,
                metadata = EXCLUDED.metadata,
                last_seen = NOW(),
                account_id = EXCLUDED.account_id
        """, {
            "aws_id": aws_id, "type": resource_type, "region": region,
            "metadata": metadata, "status": status, "acct_id": account_db_id,
        })
    else:
        await db.execute("""
            INSERT INTO aws_resources (aws_resource_id, resource_type, region, metadata, status, last_seen)
            VALUES (:aws_id, :type, :region, :metadata, :status, NOW())
            ON CONFLICT (aws_resource_id) DO UPDATE SET
                status = EXCLUDED.status,
                metadata = EXCLUDED.metadata,
                last_seen = NOW()
        """, {
            "aws_id": aws_id, "type": resource_type, "region": region,
            "metadata": metadata, "status": status,
        })

    # Ensure a record exists in the main resources table (for engine compatibility)
    existing = await db.fetch_one(
        "SELECT id FROM resources WHERE aws_resource_id = :aws_id",
        {"aws_id": aws_id}
    )
    if existing:
        return str(existing["id"])

    resource_uuid = await db.execute("""
        INSERT INTO resources (cloud_provider, resource_type, region, aws_resource_id, data_source)
        VALUES ('aws', :type, :region, :aws_id, 'aws_live')
        ON CONFLICT DO NOTHING
        RETURNING id
    """, {"type": resource_type, "region": region, "aws_id": aws_id})

    uuid_str = str(resource_uuid) if resource_uuid else None
    if uuid_str:
        await db.execute(
            "UPDATE aws_resources SET resource_id = :rid WHERE aws_resource_id = :aws_id",
            {"rid": uuid_str, "aws_id": aws_id}
        )
        return uuid_str

    row = await db.fetch_one(
        "SELECT id FROM resources WHERE aws_resource_id = :aws_id",
        {"aws_id": aws_id}
    )
    return str(row["id"]) if row else aws_id


def ensure_datetime(val) -> datetime:
    """Convert string timestamps to datetime objects for asyncpg."""
    if val is None:
        return datetime.now(timezone.utc)
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        try:
            return isoparse(val)
        except Exception:
            return datetime.now(timezone.utc)
    return datetime.now(timezone.utc)


async def store_aws_metric(db: Database, metric: dict):
    """Store a CloudWatch metric datapoint."""
    ts = ensure_datetime(metric.get("timestamp"))
    await db.execute("""
        INSERT INTO aws_metrics (aws_resource_id, metric_name, metric_value, unit, timestamp)
        VALUES (:aws_id, :name, :value, :unit, :ts)
        ON CONFLICT (aws_resource_id, metric_name, timestamp) DO UPDATE SET
            metric_value = EXCLUDED.metric_value
    """, {
        "aws_id": metric["aws_resource_id"],
        "name": metric.get("metric_name", "CPUUtilization"),
        "value": metric.get("metric_value", 0),
        "unit": metric.get("unit", "Percent"),
        "ts": ts,
    })


async def store_compliance_check(db: Database, check: dict):
    """Store a compliance check result."""
    await db.execute("""
        INSERT INTO aws_compliance_checks (aws_resource_id, check_type, check_passed, details)
        VALUES (:aws_id, :check_type, :passed, :details)
    """, {
        "aws_id": check["aws_resource_id"],
        "check_type": check["check_type"],
        "passed": check["check_passed"],
        "details": json.dumps(check.get("details", {})),
    })


# ── DB Log Publisher ─────────────────────────────────────────

async def publish_log_entry(db: Database, log_entry: dict):
    """Publish a LogEntry directly to database instead of Redis Streams."""
    log_entry["data_source"] = "aws_live"
    log_entry["timestamp"] = log_entry.get("timestamp", datetime.now(timezone.utc).isoformat())
    await db.execute("INSERT INTO incoming_logs (log_data) VALUES (:log_data)", {"log_data": json.dumps(log_entry, default=str)})


# ── Alert Publisher ───────────────────────────────────────────

async def publish_critical_alert(http_client: httpx.AsyncClient, resource_id: str, message: str, details: dict):
    """Send a critical finding directly to Alert Service."""
    details["aws_resource_id"] = resource_id
    payload = {
        "type": "compliance",
        "source_id": None,
        "severity": "critical",
        "message": message,
        "details": details,
    }
    try:
        resp = await http_client.post(f"{ALERT_SERVICE_URL}/internal/alerts", json=payload, timeout=5)
        resp.raise_for_status()
        logger.info(f"Critical alert sent: {message[:80]}")
    except Exception as e:
        logger.error(f"Failed to send critical alert: {e}")


# ── Per-Account Collection Functions ──────────────────────────

async def collect_ec2_and_cloudwatch(
    db: Database, _, http_client: httpx.AsyncClient,
    session, region: str, account_name: str, account_db_id: Optional[str] = None
):
    """Full EC2 + CloudWatch collection for ONE account + region."""
    logger.info(f"═══ EC2+CW: {account_name} / {region} ═══")

    ec2 = EC2Collector(region=region, session=session)
    cw = CloudWatchCollector(region=region, session=session)

    instances = ec2.collect()
    if not instances:
        logger.warning(f"No EC2 instances found in {account_name}/{region}")
        return

    running_ids = [i["aws_resource_id"] for i in instances if i["status"] == "running"]
    cw_metrics = {}
    if running_ids:
        for m in cw.collect_for_instances(running_ids):
            cw_metrics[m["aws_resource_id"]] = m

    for inst in instances:
        instance_id = inst["aws_resource_id"]
        resource_uuid = await upsert_aws_resource(db, inst, account_db_id)
        logger.info(f"EC2: {instance_id} → UUID {resource_uuid} ({account_name})")

        metrics = cw_metrics.get(instance_id, {})
        cpu_avg = metrics.get("cpu_avg", 0.0) or 0.0
        net_in = metrics.get("network_in_bytes", 0) or 0
        net_out = metrics.get("network_out_bytes", 0) or 0

        if metrics:
            await store_aws_metric(db, {
                "aws_resource_id": instance_id,
                "metric_name": "CPUUtilization",
                "metric_value": cpu_avg,
                "unit": "Percent",
                "timestamp": metrics.get("timestamp", datetime.now(timezone.utc).isoformat()),
            })

        daily_cost = ec2.get_estimated_daily_cost(
            inst.get("instance_type", "t2.micro"),
            inst.get("status", "stopped")
        )

        log_entry = {
            "resource_id": resource_uuid,
            "cpu_usage": cpu_avg,
            "memory_usage": 0.0,
            "cost": round(daily_cost / 24, 4),
            "network_in_gb": round(net_in / (1024 ** 3), 4) if net_in else 0,
            "network_out_gb": round(net_out / (1024 ** 3), 4) if net_out else 0,
            "public_access": inst.get("has_public_ip", False),
            "in_private_subnet": inst.get("in_private_subnet", True),
            "daily_cost": daily_cost,
            "account_name": account_name,
        }
        await publish_log_entry(db, log_entry)

        await store_compliance_check(db, {
            "aws_resource_id": instance_id,
            "check_type": "ec2_public_ip",
            "check_passed": not inst.get("has_public_ip", False),
            "details": {"public_ip": inst.get("metadata", {}).get("public_ip"), "account": account_name},
        })

    logger.info(f"EC2 cycle complete: {len(instances)} instances in {account_name}/{region}")


async def collect_s3(
    db: Database, _unused, http_client: httpx.AsyncClient,
    session, region: str, account_name: str, account_db_id: Optional[str] = None
):
    """Full S3 compliance collection for ONE account."""
    logger.info(f"═══ S3: {account_name} / {region} ═══")

    s3 = S3Collector(region=region, session=session)
    buckets = s3.collect()

    for bucket in buckets:
        bucket_name = bucket["aws_resource_id"]
        resource_uuid = await upsert_aws_resource(db, bucket, account_db_id)
        logger.info(f"S3: {bucket_name} → UUID {resource_uuid} ({account_name})")

        log_entry = {
            "resource_id": resource_uuid,
            "cpu_usage": 0, "memory_usage": 0, "cost": 0,
            "public_access": bucket.get("public_access", True),
            "encryption_at_rest": bucket.get("encryption_at_rest", False),
            "logging_enabled": bucket.get("logging_enabled", False),
            "account_name": account_name,
        }
        await publish_log_entry(db, log_entry)

        checks = [
            ("s3_public_access", not bucket.get("public_access", True)),
            ("s3_encryption", bucket.get("encryption_at_rest", False)),
            ("s3_versioning", bucket.get("versioning_enabled", False)),
            ("s3_logging", bucket.get("logging_enabled", False)),
        ]
        for check_type, passed in checks:
            await store_compliance_check(db, {
                "aws_resource_id": bucket_name,
                "check_type": check_type,
                "check_passed": passed,
                "details": {**bucket.get("metadata", {}), "account": account_name},
            })

        if bucket.get("public_access", False):
            await publish_critical_alert(
                http_client, bucket_name,
                f"[{account_name}] S3 bucket '{bucket_name}' has public access enabled",
                {"bucket": bucket_name, "public_access": True, "account": account_name},
            )

    logger.info(f"S3 cycle complete: {len(buckets)} buckets in {account_name}")


async def collect_iam(
    db: Database, _unused, http_client: httpx.AsyncClient,
    session, account_name: str, account_db_id: Optional[str] = None
):
    """Full IAM security collection for ONE account."""
    logger.info(f"═══ IAM: {account_name} ═══")

    iam = IAMCollector(session=session)
    users = iam.collect()

    for user in users:
        user_id = user["aws_resource_id"]
        resource_uuid = await upsert_aws_resource(db, user, account_db_id)
        logger.info(f"IAM: {user_id} → UUID {resource_uuid} ({account_name})")

        log_entry = {
            "resource_id": resource_uuid,
            "cpu_usage": 0, "memory_usage": 0, "cost": 0,
            "mfa_enabled": user.get("mfa_enabled", False),
            "is_root_account": user.get("is_root_account", False),
            "account_name": account_name,
        }
        await publish_log_entry(db, log_entry)

        checks = [
            ("iam_mfa", user.get("mfa_enabled", False)),
            ("iam_root_usage", not user.get("is_root_account", False)),
            ("iam_key_rotation", user.get("access_key_age_days", 0) <= 90),
        ]
        for check_type, passed in checks:
            await store_compliance_check(db, {
                "aws_resource_id": user_id,
                "check_type": check_type,
                "check_passed": passed,
                "details": {**user.get("metadata", {}), "account": account_name},
            })

        if user.get("is_root_account", False):
            await publish_critical_alert(
                http_client, user_id,
                f"[{account_name}] Root account detected in IAM user list",
                {"username": user.get("metadata", {}).get("username"), "account": account_name},
            )

        if not user.get("mfa_enabled", False):
            await publish_critical_alert(
                http_client, user_id,
                f"[{account_name}] IAM user '{user.get('metadata', {}).get('username')}' has no MFA enabled",
                {"username": user.get("metadata", {}).get("username"), "mfa_enabled": False, "account": account_name},
            )

    logger.info(f"IAM cycle complete: {len(users)} users in {account_name}")


# ── Multi-Account Collection Orchestrator ─────────────────────

async def collect_single_account(
    db: Database, _unused, http_client: httpx.AsyncClient,
    collector_type: str = "all"
):
    """Runs data collection for a single primary account using default AWS credentials."""
    logger.info("Running single account collection...")
    session = boto3.Session(region_name=AWS_REGION)
    account_name = "PrimaryAccount"

    if collector_type in ("all", "ec2"):
        try:
            await collect_ec2_and_cloudwatch(db, None, http_client, session, AWS_REGION, account_name)
        except Exception as e:
            logger.error(f"EC2 failed: {e}")

    if collector_type in ("all", "s3"):
        try:
            await collect_s3(db, None, http_client, session, AWS_REGION, account_name)
        except Exception as e:
            logger.error(f"S3 failed: {e}")

    if collector_type in ("all", "iam"):
        try:
            await collect_iam(db, None, http_client, session, account_name)
        except Exception as e:
            logger.error(f"IAM failed: {e}")


# ── Scheduled Loop Runners ────────────────────────────────────

async def run_loop(name: str, interval: int, coro_fn, *args):
    """Generic scheduled loop runner with error handling."""
    logger.info(f"Scheduler: {name} loop starting (interval={interval}s)")
    while True:
        try:
            await coro_fn(*args)
        except Exception as e:
            logger.error(f"Scheduler: {name} failed: {e}", exc_info=True)
        await asyncio.sleep(interval)


# ── Health Check Server ───────────────────────────────────────

health_app = FastAPI()


@health_app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "cloud_collector",
        "mode": DATA_SOURCE_MODE,
        "region": AWS_REGION,
        "use_sts": USE_STS,
    }


async def run_health_server():
    config = uvicorn.Config(health_app, host="0.0.0.0", port=8004, log_level="error")
    server = uvicorn.Server(config)
    await server.serve()


# ── Main Entry Point ──────────────────────────────────────────

async def main():
    logger.info("╔═══════════════════════════════════════════════╗")
    logger.info("║   CloudGuard Cloud Data Collector (STS)       ║")
    logger.info(f"║   Mode: {DATA_SOURCE_MODE:<17}                ║")
    logger.info(f"║   Region: {AWS_REGION:<15}                ║")
    logger.info(f"║   STS: {'Enabled' if USE_STS else 'Disabled':<17}                ║")
    logger.info("╚═══════════════════════════════════════════════╝")

    if DATA_SOURCE_MODE == "simulated":
        logger.info("Mode is 'simulated' — Collector will idle. Engines use mock data only.")
        await run_health_server()
        return

    # Connect to shared infrastructure
    db = Database(DATABASE_URL)
    await db.connect()
    logger.info("Database connected.")

    # Start health server
    asyncio.create_task(run_health_server())

    async with httpx.AsyncClient() as http_client:
        # Run initial full collection immediately
        logger.info("Running initial collection cycle (primary account)...")
        try:
            await collect_single_account(db, None, http_client, "all")
            logger.info("Initial collection complete ✓")
        except Exception as e:
            logger.error(f"Initial collection failed (will retry on schedule): {e}")

        # Start scheduled loops — each loop runs collect_all_accounts for its type
        logger.info("Starting scheduled collection loops...")
        await asyncio.gather(
            run_loop("EC2+CloudWatch", EC2_INTERVAL, collect_single_account, db, None, http_client, "ec2"),
            run_loop("S3", S3_INTERVAL, collect_single_account, db, None, http_client, "s3"),
            run_loop("IAM", IAM_INTERVAL, collect_single_account, db, None, http_client, "iam"),
        )


if __name__ == "__main__":
    asyncio.run(main())
