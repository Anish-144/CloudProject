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
import redis.asyncio as aioredis

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "alert_service", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

database = Database(DATABASE_URL)
redis_client: aioredis.Redis = None

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
    """Subscribe to Redis alerts_ingest and store alerts, then broadcast to alerts_stream."""
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("alerts_ingest")
    logger.info("Subscribed to alerts_ingest")
    
    while True:
        try:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message:
                data = json.loads(message["data"])
                payload = AlertPayload(**data)
                await receive_alert(payload, from_stream=True)
            else:
                await asyncio.sleep(0.1)
        except Exception as e:
            logger.error(f"Error processing Redis message: {e}")
            await asyncio.sleep(1)


# ─── Models ───────────────────────────────────────────────────
class AlertPayload(BaseModel):
    type: str
    source_id: Optional[str] = None
    severity: str
    message: str
    details: Optional[dict] = {}
    account_id: Optional[str] = None
    iam_entity: Optional[str] = None
    service: Optional[str] = None


# ─── App Lifespan ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    logger.info("Alert Service starting...")
    await database.connect()
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    logger.info("Connected to DB and Redis.")
    
    # Start Redis subscriber in background
    asyncio.create_task(subscribe_alerts())
    
    yield
    await database.disconnect()
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


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    error_msg = f"Unhandled error during {request.method} {request.url.path}: {str(exc)}"
    logger.error(error_msg, exc_info=True)
    
    # Manual CORS headers for the exception response in case the middleware is bypassed
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
    }
    
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_type": type(exc).__name__},
        headers=headers
    )


# ─── Internal Endpoint (called by engines) ────────────────────
@app.post("/internal/alerts")
async def receive_alert(payload: AlertPayload, from_stream: bool = False):
    """Receive alert from API or Redis stream, deduplicate, store, notify."""
    now = datetime.utcnow()
    dedupe_key = build_dedupe_key(payload.type, payload.source_id or "", payload.message)

    # Check for existing active duplicate
    existing = await database.fetch_one(
        "SELECT id FROM alerts WHERE dedupe_key = :key AND status = 'active' AND created_at > NOW() - INTERVAL '1 hour'",
        {"key": dedupe_key}
    )
    if existing:
        logger.info(f"Deduplicated alert: {dedupe_key[:12]}...")
        return {"status": "deduplicated", "existing_id": str(existing["id"])}

    # Robustness: ensure severity is lowercased to match DB constraint
    sev = payload.severity.lower()
    priority = calculate_priority(sev, payload.type, now)

    alert_id = await database.execute("""
        INSERT INTO alerts (type, source_id, severity, message, details, status, priority, dedupe_key, account_id, iam_entity, service, created_at)
        VALUES (:type, :source_id, :severity, :message, :details, 'active', :priority, :dedupe_key, :account_id, :iam_entity, :service, :created_at)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET 
            status = 'active', severity = EXCLUDED.severity, priority = EXCLUDED.priority, details = EXCLUDED.details, created_at = EXCLUDED.created_at
        RETURNING id
    """, {
        "type": payload.type,
        "source_id": payload.source_id,
        "severity": sev,
        "message": payload.message,
        "details": json.dumps(payload.details or {}),
        "priority": priority,
        "dedupe_key": dedupe_key,
        "account_id": payload.account_id,
        "iam_entity": payload.iam_entity,
        "service": payload.service,
        "created_at": now,
    })

    # Broadcast enriched alert to 'alerts_stream' for the frontend SSE consumers
    if redis_client:
        try:
            full_payload = payload.dict()
            full_payload["alert_id"] = str(alert_id)
            full_payload["severity"] = sev
            full_payload["priority"] = priority
            full_payload["created_at"] = now.isoformat()
            await redis_client.publish("alerts_stream", json.dumps(full_payload, default=str))
            logger.info(f"Broadcasted alert to stream: {payload.message[:60]}")
        except Exception as e:
            logger.error(f"Failed to broadcast alert: {e}")

    logger.info(f"Stored alert [{payload.severity}] {payload.message[:60]} priority={priority}")
    return {"status": "created", "alert_id": str(alert_id), "priority": priority}


# ─── Health ───────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "healthy", "service": "cloudguard-alert-service"}


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
    await redis_client.publish("alerts_stream", json.dumps(remediation_event))
    logger.info(f"Remediation simulated for alert {alert_id}")
    return remediation_event
