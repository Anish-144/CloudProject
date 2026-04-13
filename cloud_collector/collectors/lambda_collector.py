"""
LambdaCollector — Fetches AWS Lambda functions and their last invocation time.

Collects:
  - function_name / ARN
  - runtime, memory, timeout
  - last_modified (from Lambda API)
  - last_invoked (from CloudWatch Invocations metric over last 7 days)
  - estimated invocation cost (simplified)
"""

import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


class LambdaCollector:
    # Lambda pricing (approximate): $0.0000002 per request + $0.0000166667 per GB-second
    # For idle detection we only care about invocation recency, cost is negligible.
    # We assign a small baseline cost if the function exists.
    BASE_MONTHLY_COST_PER_FUNCTION = 0.0  # effectively free unless invoked heavily

    def __init__(self, region: str, session=None):
        self.region = region
        self.session = session

    def _get_last_invoked(self, cw_client, function_name: str) -> datetime | None:
        """Pull Invocations metric from CloudWatch for last 7 days."""
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=7)
        try:
            resp = cw_client.get_metric_statistics(
                Namespace="AWS/Lambda",
                MetricName="Invocations",
                Dimensions=[{"Name": "FunctionName", "Value": function_name}],
                StartTime=start,
                EndTime=end,
                Period=86400,          # 1-day buckets
                Statistics=["Sum"],
            )
            datapoints = sorted(resp.get("Datapoints", []), key=lambda x: x["Timestamp"], reverse=True)
            # Find the most recent day that had at least 1 invocation
            for dp in datapoints:
                if dp.get("Sum", 0) > 0:
                    return dp["Timestamp"]
        except Exception as e:
            logger.debug(f"CloudWatch Invocations fetch failed for {function_name}: {e}")
        return None

    def collect(self) -> list[dict]:
        """Return list of Lambda resource dicts."""
        logger.info(f"Collecting Lambda functions in {self.region}")
        lambda_client = self.session.client("lambda", region_name=self.region)
        cw_client     = self.session.client("cloudwatch", region_name=self.region)
        functions = []

        try:
            paginator = lambda_client.get_paginator("list_functions")
            for page in paginator.paginate():
                for fn in page.get("Functions", []):
                    function_name = fn["FunctionName"]
                    function_arn  = fn["FunctionArn"]
                    runtime       = fn.get("Runtime", "unknown")
                    memory_mb     = fn.get("MemorySize", 128)
                    timeout_s     = fn.get("Timeout", 3)

                    # last_modified is a string like "2026-03-01T10:00:00.000+0000"
                    last_modified_str = fn.get("LastModified", "")
                    last_modified: datetime | None = None
                    if last_modified_str:
                        try:
                            last_modified = datetime.fromisoformat(
                                last_modified_str.replace("+0000", "+00:00")
                            )
                        except Exception:
                            pass

                    last_invoked = self._get_last_invoked(cw_client, function_name)

                    tags_dict = {}
                    try:
                        tags_resp = lambda_client.list_tags(Resource=function_arn)
                        tags_dict = tags_resp.get("Tags", {})
                    except Exception:
                        pass

                    functions.append({
                        "aws_resource_id": function_name,
                        "resource_type":   "lambda_function",
                        "region":          self.region,
                        "status":          "active",
                        "metadata": {
                            "arn":          function_arn,
                            "runtime":      runtime,
                            "memory_mb":    memory_mb,
                            "timeout_s":    timeout_s,
                            "last_modified": last_modified.isoformat() if last_modified else None,
                            "last_invoked":  last_invoked.isoformat()  if last_invoked  else None,
                            "tags":          tags_dict,
                        },
                        # Convenience fields used by main.py for cloud_resources upsert
                        "last_modified":   last_modified,
                        "last_invoked":    last_invoked,
                    })

        except Exception as e:
            logger.error(f"Error collecting Lambda functions in {self.region}: {e}")

        logger.info(f"Lambda: collected {len(functions)} functions in {self.region}")
        return functions
