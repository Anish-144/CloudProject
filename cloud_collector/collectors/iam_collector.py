import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

class IAMCollector:
    def __init__(self, session=None):
        self.session = session

    def collect(self):
        logger.info("Collecting IAM users")
        client = self.session.client("iam")
        users_data = []
        
        try:
            paginator = client.get_paginator('list_users')
            for page in paginator.paginate():
                for user in page.get("Users", []):
                    username = user["UserName"]
                    
                    # Check MFA
                    mfa_enabled = False
                    try:
                        mfa_resp = client.list_mfa_devices(UserName=username)
                        if mfa_resp.get("MFADevices"):
                            mfa_enabled = True
                    except Exception as e:
                        logger.debug(f"Could not get MFA for {username}: {e}")

                    # Check Keys
                    access_key_age_days = 0
                    try:
                        keys_resp = client.list_access_keys(UserName=username)
                        for key in keys_resp.get("AccessKeyMetadata", []):
                            if key["Status"] == "Active":
                                create_date = key["CreateDate"]
                                age = (datetime.now(timezone.utc) - create_date).days
                                if age > access_key_age_days:
                                    access_key_age_days = age
                    except Exception as e:
                        logger.debug(f"Could not get keys for {username}: {e}")

                    is_root = username.lower() == "root"
                    
                    # Check Policies
                    has_administrator_access = False
                    has_wildcard_policy = False
                    try:
                        attached = client.list_attached_user_policies(UserName=username)
                        for policy in attached.get("AttachedPolicies", []):
                            if policy["PolicyName"] == "AdministratorAccess":
                                has_administrator_access = True
                                has_wildcard_policy = True
                    except Exception as e:
                        logger.debug(f"Could not get attached policies for {username}: {e}")
                        
                    try:
                        inline = client.list_user_policies(UserName=username)
                        if inline.get("PolicyNames"):
                            # If they have inline policies, we flag them for review as potentially overly permissive (wildcards)
                            # since inline policies bypass standard managed guardrails.
                            has_wildcard_policy = True
                    except Exception as e:
                        logger.debug(f"Could not get inline policies for {username}: {e}")
                        
                    users_data.append({
                        "aws_resource_id": username,
                        "resource_type": "iam_user",
                        "region": "global",
                        "status": "active",
                        "mfa_enabled": mfa_enabled,
                        "is_root_account": is_root,
                        "access_key_age_days": access_key_age_days,
                        "has_administrator_access": has_administrator_access,
                        "has_wildcard_policy": has_wildcard_policy,
                        "metadata": {
                            "username": username,
                            "arn": user["Arn"],
                            "create_date": user["CreateDate"].isoformat(),
                            "has_administrator_access": has_administrator_access,
                            "has_wildcard_policy": has_wildcard_policy
                        }
                    })
        except Exception as e:
            logger.error(f"Error collecting IAM: {e}")
            
        return users_data
