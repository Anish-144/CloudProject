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
3.  **Access the application**:
    - **Frontend**: [http://localhost:3000](http://localhost:3000)
    - **API Gateway**: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)
    - **Alert Service**: [http://localhost:8003](http://localhost:8003)

### Default Credentials
- **Email**: `admin@test.com`
- **Password**: `admin123`

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
4.  **Rebuild**: If dependencies change, run `docker compose up --build`.

## 🩺 Health Check & Troubleshooting

- **Health Endpoint**: [http://localhost:8000/health](http://localhost:8000/health)
- **View Logs**: `docker compose logs -f gateway`
- **Common Fix**: If you see `ERR_EMPTY_RESPONSE`, ensure the `postgres` and `redis` containers are healthy (`docker compose ps`).

---
Developed for secure and cost-efficient cloud operations.
