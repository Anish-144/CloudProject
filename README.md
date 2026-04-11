# CloudGuard - Unified Cloud Governance Platform

CloudGuard is a full-stack governance platform designed to monitor AWS environments with a focus on **FinOps** (cost optimization), **Compliance** (security/governance rules), and **IAM Activity Tracking**.

## 🚀 Key Features

*   **IAM User Activity Monitoring**: Real-time normalization of IAM logs into actionable audit trails.
*   **FinOps Cost Analysis**: Per-user cost breakdown and 30-day forecasting.
*   **Threshold-based Alerting**: Set budget and cost-spike thresholds to prevent runaway spending.
*   **Compliance Engine**: Automated rule-checking (S3 public access, MFA, encryption, etc.).
*   **Role-Based Access Control**: Alerts are automatically routed to specific roles (FinOps Manager, IT Admin, etc.).
*   **Real-time Streaming**: Live alert feed using Redis Pub/Sub and SSE.

---

## 🏗️ Architecture

- **Frontend**: React + Vite + Tailwind CSS.
- **Gateway**: FastAPI entry point with role-based auth.
- **Cloud Collector**: Boto3-based orchestrator for single-account AWS monitoring.
- **Engines**: 
    - **FinOps Engine**: Detects idle resources, spikes, and budget overruns.
    - **Compliance Engine**: Evaluates resources against governance rules.
- **Alert Service**: Centralized alert management and role-based routing.
- **Database**: PostgreSQL (Persistent storage) & Redis (Event streaming).

---

## 🛠️ Setup & Execution Guide

### 1. Prerequisites
- [Docker Decor & Docker Compose](https://docs.docker.com/get-docker/)
- [Git](https://git-scm.com/downloads)
- AWS IAM User with Read-Only access (for the `cloud_collector`).

### 2. Installation
Clone the repository and enter the directory:
```bash
git clone https://github.com/Anish-144/CloudProject.git
cd CloudProject
```

### 3. Environment Configuration
The `.env` file is excluded from Git for security. You must create it from the template:
```bash
cp .env.example .env
```
Open the `.env` file and fill in your **AWS credentials**:
- `AWS_ACCESS_KEY_ID`: Your IAM Key ID (starting with `AKIA...`)
- `AWS_SECRET_ACCESS_KEY`: Your IAM Secret Key.
- `AWS_DEFAULT_REGION`: e.g., `ap-south-1`.

### 4. Run the Platform
Start all services in the background:
```bash
docker compose up --build -d
```
*Note: The `--build` flag is required whenever code changes or new files are added.*

---

## 🩺 System Monitoring & Troubleshooting

### View Container Logs
To see what is happening inside the services (useful for debugging):
```bash
# All services
docker compose logs -f

# Specific service (e.g. collector)
docker compose logs -f cloud_collector
```

### Common Issues
- **Invalid Date**: If the UI shows "Invalid Date", ensure you have pulled the latest `App.tsx` and run `docker compose up --build -d`.
- **AuthFailure (AWS)**: Check your `.env` file. Ensure `AWS_ACCESS_KEY_ID` contains the `AKIA...` key and NOT the secret key.
- **Collector Errors**: Ensure your IAM user has permissions for `ec2:DescribeInstances`, `s3:ListAllMyBuckets`, and `iam:ListUsers`.

---

## 📊 Access Interfaces
| Service | URL | Note |
| :--- | :--- | :--- |
| **Frontend** | [http://localhost:3000](http://localhost:3000) | Login: `admin@cloudguard.io` / `admin123` |
| **API Docs** | [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs) | Interactive Swagger UI |
| **Alert Service** | [http://localhost:8003/health](http://localhost:8003/health) | Alert management health check |

---

## 🛠️ Development Workflow
1.  **Code Changes**: After modifying files, run `docker compose up --build -d` to refresh the containers.
2.  **Updating Repo**: 
    ```bash
    git pull origin main
    docker compose up --build -d
    ```
3.  **Secrets**: Never commit your `.env` file. Use `.env.example` to document new variables.

---
Developed for secure, transparent, and cost-efficient cloud operations.
