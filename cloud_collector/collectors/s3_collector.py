import logging
from datetime import datetime, timezone, timedelta
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class S3Collector:
    def __init__(self, region: str, session=None):
        self.region = region
        self.session = session

    # ── Helpers ───────────────────────────────────────────────────

    def _get_last_modified(self, s3_client, bucket_name: str):
        """Return the LastModified timestamp of the most-recently-changed object."""
        try:
            resp = s3_client.list_objects_v2(Bucket=bucket_name, MaxKeys=1)
            objects = resp.get("Contents", [])
            if objects:
                return objects[0]["LastModified"]
            return None
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("NoSuchBucket", "AccessDenied"):
                return None
            logger.debug(f"list_objects_v2 failed for {bucket_name}: {e}")
            return None

    def _get_bucket_size_mb(self, cw_client, bucket_name: str):
        """Fetch approximate bucket size in MB from CloudWatch BucketSizeBytes metric."""
        end   = datetime.now(timezone.utc)
        start = end - timedelta(days=2)
        try:
            resp = cw_client.get_metric_statistics(
                Namespace="AWS/S3",
                MetricName="BucketSizeBytes",
                Dimensions=[
                    {"Name": "BucketName",  "Value": bucket_name},
                    {"Name": "StorageType", "Value": "StandardStorage"},
                ],
                StartTime=start,
                EndTime=end,
                Period=86400,
                Statistics=["Average"],
            )
            points = sorted(resp.get("Datapoints", []), key=lambda x: x["Timestamp"], reverse=True)
            if points:
                return round(points[0]["Average"] / (1024 * 1024), 2)
        except Exception as e:
            logger.debug(f"CloudWatch BucketSizeBytes failed for {bucket_name}: {e}")
        return None

    # ── Main Collect ──────────────────────────────────────────────

    def collect(self) -> list:
        logger.info("Collecting S3 buckets list from global endpoint")
        s3_client = self.session.client("s3",         region_name=self.region)
        cw_client = self.session.client("cloudwatch", region_name=self.region)
        buckets_data = []

        try:
            response = s3_client.list_buckets()
            for bucket in response.get("Buckets", []):
                bucket_name = bucket["Name"]

                # ── Public Access ──────────────────────────────
                public_access = True
                try:
                    pab = s3_client.get_public_access_block(Bucket=bucket_name)
                    cfg = pab.get("PublicAccessBlockConfiguration", {})
                    if cfg.get("BlockPublicAcls") and cfg.get("BlockPublicPolicy"):
                        public_access = False
                except ClientError as e:
                    if e.response["Error"]["Code"] != "NoSuchPublicAccessBlockConfiguration":
                        logger.debug(f"PublicAccessBlock error for {bucket_name}: {e}")

                # ── Encryption ────────────────────────────────
                encryption = False
                try:
                    enc = s3_client.get_bucket_encryption(Bucket=bucket_name)
                    if enc.get("ServerSideEncryptionConfiguration"):
                        encryption = True
                except ClientError:
                    pass

                # ── Logging ───────────────────────────────────
                logging_enabled = False
                try:
                    log_resp = s3_client.get_bucket_logging(Bucket=bucket_name)
                    if log_resp.get("LoggingEnabled"):
                        logging_enabled = True
                except ClientError:
                    pass

                # ── Versioning ────────────────────────────────
                versioning = False
                try:
                    ver = s3_client.get_bucket_versioning(Bucket=bucket_name)
                    if ver.get("Status") == "Enabled":
                        versioning = True
                except ClientError:
                    pass

                # ── Tagging ───────────────────────────────────
                tags_dict = {}
                try:
                    tags_resp = s3_client.get_bucket_tagging(Bucket=bucket_name)
                    for t in tags_resp.get("TagSet", []):
                        tags_dict[t["Key"]] = t["Value"]
                except ClientError:
                    pass

                # ── Last Modified + Size (FinOps enrichment) ──
                last_modified = self._get_last_modified(s3_client, bucket_name)
                size_mb       = self._get_bucket_size_mb(cw_client, bucket_name)

                buckets_data.append({
                    "aws_resource_id":    bucket_name,
                    "resource_type":      "s3_bucket",
                    "region":             "global",
                    "status":             "active",
                    "public_access":      public_access,
                    "encryption_at_rest": encryption,
                    "logging_enabled":    logging_enabled,
                    "versioning_enabled": versioning,
                    # FinOps enrichment fields
                    "last_modified":      last_modified,
                    "size_mb":            size_mb,
                    "metadata": {
                        "name":               bucket_name,
                        "creation_date":      bucket["CreationDate"].isoformat(),
                        "last_modified":      last_modified.isoformat() if last_modified else None,
                        "size_mb":            size_mb,
                        "public_access":      public_access,
                        "encryption_at_rest": encryption,
                        "logging_enabled":    logging_enabled,
                        "versioning_enabled": versioning,
                        "tags":               tags_dict,
                    },
                })

        except Exception as e:
            logger.error(f"Error collecting S3: {e}")

        logger.info(f"S3: collected {len(buckets_data)} buckets")
        return buckets_data
