import csv
import io
import logging
import json
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
import csv
import io
from databases import Database
from auth import (
    get_current_user, verify_password, create_access_token,
    require_authenticated, require_finops, require_compliance,
    require_it_admin, require_cloud_admin
)
from models import (
    LoginRequest, TokenResponse, LogBatch, IngestResponse,
    AlertOut, FinOpsSummary, ComplianceScore, UserOut, AccountStats, ResourceOut
)
import redis.asyncio as aioredis
from datetime import datetime
from typing import AsyncGenerator, Optional
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

    logger.info(f"User '{request.email}' found. Verifying password...")
    is_valid = verify_password(request.password, row["password_hash"])
    logger.info(f"Password match result: {is_valid}")

    if not is_valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    token = create_access_token({"sub": row["email"], "role": row["role"], "user_id": str(row["id"])})
    logger.info(f"Successful login for '{request.email}', role='{row['role']}'")
    return TokenResponse(access_token=token, role=row["role"], email=row["email"])


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
        pipe.xadd("cloud_logs", {"data": json.dumps(entry, default=str)})
    await pipe.execute()
    logger.info(f"Ingested {len(batch.logs)} logs from {current_user['email']}")
    return IngestResponse(accepted=len(batch.logs), message="Logs queued for processing")


# ── Alerts Router ─────────────────────────────────────────────
# Accessible by ALL authenticated roles
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
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@alerts_router.patch("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, current_user: dict = Depends(require_authenticated)):
    from main import database
    await database.execute(
        "UPDATE alerts SET status = 'acknowledged' WHERE id = :id",
        {"id": alert_id}
    )
    return {"message": "Alert acknowledged"}


<<<<<<< HEAD
# ── Public Alerts Router (no v1) ───────────────────────────────
public_alerts_router = APIRouter(prefix="/api/alerts", tags=["Public Alerts"])


@public_alerts_router.get("/summary")
async def get_alerts_summary(current_user: dict = Depends(require_authenticated)):
    """Get alert summary counts."""
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get("http://alert_service:8003/alerts/summary")
        resp.raise_for_status()
        return resp.json()


@public_alerts_router.get("/recent")
async def get_recent_alerts(limit: int = 20, current_user: dict = Depends(require_authenticated)):
    """Get recent alerts."""
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"http://alert_service:8003/alerts/recent?limit={limit}")
        resp.raise_for_status()
        return resp.json()


@public_alerts_router.get("")
async def get_all_alerts(limit: int = 50, offset: int = 0, current_user: dict = Depends(require_authenticated)):
    """Get all alerts."""
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"http://alert_service:8003/alerts?limit={limit}&offset={offset}")
        resp.raise_for_status()
        return resp.json()


@public_alerts_router.get("/stream")
async def alerts_stream(current_user: dict = Depends(require_authenticated)):
    """Server-sent events for real-time alerts."""
    import httpx
    
    async def event_generator():
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("GET", "http://alert_service:8003/alerts/stream") as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line:
                            yield f"{line}\n\n"
        except Exception as e:
            logger.error(f"Alert stream gateway error: {e}")
            yield f"data: {json.dumps({'error': 'Stream temporarily unavailable', 'retry': True})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "http://localhost:3000",
            "Access-Control-Allow-Credentials": "true",
        }
=======
@alerts_router.get("/export")
async def export_alerts(current_user: dict = Depends(require_authenticated)):
    from main import database
    rows = await database.fetch_all("SELECT * FROM alerts ORDER BY created_at DESC")
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Type", "Source ID", "Severity", "Message", "Status", "Priority", "Created At"])
    for r in rows:
        writer.writerow([r["id"], r["type"], r["source_id"], r["severity"], r["message"], r["status"], r["priority"], r["created_at"]])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=alerts_export.csv"}
>>>>>>> f79aacfd0bc790d68202603431c151319038c798
    )


# ── FinOps Router ─────────────────────────────────────────────
# Protected: finops_manager, cloud_admin, admin
finops_router = APIRouter(prefix="/api/v1/finops", tags=["FinOps"])


@finops_router.get("/summary", response_model=FinOpsSummary)
async def get_finops_summary(current_user: dict = Depends(require_finops)):
    from main import database
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
async def get_cost_trends(current_user: dict = Depends(require_finops)):
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
async def get_top_savings(current_user: dict = Depends(require_finops)):
    from main import database
    rows = await database.fetch_all("""
        SELECT id, message, details, severity, created_at
        FROM alerts
        WHERE type = 'finops' AND status = 'active'
        ORDER BY (details->>'estimated_savings')::float DESC NULLS LAST
        LIMIT 10
    """)
    return [dict(r) for r in rows]


