import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class EC2Collector:
    def __init__(self, region: str, session=None):
        self.region = region
        self.session = session

    def get_estimated_daily_cost(self, instance_type: str, status: str) -> float:
        """A mock cost estimator based on typical on-demand pricing"""
        if status != "running":
            return 0.0
            
        costs = {
            "t2.micro": 0.0116 * 24,
            "t3.micro": 0.0104 * 24,
            "t3.medium": 0.0416 * 24,
            "m5.large": 0.096 * 24,
        }
        return costs.get(instance_type, 0.05 * 24)

    def collect(self):
        logger.info(f"Collecting EC2 instances in {self.region}")
        client = self.session.client("ec2", region_name=self.region)
        instances = []
        try:
            paginator = client.get_paginator('describe_instances')
            for page in paginator.paginate():
                for reservation in page.get("Reservations", []):
                    for inst in reservation.get("Instances", []):
                        instance_id = inst["InstanceId"]
                        status = inst["State"]["Name"]
                        instance_type = inst["InstanceType"]
                        public_ip = inst.get("PublicIpAddress")
                        
                        has_public_ip = bool(public_ip)
                        # An instance is in private subnet if it has no public IP
                        in_private_subnet = not has_public_ip
                        
                        instances.append({
                            "aws_resource_id": instance_id,
                            "resource_type": "ec2_instance",
                            "region": self.region,
                            "status": status,
                            "instance_type": instance_type,
                            "has_public_ip": has_public_ip,
                            "in_private_subnet": in_private_subnet,
                            "metadata": {
                                "public_ip": public_ip,
                                "private_ip": inst.get("PrivateIpAddress"),
                                "subnet_id": inst.get("SubnetId"),
                                "vpc_id": inst.get("VpcId")
                            }
                        })
        except Exception as e:
            logger.error(f"Error collecting EC2: {e}")
        return instances
