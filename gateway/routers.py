import os
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from databases import Database
from auth import get_current_user, verify_password, create_access_token, require_authenticated, require_finops, require_compliance
from models import (
    LoginRequest, TokenResponse, LogBatch, IngestResponse,
    AlertOut, FinOpsSummary, ComplianceScore
)
import redis.asyncio as aioredis
from datetime import datetime
from typing import AsyncGenerator
import asyncio

logger = logging.getLogger(__name__)

# ── Auth Router ───────────────────────────────────────────────
auth_router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


@auth_router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: Database = Depends(lambda: None)):
    from main import database
    logger.info(f"Login attempt for email: {request.email}")
    
    row = await database.fetch_one(
        "SELECT id, email, password_hash, role FROM users WHERE email = :email",
        {"email": request.email}
    )
    
    if not row:
        logger.warning(f"User not found for email: {request.email}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    
    logger.info(f"User '{request.email}' found in database. Verifying password...")
    
    is_valid = verify_password(request.password, row["password_hash"])
    logger.info(f"Password match result: {is_valid}")
    
    if not is_valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
        
    token = create_access_token({"sub": row["email"], "role": row["role"], "user_id": str(row["id"])})
    logger.info(f"Successful login for '{request.email}', returning token.")
    return TokenResponse(access_token=token, role=row["role"])


@auth_router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


# ── Ingest Router ─────────────────────────────────────────────
ingest_router = APIRouter(prefix="/api/v1/ingest", tags=["Log Ingestion"])


@ingest_router.post("/logs", response_model=IngestResponse)
async def ingest_logs(batch: LogBatch, current_user: dict = Depends(require_authenticated)):
    from main import redis_client
    pipe = redis_client.pipeline()
    for log in batch.logs:
        entry = log.model_dump()
        entry["ingested_by"] = current_user["email"]
        entry["ingested_at"] = datetime.utcnow().isoformat()
        # Push to Redis Stream
        pipe.xadd("cloud_logs", {"data": json.dumps(entry, default=str)})
    await pipe.execute()
    logger.info(f"Ingested {len(batch.logs)} logs from {current_user['email']}")
    return IngestResponse(accepted=len(batch.logs), message="Logs queued for processing")


# ── Alerts Router ─────────────────────────────────────────────
alerts_router = APIRouter(prefix="/api/v1/alerts", tags=["Alerts"])


@alerts_router.get("", response_model=list[AlertOut])
async def get_alerts(
    severity: str = None,
    status: str = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(require_authenticated)
):
    from main import database
    query = "SELECT * FROM alerts WHERE 1=1"
    params = {}
    if severity:
        query += " AND severity = :severity"
        params["severity"] = severity
    if status:
        query += " AND status = :status"
        params["status"] = status
    query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
    params["limit"] = limit
    params["offset"] = offset
    rows = await database.fetch_all(query, params)
    return [dict(r) for r in rows]


@alerts_router.get("/stream")
async def alert_stream(current_user: dict = Depends(require_authenticated)):
    """Server-Sent Events endpoint for real-time alerts."""
    from main import redis_client

    async def event_generator() -> AsyncGenerator[str, None]:
        pubsub = redis_client.pubsub()
        await pubsub.subscribe("alert_notifications")
        try:
            yield "data: {\"type\": \"connected\", \"message\": \"CloudGuard SSE stream active\"}\n\n"
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message:
                    yield f"data: {message['data'].decode()}\n\n"
                else:
                    # Keep-alive ping every second
                    yield ": ping\n\n"
                    await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe("alert_notifications")
            await pubsub.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@alerts_router.patch("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, current_user: dict = Depends(require_authenticated)):
    from main import database
    await database.execute(
        "UPDATE alerts SET status = 'acknowledged' WHERE id = :id",
        {"id": alert_id}
    )
    return {"message": "Alert acknowledged"}


# ── FinOps Router ─────────────────────────────────────────────
finops_router = APIRouter(prefix="/api/v1/finops", tags=["FinOps"])


@finops_router.get("/summary", response_model=FinOpsSummary)
async def get_finops_summary(current_user: dict = Depends(require_authenticated)):
    from main import database
    # Aggregate alert data for finops summary
    row = await database.fetch_one("""
        SELECT
            COALESCE(SUM((details->>'estimated_savings')::float), 0) AS total_savings,
            COUNT(CASE WHEN details->>'waste_type' = 'idle_resource' THEN 1 END) AS idle,
            COUNT(CASE WHEN details->>'waste_type' = 'overprovisioned' THEN 1 END) AS overprovisioned,
            COUNT(CASE WHEN details->>'waste_type' = 'cost_spike' THEN 1 END) AS cost_spike
        FROM alerts
        WHERE type = 'finops' AND status = 'active'
    """)
    cost_row = await database.fetch_one("""
        SELECT
            COALESCE(AVG(cost), 0) AS avg_cost,
            COALESCE(AVG(cost) * 30, 0) AS forecast_30d
        FROM usage_logs
        WHERE timestamp > NOW() - INTERVAL '30 days'
    """)
    return FinOpsSummary(
        total_savings_potential=float(row["total_savings"] or 0),
        idle_resources=int(row["idle"] or 0),
        overprovisioned_resources=int(row["overprovisioned"] or 0),
        cost_spike_resources=int(row["cost_spike"] or 0),
        avg_monthly_cost=float(cost_row["avg_cost"] or 0) * 30,
        forecast_30d=float(cost_row["forecast_30d"] or 0),
    )


@finops_router.get("/cost-trends")
async def get_cost_trends(current_user: dict = Depends(require_authenticated)):
    from main import database
    rows = await database.fetch_all("""
        SELECT
            DATE_TRUNC('day', timestamp) AS day,
            SUM(cost) AS daily_cost,
            AVG(cpu_usage) AS avg_cpu
        FROM usage_logs
        WHERE timestamp > NOW() - INTERVAL '30 days'
        GROUP BY day
        ORDER BY day ASC
    """)
    return [{"date": str(r["day"])[:10], "cost": round(float(r["daily_cost"]), 2), "cpu": round(float(r["avg_cpu"]), 1)} for r in rows]


@finops_router.get("/top-savings")
async def get_top_savings(current_user: dict = Depends(require_authenticated)):
    from main import database
    rows = await database.fetch_all("""
        SELECT id, message, details, severity, created_at
        FROM alerts
        WHERE type = 'finops' AND status = 'active'
        ORDER BY (details->>'estimated_savings')::float DESC NULLS LAST
        LIMIT 10
    """)
    return [dict(r) for r in rows]


# ── Compliance Router ─────────────────────────────────────────
compliance_router = APIRouter(prefix="/api/v1/compliance", tags=["Compliance"])


@compliance_router.get("/score", response_model=ComplianceScore)
async def get_compliance_score(current_user: dict = Depends(require_authenticated)):
    from main import database
    rules = await database.fetch_one("SELECT COUNT(*) AS total, SUM(weight) AS total_weight FROM compliance_rules WHERE active = true")
    violations = await database.fetch_all("""
        SELECT v.severity, cr.weight
        FROM violations v
        JOIN compliance_rules cr ON v.rule_id = cr.id
        WHERE v.status = 'open'
    """)
    total_weight = float(rules["total_weight"] or 100)
    violated_weight = sum(float(v["weight"]) for v in violations)
    score = max(0, 100 - (violated_weight / total_weight * 100)) if total_weight > 0 else 100

    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for v in violations:
        counts[v["severity"]] = counts.get(v["severity"], 0) + 1

    categories_rows = await database.fetch_all("""
        SELECT cr.category,
               COUNT(*) FILTER (WHERE v.id IS NOT NULL) AS violated,
               COUNT(*) AS total
        FROM compliance_rules cr
        LEFT JOIN violations v ON v.rule_id = cr.id AND v.status = 'open'
        WHERE cr.active = true
        GROUP BY cr.category
    """)
    by_category = {
        r["category"]: round(100 - (r["violated"] / max(r["total"], 1) * 100), 1)
        for r in categories_rows
    }

    return ComplianceScore(
        overall_score=round(score, 1),
        total_rules=int(rules["total"] or 0),
        violated_rules=len(set(violations)),
        active_violations=len(violations),
        critical_violations=counts["critical"],
        high_violations=counts["high"],
        medium_violations=counts["medium"],
        low_violations=counts["low"],
        by_category=by_category,
    )


@compliance_router.get("/violations")
async def get_violations(
    severity: str = None,
    status: str = "open",
    limit: int = 50,
    current_user: dict = Depends(require_authenticated)
):
    from main import database
    query = """
        SELECT v.id, v.severity, v.status, v.created_at, v.details,
               cr.name AS rule_name, cr.description AS rule_description,
               r.cloud_provider, r.resource_type, r.region
        FROM violations v
        JOIN compliance_rules cr ON v.rule_id = cr.id
        JOIN resources r ON v.resource_id = r.id
        WHERE 1=1
    """
    params = {}
    if severity:
        query += " AND v.severity = :severity"
        params["severity"] = severity
    if status:
        query += " AND v.status = :status"
        params["status"] = status
    query += " ORDER BY v.created_at DESC LIMIT :limit"
    params["limit"] = limit
    rows = await database.fetch_all(query, params)
    return [dict(r) for r in rows]


@compliance_router.get("/rules")
async def get_rules(current_user: dict = Depends(require_authenticated)):
    from main import database
    rows = await database.fetch_all("SELECT * FROM compliance_rules ORDER BY weight DESC")
    return [dict(r) for r in rows]
