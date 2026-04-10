import os
import json
import asyncio
import logging
import operator
from datetime import datetime
from typing import Optional, Any
from databases import Database
import httpx
from fastapi import FastAPI
import uvicorn

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "compliance_engine", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
ALERT_SERVICE_URL = os.getenv("ALERT_SERVICE_URL", "http://alert_service:8003")

# ─── Rule Evaluation Engine ───────────────────────────────────

OPERATORS = {
    "equals": operator.eq,
    "not_equals": operator.ne,
    "greater_than": operator.gt,
    "less_than": operator.lt,
    "greater_than_or_equals": operator.ge,
    "less_than_or_equals": operator.le,
    "contains": lambda a, b: b in a if a else False,
    "not_contains": lambda a, b: b not in a if a else True,
}

SEVERITY_MAP = {
    (0, 10): "low",
    (10, 20): "medium",
    (20, 30): "high",
    (30, float("inf")): "critical",
}


def get_severity_for_weight(weight: int) -> str:
    for (lo, hi), sev in SEVERITY_MAP.items():
        if lo <= weight < hi:
            return sev
    return "high"


def evaluate_rule(rule: dict, log: dict) -> bool:
    """
    Evaluate a single JSON rule against a log entry.
    Returns True if the rule is VIOLATED (i.e., log does not comply).
    """
    condition = rule.get("condition_json") or {}
    if isinstance(condition, str):
        condition = json.loads(condition)

    field = condition.get("field")
    op_name = condition.get("operator")
    expected = condition.get("value")

    if field is None or op_name is None:
        return False

    actual = log.get(field)
    if actual is None:
        return False  # Field not present → cannot evaluate

    op_fn = OPERATORS.get(op_name)
    if not op_fn:
        logger.warning(f"Unknown operator: {op_name}")
        return False

    try:
        compliant = op_fn(actual, expected)
        return not compliant  # Violated if NOT compliant
    except Exception as e:
        logger.error(f"Rule evaluation error for field '{field}': {e}")
        return False


def calculate_score(rules: list[dict], violated_ids: set) -> float:
    """
    score = 100 - (sum of violated weights / total weight * 100)
    """
    total_weight = sum(r["weight"] for r in rules)
    violated_weight = sum(r["weight"] for r in rules if str(r["id"]) in violated_ids)
    if total_weight == 0:
        return 100.0
    return max(0.0, 100.0 - (violated_weight / total_weight * 100.0))


# ─── DB & Alert Helpers ───────────────────────────────────────

async def get_active_rules(db: Database) -> list[dict]:
    rows = await db.fetch_all(
        "SELECT id, name, description, weight, condition_json, category FROM compliance_rules WHERE active = true"
    )
    return [dict(r) for r in rows]


async def get_or_create_resource(db: Database, resource_id: str) -> str:
    row = await db.fetch_one("SELECT id FROM resources WHERE id = :id", {"id": resource_id})
    if not row:
        await db.execute("""
            INSERT INTO resources (id, cloud_provider, resource_type, region)
            VALUES (:id, 'aws', 'ec2', 'us-east-1')
            ON CONFLICT (id) DO NOTHING
        """, {"id": resource_id})
    return resource_id


async def record_violation(db: Database, resource_id: str, rule: dict, log: dict):
    severity = get_severity_for_weight(rule["weight"])
    await db.execute("""
        INSERT INTO violations (resource_id, rule_id, severity, status, details)
        VALUES (:resource_id, :rule_id, :severity, 'open', :details)
        ON CONFLICT DO NOTHING
    """, {
        "resource_id": resource_id,
        "rule_id": str(rule["id"]),
        "severity": severity,
        "details": json.dumps({
            "rule_name": rule["name"],
            "category": rule.get("category"),
            "log_snapshot": {k: v for k, v in log.items() if k in [
                "cpu_usage", "memory_usage", "cost", "public_access",
                "encryption_at_rest", "mfa_enabled", "logging_enabled"
            ]},
        }),
    })
    return severity


