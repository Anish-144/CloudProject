import logging
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

class S3Collector:
    def __init__(self, region: str, session=None):
        self.region = region
        self.session = session

    def collect(self):
        logger.info(f"Collecting S3 buckets list from global endpoint")
        client = self.session.client("s3", region_name=self.region)
        buckets_data = []
        try:
            response = client.list_buckets()
            for bucket in response.get("Buckets", []):
                bucket_name = bucket["Name"]
                
                # Check Public Access
                public_access = True
                try:
                    pab = client.get_public_access_block(Bucket=bucket_name)
                    config = pab.get("PublicAccessBlockConfiguration", {})
                    if config.get("BlockPublicAcls") and config.get("BlockPublicPolicy"):
                        public_access = False
                except ClientError as e:
                    if e.response['Error']['Code'] == 'NoSuchPublicAccessBlockConfiguration':
                        public_access = True
                    else:
                        logger.debug(f"Could not get public access block for {bucket_name}: {e}")

                # Check Encryption
                encryption = False
                try:
                    enc = client.get_bucket_encryption(Bucket=bucket_name)
                    if enc.get("ServerSideEncryptionConfiguration"):
                        encryption = True
                except ClientError:
                    pass

                # Check Logging
                logging_enabled = False
                try:
                    log_resp = client.get_bucket_logging(Bucket=bucket_name)
                    if log_resp.get("LoggingEnabled"):
                        logging_enabled = True
                except ClientError:
                    pass

                # Check Versioning
                versioning = False
                try:
                    ver = client.get_bucket_versioning(Bucket=bucket_name)
                    if ver.get("Status") == "Enabled":
                        versioning = True
                except ClientError:
                    pass

                buckets_data.append({
                    "aws_resource_id": bucket_name,
                    "resource_type": "s3_bucket",
                    "region": "global",
                    "status": "active",
                    "public_access": public_access,
                    "encryption_at_rest": encryption,
                    "logging_enabled": logging_enabled,
                    "versioning_enabled": versioning,
                    "metadata": {
                        "name": bucket_name,
                        "creation_date": bucket["CreationDate"].isoformat()
                    }
                })
        except Exception as e:
            logger.error(f"Error collecting S3: {e}")
            
        return buckets_data
