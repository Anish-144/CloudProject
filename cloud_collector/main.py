"""
CloudGuard Cloud Data Collector — Main Orchestrator

Coordinates all Boto3 collectors (EC2, CloudWatch, S3, Lambda, IAM) for a
single AWS account using default credentials.

Flow:
  1. Create boto3 session with default credentials
  2. Run collectors (EC2, S3, Lambda, IAM)
  3. Store results in PostgreSQL via incoming_logs table
  4. Upsert cloud_resources table with idle flags + recommendations
  5. Publish Redis alerts when resources become idle

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
import redis as redis_sync
from fastapi import FastAPI
from datetime import datetime, timezone, timedelta
from dateutil.parser import isoparse
from typing import Optional

from databases import Database
import boto3
from botocore.exceptions import ClientError, NoCredentialsError

from collectors import EC2Collector, CloudWatchCollector, S3Collector, IAMCollector, LambdaCollector

# ── Logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "cloud_collector", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────
DATABASE_URL       = os.getenv("DATABASE_URL")
ALERT_SERVICE_URL  = os.getenv("ALERT_SERVICE_URL", "http://alert_service:8003")
REDIS_URL          = os.getenv("REDIS_URL", "redis://redis:6379")
AWS_REGION         = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
DATA_SOURCE_MODE   = os.getenv("DATA_SOURCE_MODE", "hybrid")

# Polling intervals (seconds)
EC2_INTERVAL    = int(os.getenv("COLLECTOR_EC2_INTERVAL",    "60"))   # 1 min
S3_INTERVAL     = int(os.getenv("COLLECTOR_S3_INTERVAL",     "60"))   # 1 min
LAMBDA_INTERVAL = int(os.getenv("COLLECTOR_LAMBDA_INTERVAL", "60"))   # 1 min
IAM_INTERVAL    = int(os.getenv("COLLECTOR_IAM_INTERVAL",    "60"))   # 1 min

USE_STS = False

# ── FinOps Idle Thresholds ────────────────────────────────────
EC2_IDLE_CPU_THRESHOLD    = float(os.getenv("EC2_IDLE_CPU_PCT",     "5.0"))
S3_IDLE_DAYS              = int(os.getenv("S3_IDLE_DAYS",            "30"))
LAMBDA_IDLE_DAYS          = int(os.getenv("LAMBDA_IDLE_DAYS",        "7"))


# ── Database Helpers ──────────────────────────────────────────

async def load_active_accounts(db: Database) -> list:
    rows = await db.fetch_all("""
        SELECT id, account_name, account_id, role_arn, external_id, regions, is_active
        FROM aws_accounts
        WHERE is_active = true
        ORDER BY account_name
    """)
    accounts = []
    for row in rows:
        accounts.append({
            "id":           str(row["id"]),
            "account_name": row["account_name"],
            "account_id":   row["account_id"],
            "role_arn":     row["role_arn"],
            "external_id":  row["external_id"],
            "regions":      row["regions"] or [AWS_REGION],
        })
    logger.info(f"Loaded {len(accounts)} active AWS accounts from database")
    return accounts


async def update_account_status(db: Database, account_db_id: str, status: str, error: Optional[str] = None):
    await db.execute("""
        UPDATE aws_accounts
        SET scan_status = :status,
            last_scanned = CASE WHEN :status = 'success' THEN NOW() ELSE last_scanned END,
            error_message = :error
        WHERE id = :id
    """, {"status": status, "error": error, "id": account_db_id})


async def upsert_aws_resource(db: Database, resource: dict, account_db_id: Optional[str] = None) -> str:
    """Insert or update an AWS resource record and return the UUID from the resources table."""
    aws_id        = resource["aws_resource_id"]
    resource_type = resource["resource_type"]
    region        = resource.get("region", AWS_REGION)
    status        = resource.get("status", "unknown")
    metadata      = json.dumps(resource.get("metadata", {}))

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

    # Ensure a record in the main resources table
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


# ── cloud_resources UPSERT (FinOps unified table) ─────────────

async def upsert_cloud_resource(db: Database, entry: dict):
    """Write to the cloud_resources table — the source for /admin/resources."""
    last_activity = entry.get("last_activity")
    if isinstance(last_activity, str):
        try:
            last_activity = isoparse(last_activity)
        except Exception:
            last_activity = None

    iam_user = entry.get("iam_user")
    if not iam_user:
        iam_user = "unknown"

    account_name = entry.get("account_name") or "Unknown"

    await db.execute("""
        INSERT INTO cloud_resources
            (resource_id, type, name, state, region, cpu, size_mb,
             last_activity, estimated_cost, idle, recommendation, iam_user, ownership_source, last_updated, last_seen, account_name)
        VALUES
            (:resource_id, :type, :name, :state, :region, :cpu, :size_mb,
             :last_activity, :estimated_cost, :idle, :recommendation, :iam_user, :ownership_source, NOW(), NOW(), :acct_name)
        ON CONFLICT (resource_id) DO UPDATE SET
            type           = EXCLUDED.type,
            name           = EXCLUDED.name,
            state          = EXCLUDED.state,
            region         = EXCLUDED.region,
            cpu            = EXCLUDED.cpu,
            size_mb        = EXCLUDED.size_mb,
            last_activity  = EXCLUDED.last_activity,
            estimated_cost = EXCLUDED.estimated_cost,
            idle           = EXCLUDED.idle,
            recommendation = EXCLUDED.recommendation,
            iam_user       = EXCLUDED.iam_user,
            ownership_source = EXCLUDED.ownership_source,
            last_updated   = NOW(),
            last_seen      = NOW(),
            account_name   = EXCLUDED.account_name
    """, {
        "resource_id":    entry["resource_id"],
        "type":           entry["type"],
        "name":           entry.get("name", entry["resource_id"]),
        "state":          entry.get("state", "unknown"),
        "region":         entry.get("region", AWS_REGION),
        "cpu":            entry.get("cpu"),
        "size_mb":        entry.get("size_mb"),
        "last_activity":  last_activity,
        "estimated_cost": entry.get("estimated_cost", 0.0),
        "idle":           entry.get("idle", False),
        "recommendation": entry.get("recommendation"),
        "iam_user":       iam_user,
        "ownership_source": entry.get("ownership_source", "credentials"),
        "acct_name":      account_name,
    })


# ── Redis Alert Publisher ──────────────────────────────────────

def publish_idle_alert(redis_client, resource_id: str, resource_type: str,
                       severity: str, message: str, recommendation: str):
    """Publish an idle-resource alert to Redis so SSE consumers receive it."""
    try:
        payload = {
            "severity":       severity,
            "type":           "FINOPS",
            "resource_id":    resource_id,
            "resource_type":  resource_type,
            "message":        message,
            "recommendation": recommendation,
            "timestamp":      datetime.now(timezone.utc).isoformat(),
        }
        redis_client.publish("alerts_stream", json.dumps(payload))
        logger.info(f"Idle alert published: {message[:80]}")
    except Exception as e:
        logger.error(f"Failed to publish idle alert: {e}")


# ── Ensure datetime helper ────────────────────────────────────

def ensure_datetime(val) -> datetime:
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


# ── Data Refresh & CloudTrail Helpers ─────────────────────────

def get_cloudtrail_mapping(session, region: str) -> dict:
    """Fetch recent AWS CloudTrail events to map resources to IAM users."""
    mapping = {}
    try:
        client = session.client('cloudtrail', region_name=region)
        events_to_check = ['RunInstances', 'CreateBucket', 'CreateFunction20150331']
        for event_name in events_to_check:
            try:
                paginator = client.get_paginator('lookup_events')
                for page in paginator.paginate(LookupAttributes=[{'AttributeKey': 'EventName', 'AttributeValue': event_name}]):
                    for event in page.get('Events', []):
                        try:
                            cloud_event = json.loads(event.get('CloudTrailEvent', '{}'))
                            username = cloud_event.get('userIdentity', {}).get('userName')
                            if not username:
                                username = cloud_event.get('userIdentity', {}).get('sessionContext', {}).get('sessionIssuer', {}).get('userName')
                            if not username:
                                continue
                            
                            if event_name == "RunInstances":
                                items = cloud_event.get('responseElements', {}).get('instancesSet', {}).get('items', [])
                                for i in items:
                                    mapping[i.get('instanceId')] = username
                            elif event_name == "CreateBucket":
                                bucket = cloud_event.get('requestParameters', {}).get('bucketName')
                                if bucket: 
                                    mapping[bucket] = username
                            elif event_name == "CreateFunction20150331":
                                func = cloud_event.get('requestParameters', {}).get('functionName')
                                if func: 
                                    mapping[func] = username
                        except Exception:
                            pass
                    break  # Only inspect latest page
            except Exception as e:
                logger.debug(f"CloudTrail lookup failed for {event_name}: {e}")
    except Exception as e:
        logger.error(f"CloudTrail client failed: {e}")
    
    return mapping

async def clean_stale_resources(db: Database, resource_type: str):
    """Remove inactive resources that have not been seen in the recent scan (within ~10 mins)."""
    try:
        # 1. Clean cloud_resources (FinOps Dashboard source)
        q1 = "DELETE FROM cloud_resources WHERE type = :type AND last_seen < NOW() - INTERVAL '10 minutes'"
        await db.execute(q1, {"type": resource_type})
        
        # 2. Clean aws_resources (Primary Boto3 Sync table)
        q2 = "DELETE FROM aws_resources WHERE resource_type = :type AND last_seen < NOW() - INTERVAL '10 minutes'"
        await db.execute(q2, {"type": resource_type})

        # 3. Clean orphaned records in the general 'resources' table 
        # (This avoids dangling IDs that no longer exist in AWS)
        q3 = """
            DELETE FROM resources 
            WHERE cloud_provider = 'aws' 
              AND resource_type = :type 
              AND id NOT IN (SELECT resource_id FROM aws_resources WHERE resource_id IS NOT NULL)
        """
        await db.execute(q3, {"type": resource_type})
        
        logger.info(f"Cleaned stale resources for {resource_type} (10min threshold)")
    except Exception as e:
        logger.error(f"Failed to clean stale resources for {resource_type}: {e}")

# ── Metric + Compliance Helpers ───────────────────────────────
async def store_aws_metric(db: Database, metric: dict):
    ts = ensure_datetime(metric.get("timestamp"))
    await db.execute("""
        INSERT INTO aws_metrics (aws_resource_id, metric_name, metric_value, unit, timestamp)
        VALUES (:aws_id, :name, :value, :unit, :ts)
        ON CONFLICT (aws_resource_id, metric_name, timestamp) DO UPDATE SET
            metric_value = EXCLUDED.metric_value
    """, {
        "aws_id": metric["aws_resource_id"],
        "name":   metric.get("metric_name", "CPUUtilization"),
        "value":  metric.get("metric_value", 0),
        "unit":   metric.get("unit", "Percent"),
        "ts":     ts,
    })


async def store_compliance_check(db: Database, check: dict):
    await db.execute("""
        INSERT INTO aws_compliance_checks (aws_resource_id, check_type, check_passed, details)
        VALUES (:aws_id, :check_type, :passed, :details)
    """, {
        "aws_id":     check["aws_resource_id"],
        "check_type": check["check_type"],
        "passed":     check["check_passed"],
        "details":    json.dumps(check.get("details", {})),
    })


async def publish_log_entry(db: Database, log_entry: dict):
    log_entry["data_source"] = "aws_live"
    log_entry["timestamp"]   = log_entry.get("timestamp", datetime.now(timezone.utc).isoformat())
    await db.execute(
        "INSERT INTO incoming_logs (log_data) VALUES (:log_data)",
        {"log_data": json.dumps(log_entry, default=str)}
    )


async def publish_critical_alert(http_client: httpx.AsyncClient, resource_id: str,
                                  message: str, details: dict):
    details["aws_resource_id"] = resource_id
    payload = {
        "type":      "compliance",
        "source_id": None,
        "severity":  "critical",
        "message":   message,
        "details":   details,
    }
    try:
        resp = await http_client.post(f"{ALERT_SERVICE_URL}/internal/alerts", json=payload, timeout=5)
        resp.raise_for_status()
        logger.info(f"Critical alert sent: {message[:80]}")
    except Exception as e:
        logger.error(f"Failed to send critical alert: {e}")


# ── EC2 + CloudWatch Collection ───────────────────────────────

async def collect_ec2_and_cloudwatch(
    db: Database, redis_client, http_client: httpx.AsyncClient,
    cloudtrail_mapping: dict,
    session, region: str, account_name: str, account_db_id: Optional[str] = None
):
    logger.info(f"═══ EC2+CW: {account_name} / {region} ═══")
    ec2 = EC2Collector(region=region, session=session)
    cw  = CloudWatchCollector(region=region, session=session)

    instances = ec2.collect()
    if not instances:
        logger.warning(f"No EC2 instances found in {account_name}/{region}")
        await clean_stale_resources(db, "ec2")
        return

    running_ids = [i["aws_resource_id"] for i in instances if i["status"] == "running"]
    cw_metrics  = {}
    if running_ids:
        for m in cw.collect_for_instances(running_ids):
            cw_metrics[m["aws_resource_id"]] = m

    for inst in instances:
        instance_id   = inst["aws_resource_id"]
        resource_uuid = await upsert_aws_resource(db, inst, account_db_id)

        metrics  = cw_metrics.get(instance_id, {})
        cpu_avg  = metrics.get("cpu_avg", 0.0) or 0.0
        net_in   = metrics.get("network_in_bytes", 0) or 0
        net_out  = metrics.get("network_out_bytes", 0) or 0

        if metrics:
            await store_aws_metric(db, {
                "aws_resource_id": instance_id,
                "metric_name":     "CPUUtilization",
                "metric_value":    cpu_avg,
                "unit":            "Percent",
                "timestamp":       metrics.get("timestamp", datetime.now(timezone.utc).isoformat()),
            })

        daily_cost = ec2.get_estimated_daily_cost(
            inst.get("instance_type", "t2.micro"),
            inst.get("status", "stopped")
        )

        # ── FinOps idle detection ──────────────────────────────
        is_running = (inst.get("status") == "running")
        idle       = is_running and (cpu_avg < EC2_IDLE_CPU_THRESHOLD)
        recommendation = (
            f"Stop instance (CPU avg {cpu_avg:.1f}% < {EC2_IDLE_CPU_THRESHOLD}%). "
            f"Estimated savings: ${daily_cost * 30:.2f}/month"
            if idle else None
        )

        # ── Write to cloud_resources ───────────────────────────
        tags = inst.get("metadata", {}).get("tags", {})
        tag_user = tags.get("Owner") or tags.get("iam_user")
        
        iam_user = None
        ownership_source = "credentials"
        
        if instance_id in cloudtrail_mapping:
            iam_user = cloudtrail_mapping[instance_id]
            ownership_source = "cloudtrail"
        elif tag_user:
            iam_user = tag_user
            ownership_source = "tag"
        else:
            iam_user = "unknown"

        await upsert_cloud_resource(db, {
            "resource_id":    instance_id,
            "type":           "ec2",
            "name":           instance_id,
            "state":          inst.get("status", "unknown"),
            "region":         region,
            "cpu":            round(cpu_avg, 2),
            "size_mb":        None,
            "last_activity":  datetime.now(timezone.utc).isoformat(),
            "estimated_cost": round(daily_cost * 30, 2),
            "idle":           idle,
            "recommendation": recommendation,
            "iam_user":       iam_user,
            "ownership_source": ownership_source,
            "account_name":   account_name,
        })

        if idle and redis_client:
            publish_idle_alert(
                redis_client, instance_id, "ec2", "HIGH",
                f"Idle EC2 instance detected: {instance_id} (CPU {cpu_avg:.1f}%)",
                f"Stop instance to save ~${daily_cost * 30:.2f}/month",
            )

        log_entry = {
            "resource_id":     resource_uuid,
            "aws_resource_id": instance_id,
            "resource_type":   "ec2",
            "cpu_usage":       cpu_avg,
            "memory_usage":    0.0,
            "cost":            round(daily_cost / 24, 4),
            "network_in_gb":   round(net_in / (1024 ** 3), 4) if net_in else 0,
            "network_out_gb":  round(net_out / (1024 ** 3), 4) if net_out else 0,
            "public_access":   inst.get("has_public_ip", False),
            "in_private_subnet": inst.get("in_private_subnet", True),
            "daily_cost":      daily_cost,
            "account_name":    account_name,
            "idle":            idle,
        }
        await publish_log_entry(db, log_entry)

        await store_compliance_check(db, {
            "aws_resource_id": instance_id,
            "check_type":      "ec2_public_ip",
            "check_passed":    not inst.get("has_public_ip", False),
            "details":         {"public_ip": inst.get("metadata", {}).get("public_ip"), "account": account_name},
        })

    await clean_stale_resources(db, "ec2")
    logger.info(f"EC2 cycle complete: {len(instances)} instances in {account_name}/{region}")


# ── S3 Collection ─────────────────────────────────────────────

async def collect_s3(
    db: Database, redis_client, http_client: httpx.AsyncClient,
    cloudtrail_mapping: dict,
    session, region: str, account_name: str, account_db_id: Optional[str] = None
):
    logger.info(f"═══ S3: {account_name} / {region} ═══")
    s3      = S3Collector(region=region, session=session)
    buckets = s3.collect()

    now = datetime.now(timezone.utc)
    idle_threshold = now - timedelta(days=S3_IDLE_DAYS)

    for bucket in buckets:
        bucket_name   = bucket["aws_resource_id"]
        last_modified = bucket.get("last_modified")
        size_mb       = bucket.get("size_mb")
        resource_uuid = await upsert_aws_resource(db, bucket, account_db_id)

        # ── FinOps idle detection ──────────────────────────────
        if last_modified is None:
            # Empty bucket — treat as idle
            idle = True
        else:
            if isinstance(last_modified, str):
                try:
                    last_modified = isoparse(last_modified)
                except Exception:
                    last_modified = None
            idle = (last_modified is not None and last_modified < idle_threshold)

        # Estimated cost: $0.023/GB/month (S3 Standard)
        size_gb   = (size_mb or 0) / 1024
        est_cost  = round(size_gb * 0.023, 4)
        recommendation = (
            f"Bucket not modified in {S3_IDLE_DAYS}+ days. "
            "Archive to Glacier or delete to save cost."
            if idle else None
        )

        tags = bucket.get("metadata", {}).get("tags", {})
        tag_user = tags.get("Owner") or tags.get("iam_user")
        
        iam_user = None
        ownership_source = "credentials"
        
        if bucket_name in cloudtrail_mapping:
            iam_user = cloudtrail_mapping[bucket_name]
            ownership_source = "cloudtrail"
        elif tag_user:
            iam_user = tag_user
            ownership_source = "tag"
        else:
            iam_user = "unknown"

        await upsert_cloud_resource(db, {
            "resource_id":    bucket_name,
            "type":           "s3",
            "name":           bucket_name,
            "state":          "active",
            "region":         "global",
            "cpu":            None,
            "size_mb":        size_mb,
            "last_activity":  last_modified.isoformat() if isinstance(last_modified, datetime) else None,
            "estimated_cost": est_cost,
            "idle":           idle,
            "recommendation": recommendation,
            "iam_user":       iam_user,
            "ownership_source": ownership_source,
            "account_name":   account_name
        })

        if idle and redis_client:
            publish_idle_alert(
                redis_client, bucket_name, "s3", "MEDIUM",
                f"Idle S3 bucket detected: {bucket_name} (no changes in {S3_IDLE_DAYS}+ days)",
                "Archive to Glacier or delete bucket to optimize cost",
            )

        log_entry = {
            "resource_id":       resource_uuid,
            "aws_resource_id":   bucket_name,
            "resource_type":     "s3",
            "cpu_usage":         0,
            "memory_usage":      0,
            "cost":              est_cost,
            "size_mb":           size_mb,
            "public_access":     bucket.get("public_access", True),
            "encryption_at_rest": bucket.get("encryption_at_rest", False),
            "logging_enabled":   bucket.get("logging_enabled", False),
            "account_name":      account_name,
            "idle":              idle,
        }
        await publish_log_entry(db, log_entry)

        checks = [
            ("s3_public_access", not bucket.get("public_access", True)),
            ("s3_encryption",    bucket.get("encryption_at_rest", False)),
            ("s3_versioning",    bucket.get("versioning_enabled", False)),
            ("s3_logging",       bucket.get("logging_enabled", False)),
        ]
        for check_type, passed in checks:
            await store_compliance_check(db, {
                "aws_resource_id": bucket_name,
                "check_type":      check_type,
                "check_passed":    passed,
                "details":         {**bucket.get("metadata", {}), "account": account_name},
            })

        if bucket.get("public_access", False):
            await publish_critical_alert(
                http_client, bucket_name,
                f"[{account_name}] S3 bucket '{bucket_name}' has public access enabled",
                {"bucket": bucket_name, "public_access": True, "account": account_name},
            )

    await clean_stale_resources(db, "s3")
    logger.info(f"S3 cycle complete: {len(buckets)} buckets in {account_name}")


# ── Lambda Collection ─────────────────────────────────────────

async def collect_lambda(
    db: Database, redis_client, http_client: httpx.AsyncClient,
    cloudtrail_mapping: dict,
    session, region: str, account_name: str, account_db_id: Optional[str] = None
):
    logger.info(f"═══ Lambda: {account_name} / {region} ═══")
    lc        = LambdaCollector(region=region, session=session)
    functions = lc.collect()

    now            = datetime.now(timezone.utc)
    idle_threshold = now - timedelta(days=LAMBDA_IDLE_DAYS)

    for fn in functions:
        fn_name       = fn["aws_resource_id"]
        last_invoked  = fn.get("last_invoked")
        resource_uuid = await upsert_aws_resource(db, fn, account_db_id)

        # ── FinOps idle detection ──────────────────────────────
        if last_invoked is None:
            idle = True  # Never invoked in last 7 days period
        else:
            if isinstance(last_invoked, str):
                try:
                    last_invoked = isoparse(last_invoked)
                except Exception:
                    last_invoked = None
            idle = (last_invoked is not None and last_invoked < idle_threshold)

        recommendation = (
            f"Lambda function not invoked in {LAMBDA_IDLE_DAYS}+ days. "
            "Consider deleting unused function to reduce attack surface."
            if idle else None
        )

        # Lambda cost is effectively $0 for idle functions; show nominal amount
        est_cost = 0.0

        tags = fn.get("metadata", {}).get("tags", {})
        tag_user = tags.get("Owner") or tags.get("iam_user")
        
        iam_user = None
        ownership_source = "credentials"
        
        if fn_name in cloudtrail_mapping:
            iam_user = cloudtrail_mapping[fn_name]
            ownership_source = "cloudtrail"
        elif tag_user:
            iam_user = tag_user
            ownership_source = "tag"
        else:
            iam_user = "unknown"

        await upsert_cloud_resource(db, {
            "resource_id":    fn_name,
            "type":           "lambda",
            "name":           fn_name,
            "state":          "active",
            "region":         region,
            "cpu":            None,
            "size_mb":        fn.get("metadata", {}).get("memory_mb"),
            "last_activity":  last_invoked.isoformat() if isinstance(last_invoked, datetime) else None,
            "estimated_cost": est_cost,
            "idle":           idle,
            "recommendation": recommendation,
            "iam_user":       iam_user,
            "ownership_source": ownership_source,
            "account_name":   account_name
        })

        if idle and redis_client:
            publish_idle_alert(
                redis_client, fn_name, "lambda", "LOW",
                f"Idle Lambda function detected: {fn_name} (no invocations in {LAMBDA_IDLE_DAYS}+ days)",
                "Delete unused function to reduce attack surface and clutter",
            )

        log_entry = {
            "resource_id":     resource_uuid,
            "aws_resource_id": fn_name,
            "resource_type":   "lambda",
            "cpu_usage":       0,
            "memory_usage":    0,
            "cost":            0,
            "account_name":    account_name,
            "idle":            idle,
        }
        await publish_log_entry(db, log_entry)

    await clean_stale_resources(db, "lambda")
    logger.info(f"Lambda cycle complete: {len(functions)} functions in {account_name}/{region}")


# ── IAM Collection ────────────────────────────────────────────

async def collect_iam(
    db: Database, redis_client, http_client: httpx.AsyncClient,
    session, account_name: str, account_db_id: Optional[str] = None
):
    logger.info(f"═══ IAM: {account_name} ═══")
    from collectors import IAMCollector
    iam   = IAMCollector(session=session)
    users = iam.collect()

    for user in users:
        user_id       = user["aws_resource_id"]
        resource_uuid = await upsert_aws_resource(db, user, account_db_id)

        # Unified inventory integration: Store IAM user as a resource
        await upsert_cloud_resource(db, {
            "resource_id":    user_id,
            "type":           "iam",
            "name":           user.get("metadata", {}).get("username"),
            "state":          "active",
            "region":         "global",
            "iam_user":       user.get("metadata", {}).get("username"),
            "account_name":   account_name,
            "last_activity":  user.get("metadata", {}).get("create_date"),
        })

        log_entry = {
            "resource_id":    resource_uuid,
            "cpu_usage": 0, "memory_usage": 0, "cost": 0,
            "mfa_enabled":    user.get("mfa_enabled", False),
            "is_root_account": user.get("is_root_account", False),
            "account_name":   account_name,
        }
        await publish_log_entry(db, log_entry)

        checks = [
            ("iam_mfa",          user.get("mfa_enabled", False)),
            ("iam_root_usage",   not user.get("is_root_account", False)),
            ("iam_key_rotation", user.get("access_key_age_days", 0) <= 90),
        ]
        for check_type, passed in checks:
            await store_compliance_check(db, {
                "aws_resource_id": user_id,
                "check_type":      check_type,
                "check_passed":    passed,
                "details":         {**user.get("metadata", {}), "account": account_name},
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

        if user.get("has_administrator_access", False):
            await publish_critical_alert(
                http_client, user_id,
                f"[{account_name}] IAM user '{user.get('metadata', {}).get('username')}' has AdministratorAccess attached",
                {"username": user.get('metadata', {}).get('username'), "has_administrator_access": True, "account": account_name},
            )

        if user.get("has_wildcard_policy", False):
            await publish_critical_alert(
                http_client, user_id,
                f"[{account_name}] IAM user '{user.get('metadata', {}).get('username')}' has potentially overly permissive wildcard policies",
                {"username": user.get('metadata', {}).get('username'), "has_wildcard_policy": True, "account": account_name},
            )

    await clean_stale_resources(db, "iam")
    logger.info(f"IAM cycle complete: {len(users)} users in {account_name}")


# ── Single Account Orchestrator ───────────────────────────────

async def collect_single_account(
    db: Database, redis_client, http_client: httpx.AsyncClient,
    collector_type: str = "all"
):
    logger.info("Running single account collection...")
    
    # Support multiple regions from env var (comma-separated). Default to AWS_REGION if not set.
    env_regions = os.getenv("AWS_REGIONS")
    regions_to_scan = [r.strip() for r in env_regions.split(",")] if env_regions else [AWS_REGION]
    
    account_name = os.getenv("AWS_ACCOUNT_NAME", "Primary Account")

    for region in regions_to_scan:
        logger.info(f"Targeting region: {region}")
        session = boto3.Session(region_name=region)
        try:
            cloudtrail_mapping = await asyncio.to_thread(get_cloudtrail_mapping, session, region)
        except Exception:
            cloudtrail_mapping = {}

        if collector_type in ("all", "ec2"):
            try:
                await collect_ec2_and_cloudwatch(db, redis_client, http_client, cloudtrail_mapping, session, region, account_name)
            except Exception as e:
                logger.error(f"EC2 failed in {region}: {e}")

        if collector_type in ("all", "s3"):
            try:
                await collect_s3(db, redis_client, http_client, cloudtrail_mapping, session, region, account_name)
            except Exception as e:
                logger.error(f"S3 failed in {region}: {e}")

        if collector_type in ("all", "lambda"):
            try:
                await collect_lambda(db, redis_client, http_client, cloudtrail_mapping, session, region, account_name)
            except Exception as e:
                logger.error(f"Lambda failed in {region}: {e}")

    if collector_type in ("all", "iam"):
        try:
            # IAM is global, only run once
            session = boto3.Session(region_name=AWS_REGION)
            await collect_iam(db, redis_client, http_client, session, account_name)
        except Exception as e:
            logger.error(f"IAM failed: {e}")


# ── Scheduled Loop Runner ─────────────────────────────────────

async def run_loop(name: str, interval: int, coro_fn, *args):
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
        "status":  "ok",
        "service": "cloud_collector",
        "mode":    DATA_SOURCE_MODE,
        "region":  AWS_REGION,
        "use_sts": USE_STS,
    }


async def run_health_server():
    config = uvicorn.Config(health_app, host="0.0.0.0", port=8004, log_level="error")
    server = uvicorn.Server(config)
    await server.serve()


# ── Main Entry Point ──────────────────────────────────────────

async def main():
    logger.info("╔═══════════════════════════════════════════════════╗")
    logger.info("║   CloudGuard Cloud Data Collector                 ║")
    logger.info(f"║   Mode: {DATA_SOURCE_MODE:<17}                    ║")
    logger.info(f"║   Region: {AWS_REGION:<15}                    ║")
    logger.info("╚═══════════════════════════════════════════════════╝")

    if DATA_SOURCE_MODE == "simulated":
        logger.info("Mode is 'simulated' — Collector will idle.")
        await run_health_server()
        return

    db = Database(DATABASE_URL)
    await db.connect()
    logger.info("Database connected.")

    # Connect to Redis for idle-alert publishing
    redis_client = None
    try:
        redis_client = redis_sync.Redis.from_url(REDIS_URL, decode_responses=True)
        redis_client.ping()
        logger.info("Redis connected.")
    except Exception as e:
        logger.warning(f"Redis unavailable — idle alerts will not be published: {e}")
        redis_client = None

    asyncio.create_task(run_health_server())

    async with httpx.AsyncClient() as http_client:
        logger.info("Running initial full collection cycle...")
        try:
            await collect_single_account(db, redis_client, http_client, "all")
            logger.info("Initial collection complete ✓")
        except Exception as e:
            logger.error(f"Initial collection failed (will retry on schedule): {e}")

        logger.info("Starting scheduled collection loops...")
        await asyncio.gather(
            run_loop("EC2+CloudWatch", EC2_INTERVAL,    collect_single_account, db, redis_client, http_client, "ec2"),
            run_loop("S3",            S3_INTERVAL,     collect_single_account, db, redis_client, http_client, "s3"),
            run_loop("Lambda",        LAMBDA_INTERVAL,  collect_single_account, db, redis_client, http_client, "lambda"),
            run_loop("IAM",           IAM_INTERVAL,     collect_single_account, db, redis_client, http_client, "iam"),
        )


if __name__ == "__main__":
    asyncio.run(main())