async def publish_alert(client: httpx.AsyncClient, resource_id: str, rule: dict, severity: str, score: float, iam_user: str = None):
    payload = {
        "type": "compliance",
        "source_id": resource_id,
        "severity": severity,
        "message": f"[Compliance] Rule violated: '{rule['name']}' on resource {resource_id}",
        "details": {
            "rule_name": rule["name"],
            "rule_description": rule.get("description"),
            "category": rule.get("category"),
            "weight": rule["weight"],
            "compliance_score": round(score, 1),
        },
        "iam_user": iam_user,
    }
    try:
        resp = await client.post(f"{ALERT_SERVICE_URL}/internal/alerts", json=payload, timeout=5)
        resp.raise_for_status()
    except Exception as e:
        logger.error(f"Failed to publish compliance alert: {e}")


# ─── Core Processing ──────────────────────────────────────────

async def process_log(db: Database, client: httpx.AsyncClient, rules: list[dict], log: dict):
    resource_id = log.get("resource_id")
    if not resource_id:
        return

    await get_or_create_resource(db, resource_id)

    # Extract IAM user for alert routing
    iam_user = log.get("ingested_by") or log.get("iam_user") or log.get("user")

    violated_ids = set()
    for rule in rules:
        is_violated = evaluate_rule(rule, log)
        if is_violated:
            severity = await record_violation(db, resource_id, rule, log)
            violated_ids.add(str(rule["id"]))
            score = calculate_score(rules, violated_ids)
            await publish_alert(client, resource_id, rule, severity, score, iam_user=iam_user)
            logger.info(f"Violation: '{rule['name']}' resource={resource_id} severity={severity}")

    if violated_ids:
        score = calculate_score(rules, violated_ids)
        logger.info(f"Resource {resource_id}: {len(violated_ids)} violations, score={score:.1f}")


# ─── Main Consumer Loop ───────────────────────────────────────

# ─── Health check server ──────────────────────────────────────
health_app = FastAPI()


@health_app.get("/health")
async def health():
    return {"status": "ok", "service": "compliance_engine"}


async def run_health_server():
    config = uvicorn.Config(health_app, host="0.0.0.0", port=8002, log_level="error")
    server = uvicorn.Server(config)
    await server.serve()


async def main():
    logger.info("Compliance Engine starting...")
    # Start health check server in background
    asyncio.create_task(run_health_server())

    db = Database(DATABASE_URL)
    await db.connect()

    # Cache rules in memory (refresh every 60s)
    rules = await get_active_rules(db)
    rules_refreshed_at = datetime.utcnow()

    async with httpx.AsyncClient() as client:
        logger.info(f"Loaded {len(rules)} compliance rules. Polling incoming_logs in PostgreSQL...")
        while True:
            try:
                # Refresh rules every 60 seconds
                if (datetime.utcnow() - rules_refreshed_at).seconds > 60:
                    rules = await get_active_rules(db)
                    rules_refreshed_at = datetime.utcnow()
                    logger.info(f"Rules refreshed: {len(rules)} active rules")

                rows = await db.fetch_all("SELECT id, log_data FROM incoming_logs WHERE processed_compliance = false LIMIT 100")
                if not rows:
                    await asyncio.sleep(2)
                    continue

                for row in rows:
                    try:
                        if isinstance(row["log_data"], str):
                            log = json.loads(row["log_data"])
                        else:
                            log = row["log_data"]
                            
                        await process_log(db, client, rules, log)
                        await db.execute("UPDATE incoming_logs SET processed_compliance = true WHERE id = :id", {"id": row["id"]})
                    except Exception as e:
                        logger.error(f"Error processing log {row['id']}: {e}")
            except Exception as e:
                logger.error(f"PostgreSQL polling error: {e}")
                await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main())
