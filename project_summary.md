# CloudGuard Project Status & Summary

This document provides a comprehensive overview of the CloudGuard platform development, its current capabilities, and how the core monitoring systems function.

## 🚀 What We Have Accomplished
We have built a production-grade Cloud Governance and Monitoring platform that provides deep visibility into AWS infrastructure. The system is split into multiple microservices:

1.  **Gateway (Backend API)**: FastAPI-based central hub managing authentication, role-based access control, and data delivery to the frontend.
2.  **Cloud Collector**: The core engine that polls AWS services (EC2, S3, Lambda, IAM) and attributes resources to owners.
3.  **Frontend Dashboard**: A premium, high-performance React (Vite) interface with specialized views for FinOps, Compliance, and Cloud Administration.
4.  **Engines (FinOps & Compliance)**: Specialized services that analyze raw data to detect waste and security violations.

---

## 🛠️ Key Features & Recent Changes

### 1. Multi-IAM User Monitoring
We implemented a robust system to track resources back to the specific IAM users who created them. This allows for:
-   **User Resource Leaderboards**: Seeing which users own the most resources or contribute most to the cloud bill.
-   **Granular Accountability**: Moving away from "unknown" resource ownership.

### 2. Automatic Resource Attribution
How the system identifies the "owner" of a resource:
-   **CloudTrail Integration**: The collector looks up `RunInstances`, `CreateBucket`, and `CreateFunction` events in AWS CloudTrail to find the original creator.
-   **Resource Tagging**: It fallbacks to `Owner` or `iam_user` tags if CloudTrail logs are old or unavailable.
-   **Credential Tracking**: It associates resources with the credentials used during the scan cycle.

### 3. Idle Resource Detection & FinOps
Real-time waste detection for:
-   **EC2**: Flagging instances with < 5% CPU utilization.
-   **S3**: Detecting buckets with no modifications for 30+ days.
-   **Lambda**: Identifying functions not invoked in 7+ days.
-   **Cost Estimates**: Automated calculation of monthly savings potential per resource.

### 4. Security & Compliance Posture
Automated checks for critical security risks:
-   **MFA Status**: Flagging users without Multi-Factor Authentication.
-   **Unused Access Keys**: Alerting on keys older than 90 days.
-   **Over-privileged Policies**: Detecting `AdministratorAccess` and wildcard (`*`) policies.
-   **Public S3 Buckets**: Real-time alerts for publicly accessible data.

---

## 🛰️ How it Works: Data Fetching from Root

The **CloudGuard Cloud Collector** acts as the bridge between your AWS Root account and the platform database. Here is the technical flow:

1.  **Authentication**: The collector uses a `boto3.Session` initialized with your AWS credentials (configured via `.env` or IAM roles). It typically runs with administrative read-only permissions on the root account.
2.  **IAM Discovery**: It calls `iam.list_users()` to fetch all active identities. For each user, it audits their security settings (MFA, Keys, Policies).
3.  **Global & Regional Scanning**:
    -   It iterates through all active AWS regions.
    -   It collects metadata for EC2 instances, S3 buckets, and Lambda functions.
4.  **CloudTrail Hook**: For every resource found, it queries `cloudtrail.lookup_events()` to search for the "Creation" event. This is how it determines which user in the root account started that specific resource.
5.  **Database Upsert**: All gathered data is normalized and stored in PostgreSQL (`aws_resources` and `cloud_resources` tables).
6.  **Real-Time Alerts**: If a critical risk is found (e.g., a root account being used directly or an MFA-less user), it pushes a notification to **Redis**, which the frontend displays instantly via SSE (Server-Sent Events).

---

## 👤 The CloudGuard User Roles
The platform defines four specific roles, each with a tailored dashboard:

-   **Cloud Admin**: Full access to all resources, user management, and the "Resource Discovery" crawler.
-   **FinOps Manager**: Focuses on cost trends, forecast values, and "Savings Opportunities."
-   **Compliance Officer**: Monitors the "Compliance Posture" and manages recent security violations.
-   **IT Admin**: Monitors infrastructure health and the live alert stream for system stability.

---

## ✅ Current Status: What is Working?
-   [x] **AWS Connectivity**: Live data fetching for EC2, S3, IAM, and Lambda.
-   [x] **User Attribution**: CloudTrail-based mapping is active and visible in the Admin table.
-   [x] **Alerting Engine**: Critical alerts (MFA, AdminAccess, Public S3) are firing and streaming to the UI.
-   [x] **FinOps Dashboard**: Cost trend charts and potential savings calculations are live.
-   [x] **Compliance Dashboard**: Framework adherence scores and violation tracking are operational.
-   [x] **Multi-Role Login**: Secure authentication and role-based redirects are implemented.
