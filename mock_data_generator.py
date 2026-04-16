import os
import time
import json
import random
import requests
from datetime import datetime, timedelta

GATEWAY_URL = "http://localhost:8000/api/v1"
HEADERS = {}

def get_real_token():
    try:
        res = requests.post(f"{GATEWAY_URL}/auth/login", json={"email": "admin@cloudguard.io", "password": "admin123"})
        res.raise_for_status()
        token = res.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    except Exception as e:
        print(f"Failed to fetch token: {e}")
        return {}

HEADERS = get_real_token()

# Account UUIDs from init.sql
ACCOUNT_ALPHA = "a0000000-0000-0000-0000-000000000001"
ACCOUNT_BETA  = "b0000000-0000-0000-0000-000000000002"

# Create dummy resources: 1-5 for Alpha, 6-9 for Beta
RESOURCES_ALPHA = [f"00000000-0000-0000-0000-{str(i).zfill(12)}" for i in range(1, 6)]
RESOURCES_BETA  = [f"00000000-0000-0000-0000-{str(i).zfill(12)}" for i in range(6, 10)]

def generate_log():
    # Pick an account
    is_alpha = random.random() < 0.6 # 60% Alpha
    account_id = ACCOUNT_ALPHA if is_alpha else ACCOUNT_BETA
    resource_id = random.choice(RESOURCES_ALPHA if is_alpha else RESOURCES_BETA)

    # Occasionally generate a bad config to trigger compliance rules
    bad_config = random.random() < 0.15
    
    # Occasionally generate very low CPU for finops
    idle = random.random() < 0.2

    return {
        "resource_id": resource_id,
        "aws_account_id": account_id,
        "cpu_usage": random.uniform(0.1, 4.0) if idle else random.uniform(10.0, 95.0),
        "memory_usage": random.uniform(20.0, 80.0),
        "cost": random.uniform(5.0, 50.0) if is_alpha else random.uniform(8.0, 70.0),
        "public_access": True if bad_config else False,  # True violates No Public S3
        "encryption_at_rest": False if bad_config else True, # False violates Encryption Required
        "mfa_enabled": False if bad_config else True,
        "is_root_account": True if random.random() < 0.05 else False,
        "logging_enabled": False if bad_config else True,
        "in_private_subnet": False if bad_config else True,
        "timestamp": datetime.utcnow().isoformat()
    }

def main():
    print("Sending mock usage logs to CloudGuard Gateway...")
    
    # Seed historical data for graph (past 30 days)
    print("Seed historical data...")
    historical_logs = []
    for days_ago in range(30, -1, -1):
        for _ in range(5):
             log = generate_log()
             log["timestamp"] = (datetime.utcnow() - timedelta(days=days_ago)).isoformat()
             # Artificial cost spike for last 2 days
             if days_ago < 2: 
                 log["cost"] *= 1.5
             historical_logs.append(log)
    
    # Chunk sizes of 50
    for i in range(0, len(historical_logs), 50):
        chunk = historical_logs[i:i+50]
        try:
             requests.post(f"{GATEWAY_URL}/ingest/logs", json={"logs": chunk}, headers=HEADERS)
        except Exception:
             pass

    print("Sending real-time logs (1 message per second). Press Ctrl+C to stop.")
    while True:
        log = generate_log()
        try:
            res = requests.post(f"{GATEWAY_URL}/ingest/logs", json={"logs": [log]}, headers=HEADERS)
            print(f"Sent: CPU={log['cpu_usage']:.1f}%, Cost={log['cost']:.1f}, PublicAccess={log['public_access']} -> {res.status_code}")
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(1)

if __name__ == "__main__":
    main()
