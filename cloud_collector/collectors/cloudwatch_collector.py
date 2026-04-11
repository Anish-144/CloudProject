import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

class CloudWatchCollector:
    def __init__(self, region: str, session=None):
        self.region = region
        self.session = session
        
    def _get_metric_stats(self, client, instance_id, metric_name, start, end, stat="Average"):
        try:
            response = client.get_metric_statistics(
                Namespace="AWS/EC2",
                MetricName=metric_name,
                Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
                StartTime=start,
                EndTime=end,
                Period=300,
                Statistics=[stat]
            )
            dp = response.get("Datapoints", [])
            if dp:
                dp.sort(key=lambda x: x["Timestamp"])
                return dp[-1][stat]
        except Exception as e:
            logger.error(f"Error fetching metric {metric_name} for {instance_id}: {e}")
        return 0.0

    def collect_for_instances(self, instance_ids):
        logger.info(f"Collecting CloudWatch metrics for {len(instance_ids)} instances in {self.region}")
        client = self.session.client("cloudwatch", region_name=self.region)
        metrics = []
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(minutes=15)
        
        for i_id in instance_ids:
            cpu = self._get_metric_stats(client, i_id, "CPUUtilization", start_time, end_time)
            net_in = self._get_metric_stats(client, i_id, "NetworkIn", start_time, end_time, "Sum")
            net_out = self._get_metric_stats(client, i_id, "NetworkOut", start_time, end_time, "Sum")
            
            metrics.append({
                "aws_resource_id": i_id,
                "cpu_avg": float(cpu),
                "network_in_bytes": float(net_in),
                "network_out_bytes": float(net_out),
                "timestamp": end_time.isoformat()
            })
        return metrics
