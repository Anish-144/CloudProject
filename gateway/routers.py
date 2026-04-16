import os
import json
import logging
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
    AlertOut, FinOpsSummary, ComplianceScore, UserOut,
    UserActivityOut, ThresholdCreate, ThresholdOut, UserCostOut,
    AdminOverview, AdminResource, UserSummaryOut, FinOpsResourceSummaryOut, ComplianceSummaryOut
)
from datetime import datetime
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
    from main import database
    query = """
        INSERT INTO incoming_logs (log_data) VALUES (:log_data)
    """
    values = []
    for log in batch.logs:
        entry = log.model_dump()
        entry["ingested_by"] = current_user["email"]
        entry["ingested_at"] = datetime.utcnow().isoformat()
        values.append({"log_data": json.dumps(entry, default=str)})

    if values:
        await database.execute_many(query=query, values=values)
    logger.info(f"Ingested {len(batch.logs)} logs from {current_user['email']}")
    return IngestResponse(accepted=len(batch.logs), message="Logs queued for processing")


# ── Alerts Router ─────────────────────────────────────────────
# Role-based: users only see alerts targeted at their role
alerts_router = APIRouter(prefix="/api/v1/alerts", tags=["Alerts"])

# Maps platform roles to what alert target_roles they can see
ROLE_ALERT_ACCESS = {
    "admin": None,              # sees all
    "cloud_admin": None,        # sees all
    "finops_manager": "finops_manager",
    "compliance_manager": "compliance_manager",
    "it_admin": "it_admin",
    "viewer": "viewer",
}


@alerts_router.get("", response_model=list[AlertOut])
async def get_alerts(
    severity: str = None,
    alert_status: str = None,
    alert_type: str = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(require_authenticated)
):
    from main import database
    user_role = current_user["role"]
    role_filter = ROLE_ALERT_ACCESS.get(user_role)

    query = "SELECT * FROM alerts WHERE 1=1"
    params = {}

    # Role-based filtering: non-admin users only see alerts targeted at their role
    if role_filter is not None:
        query += " AND :user_role = ANY(target_roles)"
        params["user_role"] = role_filter

    if severity:
        query += " AND severity = :severity"
        params["severity"] = severity
    if alert_status:
        query += " AND status = :status"
        params["status"] = alert_status
    if alert_type:
        query += " AND type = :type"
        params["type"] = alert_type
    query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
    params["limit"] = limit
    params["offset"] = offset
    rows = await database.fetch_all(query, params)
    return [dict(r) for r in rows]


