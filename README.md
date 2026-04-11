# CloudGuard - Unified Cloud Governance Platform

CloudGuard is a full-stack governance platform designed to monitor AWS environments with a focus on **FinOps** (cost optimization), **Compliance** (security/governance rules), and **IAM Activity Tracking**.

## 🚀 Key Features

*   **IAM User Activity Monitoring**: Real-time normalization of IAM logs into actionable audit trails.
*   **FinOps Cost Analysis**: Per-user cost breakdown and 30-day forecasting.
*   **Threshold-based Alerting**: IT Admin can set budget and cost-spike thresholds to prevent runaway spending.
*   **Compliance Engine**: Automated rule-checking (S3 public access, MFA, encryption, etc.).
*   **Role-Based Access Control**: Alerts are automatically routed to specific roles (FinOps Manager, IT Admin, etc.).
*   **PostgreSQL-Driven Ingestion**: Simplified architecture using PostgreSQL as the primary event bus (No Redis required).

---

## 🏗️ Architecture

- **Frontend**: React + Vite + Tailwind CSS.
- **Gateway**: FastAPI entry point with role-based auth.
- **Cloud Collector**: Boto3-based orchestrator for single-account AWS monitoring.
- **Engines**: 
    - **FinOps Engine**: Detects idle resources, spikes, and budget overruns.
    - **Compliance Engine**: Evaluates resources against governance rules.
- **Alert Service**: Centralized alert management and role-based routing.
- **Database**: PostgreSQL (main store + log ingestion bus).

---

## 🛠️ Setup & Configuration

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- AWS IAM User with read-only access (for `cloud_collector`).

### 1. Configure Credentials
Create a `.env` file in the root directory and add your AWS keys:
```env
# AWS Credentials
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_DEFAULT_REGION=us-east-1

# Postgres Connection
DATABASE_URL=postgresql://cloudguard_user:cloudguard_secret_2024@postgres:5432/cloudguard

# Auth Security
JWT_SECRET_KEY=generate-a-secure-random-key
```

### 2. Start the Stack
```bash
docker compose up -d --build
```

---

## 📊 Platform Roles & Access

| Role | Access Level | Primary Focus |
| :--- | :--- | :--- |
| **Cloud Admin** | Global View | Full platform management |
| **FinOps Manager** | FinOps Dashboard | Cost savings, User costs, Budgets |
| **Compliance Mgr** | Compliance View | Rule violations and remediation |
| **IT Admin** | User Activity | IAM tracking and Threshold management |

---

## 🩺 API Access
| Service | Link | Description |
| :--- | :--- | :--- |
| **Frontend** | [http://localhost:3000](http://localhost:3000) | Main Platform Dashboard |
| **API Docs** | [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs) | Backend Swagger Documentation |
| **Gateway Health** | [http://localhost:8000/health](http://localhost:8000/health) | System health status |

---

## 🛠️ Typical Development Workflow
1.  **Add/Modify Features**: Update `gateway/routers.py` for API or `finops_engine/main.py` for logic.
2.  **Database Migrations**: Add schema changes to `database/init.sql`.
3.  **UI Updates**: Modify components in `frontend/src/App.tsx`.
4.  **Redeploy**: Run `docker compose up -d` (Docker handles hot-reloading for code changes via volumes).

---
Developed for secure, transparent, and cost-efficient cloud operations.
