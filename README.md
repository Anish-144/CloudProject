# CloudGuard - Unified Cloud Governance Platform

CloudGuard is a full-stack application designed for cloud governance, focusing on **FinOps** (cost optimization), **Compliance** (security rules), and **Real-time Alerting**.

## 🚀 Getting Started

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- [Node.js v18+](https://nodejs.org/) (optional, for local frontend development)
- [Python 3.11+](https://www.python.org/) (optional, for local gateway development)

### Quick Start (Docker)
The easiest way to run the entire stack is using Docker Compose:

1.  **Clone the repository** (if not already local).
2.  **Start all services**:
    ```bash
    docker compose up -d
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
