# CloudGuard - Unified Cloud Governance Platform

CloudGuard is a full-stack application designed for cloud governance, focusing on **FinOps** (cost optimization), **Compliance** (security rules), and **Real-time Alerting**.

## 🚀 Getting Started

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- [Node.js v18+](https://nodejs.org/) (optional, for local frontend development)
- [Python 3.11+](https://www.python.org/) (optional, for local gateway development)

## 🚀 Setup & Installation

To run this platform, you will need AWS credentials with specific read-only permissions to allow CloudGuard to scan your resources, followed by starting the Docker services.

### Step 1: AWS Console Setup (IAM Configuration)

1. Log in to your **AWS Management Console**.
2. Navigate to **IAM (Identity and Access Management)** > **Policies** and click **Create Policy**.
3. Select the **JSON** tab and paste the exact contents of the `policyforiamuseronrootaccount` file located in the root of this project.
4. Click **Next**, give the policy a name (e.g., `CloudGuard-ReadOnly-Policy`), and click **Create policy**.
5. Navigate to **Users** and click **Create user**. Name the user (e.g., `cloudguard-service-user`).
6. Under **Permissions options**, select **Attach policies directly** and search for the policy you just created (`CloudGuard-ReadOnly-Policy`). Select it and create the user.
7. Go to the new user's **Security credentials** tab, and create an **Access key** (Select "Command Line Interface (CLI)" or "Other" as the use case).
8. **Save** the `Access Key ID` and `Secret Access Key` securely.

### Step 2: Environment Configuration

1. In the project root directory, copy the `.env.example` file to create a new `.env` file:
    ```bash
    cp .env.example .env
    ```
    *(On Windows, you can duplicate the file in File Explorer and rename it to `.env`)*
2. Open the `.env` file in a text editor and fill in your AWS credentials from Step 1:
    ```ini
    AWS_ACCESS_KEY_ID=your-aws-access-key-here
    AWS_SECRET_ACCESS_KEY=your-aws-secret-key-here
    AWS_DEFAULT_REGION=ap-south-1 # or your preferred region
    ```
    *(Note: Ensure `DATA_SOURCE_MODE=aws_live` is set to pull real AWS data)*

### Step 3: Run with Docker Compose

The easiest way to run the entire stack is using Docker Compose:

1.  **Ensure Docker is running** on your system.
2.  **Build and start all services**:
    ```bash
    docker compose up --build -d
    ```
### Service Access
| Service | Link | Description |
| :--- | :--- | :--- |
| **Frontend** | [http://localhost:3000](http://localhost:3000) | Main Platform Dashboard (starts at Login) |
| **API Docs** | [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs) | Backend Gateway Swagger Docs |
| **Alert API** | [http://localhost:8003](http://localhost:8003) | Direct Alert Service Hub |

### Default Credentials (pwd: admin123)
- **Cloud Admin**: `admin@cloudguard.io`
- **FinOps Manager**: `finops@cloudguard.io`
- **Compliance Manager**: `compliance@cloudguard.io`
- **IT Admin**: `itadmin@cloudguard.io`

## 🏗️ Architecture

- **Frontend**: React + Vite + Tailwind CSS + Lucide Icons.
- **Gateway**: FastAPI + Postgres (asyncpg) + Redis (pub/sub for alerts).
- **Engines**: 
    - **FinOps Engine**: Analyzes cost metrics and finds waste.
    - **Compliance Engine**: Validates resources against governance rules.
- **Data Persistence**: Postgres for relational data, Redis for caching and real-time event streaming (SSE).

## 🛠️ Typical Workflow

1.  **Develop Logic**: Add new routers in `gateway/routers.py` and logic in the respective engine folders.
2.  **Test API**: Use the FastAPI swagger docs at `http://localhost:8000/api/v1/docs`.
3.  **UI Updates**: Modify components in `frontend/src/App.tsx`.
4.  **Rebuild**: If any core logic or Dockerfiles change, run `docker compose up --build -d`.

## 🩺 Troubleshooting

- **Blank Screen / Login Not Appearing**: 
    - **Check Debug Logs**: Open Browser Console (**F12**) and look for `[DEBUG]` messages. They track the routing and auth state.
    - **Hard Refresh**: Press `Ctrl + Shift + R` to clear browser cache.
    - **Clear State**: If you see unauthorized errors, open Console and type `localStorage.clear()` followed by a refresh.
- **Connection Refused / Network Error**: 
    - Verify Gateway is healthy: [http://localhost:8000/health](http://localhost:8000/health).
    - Ensure Docker containers are running: `docker compose ps`.
    - Restart stack: `docker compose down && docker compose up -d`.

---
Developed for secure and cost-efficient cloud operations.
