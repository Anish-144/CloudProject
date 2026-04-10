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

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "alert_service", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")

database = Database(DATABASE_URL)

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


# ─── Models ───────────────────────────────────────────────────
class AlertPayload(BaseModel):
    type: str
    source_id: Optional[str] = None
    severity: str
    message: str
    details: Optional[dict] = {}
    target_roles: Optional[list[str]] = None
    iam_user: Optional[str] = None


# ─── App Lifespan ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Alert Service starting...")
    await database.connect()
    logger.info("Connected to DB.")
    yield
    await database.disconnect()

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
    dedupe_key = build_dedupe_key(payload.type, payload.source_id or "", payload.message)

    # Check for existing active duplicate
    existing = await database.fetch_one(
        "SELECT id FROM alerts WHERE dedupe_key = :key AND status = 'active' AND created_at > NOW() - INTERVAL '24 hours'",
        {"key": dedupe_key}
    )
    if existing:
        logger.info(f"Deduplicated alert: {dedupe_key[:12]}...")
        return {"status": "deduplicated", "existing_id": str(existing["id"])}

    priority = calculate_priority(payload.severity, payload.type, now)

    # Auto-compute target_roles from alert type if not explicitly set
    target_roles = payload.target_roles or ALERT_ROLE_ROUTING.get(payload.type, ["cloud_admin"])

    alert_id = await database.execute("""
        INSERT INTO alerts (type, source_id, severity, message, details, status, priority, dedupe_key, target_roles, iam_user, created_at)
        VALUES (:type, :source_id, :severity, :message, :details, 'active', :priority, :dedupe_key, :target_roles, :iam_user, :created_at)
        RETURNING id
    """, {
        "type": payload.type,
        "source_id": payload.source_id,
        "severity": payload.severity,
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