@alerts_router.patch("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, current_user: dict = Depends(require_authenticated)):
    from main import database
    await database.execute(
        "UPDATE alerts SET status = 'acknowledged' WHERE id = :id",
        {"id": alert_id}
    )
    return {"message": "Alert acknowledged"}


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


@finops_router.get("/resource-summary", response_model=FinOpsResourceSummaryOut)
async def get_finops_resource_summary(current_user: dict = Depends(require_finops)):
    from main import database
    row = await database.fetch_one("""
        SELECT
            COALESCE(SUM(estimated_cost), 0) AS total_cost,
            COALESCE(SUM(estimated_cost) FILTER (WHERE idle = true), 0) AS idle_cost
        FROM cloud_resources
    """)
    idle_cost = float(row["idle_cost"] or 0)
    return FinOpsResourceSummaryOut(
        total_cost=float(row["total_cost"] or 0),
        idle_cost=idle_cost,
        potential_savings=idle_cost
    )


@finops_router.get("/user-costs", response_model=list[UserCostOut])
async def get_user_costs(current_user: dict = Depends(require_finops)):
    """Per-user cost breakdown computed from user_activity_logs + usage_logs."""
    from main import database
    rows = await database.fetch_all("""
        SELECT
            ual.iam_user,
            COALESCE(SUM(ul.cost), 0) AS total_cost_30d,
            COUNT(DISTINCT ul.resource_id) AS resource_count,
            COALESCE(AVG(ul.cost), 0) AS avg_daily_cost
        FROM user_activity_logs ual
        LEFT JOIN usage_logs ul
            ON ul.resource_id::text = ual.resource_id
            AND ul.timestamp > NOW() - INTERVAL '30 days'
        GROUP BY ual.iam_user
        ORDER BY total_cost_30d DESC
    """)
    return [
        UserCostOut(
            iam_user=r["iam_user"],
            total_cost_30d=round(float(r["total_cost_30d"]), 2),
            resource_count=int(r["resource_count"]),
            avg_daily_cost=round(float(r["avg_daily_cost"]), 4),
        )
        for r in rows
    ]


# ── User Activity Router ─────────────────────────────────────
# Accessible by IT Admin, Cloud Admin, Admin
activity_router = APIRouter(prefix="/api/v1/users", tags=["User Activity"])


@activity_router.get("/activity", response_model=list[UserActivityOut])
async def get_user_activity(
    iam_user: str = None,
    service: str = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    current_user: dict = Depends(require_it_admin)
):
    """Return IAM user activity logs, filterable by user and service."""
    from main import database
    query = "SELECT * FROM user_activity_logs WHERE 1=1"
    params = {}
    if iam_user:
        query += " AND iam_user = :iam_user"
        params["iam_user"] = iam_user
    if service:
        query += " AND service = :service"
        params["service"] = service
    query += " ORDER BY event_time DESC LIMIT :limit OFFSET :offset"
    params["limit"] = limit
    params["offset"] = offset
    rows = await database.fetch_all(query, params)
    return [dict(r) for r in rows]


@activity_router.get("/activity/summary")
async def get_user_activity_summary(
    current_user: dict = Depends(require_it_admin)
):
    """Return activity counts grouped by IAM user."""
    from main import database
    rows = await database.fetch_all("""
        SELECT
            iam_user,
            COUNT(*) AS total_events,
            COUNT(DISTINCT service) AS services_used,
            COUNT(DISTINCT resource_id) AS resources_touched,
            MAX(event_time) AS last_activity
        FROM user_activity_logs
        GROUP BY iam_user
        ORDER BY total_events DESC
    """)
    return [dict(r) for r in rows]


# ── Threshold Router ─────────────────────────────────────────
# IT Admin manages thresholds
threshold_router = APIRouter(prefix="/api/v1/thresholds", tags=["Thresholds"])


@threshold_router.get("", response_model=list[ThresholdOut])
async def list_thresholds(current_user: dict = Depends(require_it_admin)):
    from main import database
    rows = await database.fetch_all(
        "SELECT * FROM thresholds WHERE active = true ORDER BY created_at DESC"
    )
    return [dict(r) for r in rows]


@threshold_router.post("", response_model=ThresholdOut)
async def create_threshold(body: ThresholdCreate, current_user: dict = Depends(require_it_admin)):
    from main import database
    row_id = await database.execute("""
        INSERT INTO thresholds (type, metric, value, iam_user, description, created_by)
        VALUES (:type, :metric, :value, :iam_user, :description, :created_by)
        RETURNING id
    """, {
        "type": body.type,
        "metric": body.metric,
        "value": body.value,
        "iam_user": body.iam_user,
        "description": body.description,
        "created_by": current_user.get("user_id"),
    })
    row = await database.fetch_one("SELECT * FROM thresholds WHERE id = :id", {"id": row_id})
    return dict(row)


@threshold_router.delete("/{threshold_id}")
async def deactivate_threshold(threshold_id: str, current_user: dict = Depends(require_it_admin)):
    from main import database
    await database.execute(
        "UPDATE thresholds SET active = false WHERE id = :id",
        {"id": threshold_id}
    )
    return {"message": "Threshold deactivated"}


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


@compliance_router.get("/summary", response_model=ComplianceSummaryOut)
async def get_compliance_summary(current_user: dict = Depends(require_compliance)):
    from main import database
    row = await database.fetch_one("""
        SELECT COUNT(DISTINCT resource_id) as risky_users
        FROM alerts 
        WHERE message ILIKE '%AdministratorAccess attached%' OR message ILIKE '%overly permissive wildcard policies%'
    """)
    risky_users = int(row["risky_users"] or 0)
    
    alerts_count = await database.fetch_one("SELECT COUNT(*) FROM alerts WHERE message ILIKE '%MFA%' OR message ILIKE '%AdministratorAccess%' OR type='compliance'")
    policy_issues = int(alerts_count["count"] or 0)
    
    recommendations = []
    if risky_users > 0:
        recommendations.append("Revoke AdministratorAccess and overly permissive wildcard policies from identified risky IAM users.")
    if policy_issues > 0:
        recommendations.append("Ensure MFA is enabled and root keys are rotated or deleted.")
    if not recommendations:
        recommendations.append("No high-priority recommendations at this time.")
        
    return ComplianceSummaryOut(
        risky_users=risky_users,
        policy_issues=policy_issues,
        recommendations=recommendations
    )


# ── Admin Router ──────────────────────────────────────────────
# Protected: cloud_admin, admin ONLY
admin_router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])


