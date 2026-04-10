import os
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from databases import Database
from auth import (
    get_current_user, verify_password, create_access_token,
    require_authenticated, require_finops, require_compliance,
    require_it_admin, require_cloud_admin
)
from models import (
    LoginRequest, TokenResponse, LogBatch, IngestResponse,
    AlertOut, FinOpsSummary, ComplianceScore, UserOut,
    UserActivityOut, ThresholdCreate, ThresholdOut, UserCostOut
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