@finops_router.get("/export/logs")
async def export_usage_logs(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: dict = Depends(require_finops)
):
    from main import database
    query = "SELECT * FROM usage_logs WHERE 1=1"
    params = {}
    if start_date:
        query += " AND timestamp >= :start_date"
        params["start_date"] = start_date
    if end_date:
        query += " AND timestamp <= :end_date"
        params["end_date"] = end_date
    
    query += " ORDER BY timestamp DESC"
    rows = await database.fetch_all(query, params)
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Resource ID", "CPU Usage", "Memory Usage", "Cost", "Network In (GB)", "Network Out (GB)", "Timestamp"])
    for r in rows:
        writer.writerow([r["id"], r["resource_id"], r["cpu_usage"], r["memory_usage"], r["cost"], r["network_in_gb"], r["network_out_gb"], r["timestamp"]])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=usage_logs_{datetime.now().strftime('%Y%m%d')}.csv"}
    )


# ── Compliance Router ─────────────────────────────────────────
# Protected: compliance_manager, compliance_officer (legacy), cloud_admin, admin
compliance_router = APIRouter(prefix="/api/v1/compliance", tags=["Compliance"])


@compliance_router.get("/score", response_model=ComplianceScore)
async def get_compliance_score(current_user: dict = Depends(require_compliance)):
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
    current_user: dict = Depends(require_compliance)
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
async def get_rules(current_user: dict = Depends(require_compliance)):
    from main import database
    rows = await database.fetch_all("SELECT * FROM compliance_rules ORDER BY weight DESC")
    return [dict(r) for r in rows]


@compliance_router.get("/export/violations")
async def export_violations(current_user: dict = Depends(require_compliance)):
    from main import database
    query = """
        SELECT v.id, v.severity, v.status, v.created_at, v.details,
               cr.name AS rule_name, r.resource_type, r.region
        FROM violations v
        JOIN compliance_rules cr ON v.rule_id = cr.id
        JOIN resources r ON v.resource_id = r.id
        ORDER BY v.created_at DESC
    """
    rows = await database.fetch_all(query)
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Severity", "Status", "Created At", "Rule Name", "Resource Type", "Region"])
    for r in rows:
        writer.writerow([r["id"], r["severity"], r["status"], r["created_at"], r["rule_name"], r["resource_type"], r["region"]])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=compliance_violations.csv"}
    )


# ── Admin Router ──────────────────────────────────────────────
# Protected: cloud_admin, admin ONLY
admin_router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])


@admin_router.get("/users", response_model=list[UserOut])
async def list_users(current_user: dict = Depends(require_cloud_admin)):
    from main import database
    rows = await database.fetch_all(
        """
        SELECT u.id, u.email, u.role, u.created_at, u.aws_account_id, a.name AS aws_account_name
        FROM users u
        LEFT JOIN aws_accounts a ON u.aws_account_id = a.id
        ORDER BY u.created_at DESC
        """
    )
    return [dict(r) for r in rows]


@admin_router.post("/users")
async def create_user(body: dict, current_user: dict = Depends(require_cloud_admin)):
    from main import database
    import uuid
    from auth import get_password_hash
    email = body.get("email")
    role = body.get("role")
    secret_key = body.get("secret_key")
    
    if not all([email, role, secret_key]):
        raise HTTPException(status_code=400, detail="Missing required fields: email, role, secret_key")
    
    valid_roles = ["admin", "cloud_admin", "finops_manager", "compliance_manager", "it_admin", "viewer"]
    if role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {valid_roles}")
        
    hashed_password = get_password_hash(secret_key)
    
    try:
        await database.execute(
            """INSERT INTO users (id, email, password_hash, role) 
            VALUES (:id, :email, :password_hash, :role)""",
            {"id": str(uuid.uuid4()), "email": email, "password_hash": hashed_password, "role": role}
        )
        return {"message": "User created successfully"}
    except Exception as e:
        logger.error(f"Error creating user: {str(e)}")
        raise HTTPException(status_code=400, detail="Error creating user. Email may already exist.")