@admin_router.get("/users", response_model=list[UserOut])
async def list_users(current_user: dict = Depends(require_cloud_admin)):
    from main import database
    rows = await database.fetch_all(
        "SELECT id, email, role, created_at FROM users ORDER BY created_at DESC"
    )
    return [dict(r) for r in rows]


@admin_router.get("/user-summary", response_model=list[UserSummaryOut])
async def get_user_summary(current_user: dict = Depends(require_cloud_admin)):
    from main import database
    rows = await database.fetch_all("""
        SELECT 
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


@admin_router.get("/overview", response_model=AdminOverview)
async def get_admin_overview(current_user: dict = Depends(require_cloud_admin)):
    """High-level resource summary for Cloud Admin dashboard."""
    from main import database

    # Aggregate from cloud_resources table
    agg = await database.fetch_one("""
        SELECT
            COUNT(*)                                            AS total_resources,
            COUNT(*) FILTER (WHERE state NOT IN ('stopped','inactive') AND idle = false) AS running_resources,
            COUNT(*) FILTER (WHERE idle = true)                AS idle_resources,
            COALESCE(SUM(estimated_cost) FILTER (WHERE idle = true), 0) AS estimated_savings
        FROM cloud_resources
    """)

    # Compliance score (reuse existing logic)
    rules = await database.fetch_one(
        "SELECT COUNT(*) AS total, SUM(weight) AS total_weight FROM compliance_rules WHERE active = true"
    )
    violations = await database.fetch_all("""
        SELECT cr.weight
        FROM violations v
        JOIN compliance_rules cr ON v.rule_id = cr.id
        WHERE v.status = 'open'
    """)
    total_weight   = float(rules["total_weight"] or 100)
    violated_weight = sum(float(v["weight"]) for v in violations)
    compliance_score = max(0, 100 - (violated_weight / total_weight * 100)) if total_weight > 0 else 100.0

    return AdminOverview(
        total_resources   = int(agg["total_resources"] or 0),
        running_resources = int(agg["running_resources"] or 0),
        idle_resources    = int(agg["idle_resources"] or 0),
        estimated_savings = round(float(agg["estimated_savings"] or 0), 2),
        compliance_score  = round(compliance_score, 1),
    )


@admin_router.get("/resources", response_model=list[AdminResource])
async def get_admin_resources(
    resource_type: str = None,
    idle_only: bool = False,
    limit: int = 200,
    current_user: dict = Depends(require_cloud_admin)
):
    """Full resource list with idle flags and cost recommendations."""
    from main import database

    query  = "SELECT * FROM cloud_resources WHERE 1=1"
    params = {}

    if resource_type:
        query += " AND type = :type"
        params["type"] = resource_type.lower()

    if idle_only:
        query += " AND idle = true"

    query += " ORDER BY idle DESC, estimated_cost DESC LIMIT :limit"
    params["limit"] = limit

    rows = await database.fetch_all(query, params)
    return [dict(r) for r in rows]

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