@admin_router.get("/stats/by-account", response_model=list[AccountStats])
async def get_account_stats(current_user: dict = Depends(require_cloud_admin)):
    from main import database
    rows = await database.fetch_all("""
        SELECT 
<<<<<<< HEAD
            COALESCE(account_name, 'Unknown Account') as display_name,
            COUNT(resource_id) as resource_count,
            COUNT(resource_id) FILTER (WHERE idle = true) as idle_resources,
            COALESCE(SUM(estimated_cost), 0) as total_cost
        FROM cloud_resources
        GROUP BY COALESCE(account_name, 'Unknown Account')
        ORDER BY total_cost DESC
    """)
    return [
        UserSummaryOut(
            iam_user=r["display_name"],  # Using account name as the label
            resource_count=int(r["resource_count"] or 0),
            idle_resources=int(r["idle_resources"] or 0),
            total_cost=float(r["total_cost"] or 0)
        ) for r in rows
    ]
=======
            a.id AS account_id, 
            a.name AS account_name, 
            a.aws_account_id AS aws_id,
            (SELECT COUNT(*) FROM users u WHERE u.aws_account_id = a.id) AS user_count,
            (SELECT COUNT(*) FROM resources r WHERE r.aws_account_id = a.id) AS resource_count,
            (SELECT COALESCE(SUM(l.cost), 0) FROM usage_logs l JOIN resources r ON l.resource_id = r.id WHERE r.aws_account_id = a.id) AS total_cost
        FROM aws_accounts a
        GROUP BY a.id, a.name, a.aws_account_id
    """)
    return [dict(r) for r in rows]
>>>>>>> f79aacfd0bc790d68202603431c151319038c798


@admin_router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: dict,
    current_user: dict = Depends(require_cloud_admin)
):
    from main import database
    new_role = body.get("role")
    valid_roles = ["admin", "cloud_admin", "finops_manager", "compliance_manager", "it_admin", "viewer"]
    if new_role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {valid_roles}")
    await database.execute(
        "UPDATE users SET role = :role WHERE id = :id",
        {"role": new_role, "id": user_id}
    )
    return {"message": f"User role updated to '{new_role}'"}


@admin_router.get("/resources", response_model=list[ResourceOut])
async def list_resources(current_user: dict = Depends(require_cloud_admin)):
    from main import database
    rows = await database.fetch_all("""
        SELECT r.id, r.cloud_provider, r.resource_type, r.region, r.created_at, 
               a.name AS aws_account_name
        FROM resources r
        LEFT JOIN aws_accounts a ON r.aws_account_id = a.id
        ORDER BY r.created_at DESC
    """)
    return [dict(r) for r in rows]

<<<<<<< HEAD
@admin_router.get("/export/alerts")
async def export_alerts(
    start_date: str = Query(None),
    end_date: str = Query(None),
    current_user: dict = Depends(require_cloud_admin)
):
    """Export system alerts to CSV within a date range."""
    from main import database
    try:
        query = "SELECT severity, type, status, message, created_at FROM alerts WHERE 1=1"
        params = {}
        if start_date:
            query += " AND created_at >= :start"
            params["start"] = datetime.fromisoformat(start_date)
        if end_date:
            query += " AND created_at <= :end"
            # Append 23:59:59 to include the full end day
            params["end"] = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
        query += " ORDER BY created_at DESC"

        rows = await database.fetch_all(query, params)
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Severity", "Type", "Status", "Message", "Timestamp"])
        for r in rows:
            writer.writerow([r["severity"], r["type"], r["status"], r["message"], str(r["created_at"])])
        
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=alerts_export_{datetime.now().strftime('%Y%m%d')}.csv",
                "Access-Control-Allow-Origin": "http://localhost:3000",
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        logger.error(f"Alert export error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@admin_router.get("/export/usage")
async def export_usage(
    start_date: str = Query(None),
    end_date: str = Query(None),
    current_user: dict = Depends(require_cloud_admin)
):
    """Export resource usage logs to CSV within a date range."""
    from main import database
    try:
        # Joining with resources table which has aws_resource_id added from migrations
        query = """
            SELECT r.aws_resource_id, r.resource_type, u.cpu_usage, u.memory_usage, u.cost, u.timestamp 
            FROM usage_logs u
            JOIN resources r ON u.resource_id = r.id
            WHERE 1=1
        """
        params = {}
        if start_date:
            query += " AND u.timestamp >= :start"
            params["start"] = datetime.fromisoformat(start_date)
        if end_date:
            query += " AND u.timestamp <= :end"
            # Append 23:59:59 to include the full end day
            params["end"] = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
        query += " ORDER BY u.timestamp DESC"

        rows = await database.fetch_all(query, params)
        
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["AWS Resource ID", "Type", "CPU Usage (%)", "Memory Usage (%)", "Cost ($)", "Timestamp"])
        for r in rows:
            writer.writerow([
                r["aws_resource_id"] or "N/A", 
                r["resource_type"] or "unknown", 
                r["cpu_usage"], 
                r["memory_usage"], 
                r["cost"], 
                str(r["timestamp"])
            ])
        
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=usage_export_{datetime.now().strftime('%Y%m%d')}.csv",
                "Access-Control-Allow-Origin": "http://localhost:3000",
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        logger.error(f"Usage export error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
=======

@admin_router.get("/export/resources")
async def export_resources(current_user: dict = Depends(require_cloud_admin)):
    from main import database
    rows = await database.fetch_all("SELECT * FROM resources ORDER BY created_at DESC")
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Provider", "Type", "Region", "Tags", "Created At"])
    for r in rows:
        writer.writerow([r["id"], r["cloud_provider"], r["resource_type"], r["region"], json.dumps(r["tags"]), r["created_at"]])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cloud_resources.csv"}
    )


@admin_router.post("/clear-historical-data")
async def clear_historical_data(current_user: dict = Depends(require_cloud_admin)):
    """
    Delete raw historical logs but preserve analytics data.
    
    Deletes:
    - raw_finops_events
    - raw_compliance_logs
    - raw_infrastructure_alerts
    
    Preserves:
    - analytics_cost_trends
    - analytics_violation_summary
    - analytics_resource_metrics
    
    Returns:
        dict with status and counts of deleted records
    """
    from main import database
    
    try:
        logger.info(f"Clearing historical data requested by {current_user.get('email')}")
        
        # Get record counts before deletion
        finops_count = await database.fetch_one(
            "SELECT COUNT(*) as count FROM raw_finops_events"
        )
        compliance_count = await database.fetch_one(
            "SELECT COUNT(*) as count FROM raw_compliance_logs"
        )
        infra_count = await database.fetch_one(
            "SELECT COUNT(*) as count FROM raw_infrastructure_alerts"
        )
        
        # Delete raw data tables
        deletions = {
            'raw_finops_events': await database.execute("DELETE FROM raw_finops_events"),
            'raw_compliance_logs': await database.execute("DELETE FROM raw_compliance_logs"),
            'raw_infrastructure_alerts': await database.execute("DELETE FROM raw_infrastructure_alerts"),
        }
        
        logger.info(
            f"Historical data cleared. Deleted: "
            f"finops_events={finops_count.get('count', 0)}, "
            f"compliance_logs={compliance_count.get('count', 0)}, "
            f"infra_alerts={infra_count.get('count', 0)} by {current_user.get('email')}"
        )
        
        return {
            "status": "success",
            "message": "Historical logs cleared successfully. Analytics summaries preserved.",
            "deleted_records": {
                "raw_finops_events": finops_count.get('count', 0),
                "raw_compliance_logs": compliance_count.get('count', 0),
                "raw_infrastructure_alerts": infra_count.get('count', 0)
            },
            "deleted_at": datetime.now().isoformat(),
            "cleared_by": current_user.get('email')
        }
    except Exception as e:
        logger.error(f"Error clearing historical data: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to clear historical data"
        )


# ── Analytics Router ──────────────────────────────────────────
analytics_router = APIRouter(prefix="/api/v1/analytics", tags=["Analytics"])


@analytics_router.get("/cost-trend")
async def get_cost_trend(current_user: dict = Depends(require_cloud_admin)):
    """
    Get cost trend data from analytics_cost_trends table.
    Returns: list of {date, cost}
    """
    from main import database
    
    try:
        rows = await database.fetch_all(
            "SELECT date, cost FROM analytics_cost_trends ORDER BY date ASC"
        )
        return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Error fetching cost trend: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch cost trend data")


@analytics_router.get("/compliance-summary")
async def get_compliance_summary(current_user: dict = Depends(require_cloud_admin)):
    """
    Get compliance summary data from analytics_violation_summary table.
    Returns: list of {category, compliance_percentage}
    """
    from main import database
    
    try:
        rows = await database.fetch_all(
            "SELECT category, compliance_percentage FROM analytics_violation_summary"
        )
        return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Error fetching compliance summary: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch compliance summary data")


@analytics_router.get("/resource-metrics")
async def get_resource_metrics(current_user: dict = Depends(require_cloud_admin)):
    """
    Get resource metrics data from analytics_resource_metrics table.
    Returns: list of {date, idle_count}
    """
    from main import database
    
    try:
        rows = await database.fetch_all(
            "SELECT date, idle_count FROM analytics_resource_metrics ORDER BY date ASC"
        )
        return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Error fetching resource metrics: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch resource metrics data")
>>>>>>> f79aacfd0bc790d68202603431c151319038c798
