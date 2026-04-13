import os
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from databases import Database
from routers import auth_router, ingest_router, alerts_router, public_alerts_router, finops_router, compliance_router, admin_router, activity_router, threshold_router

# ── Logging Setup ─────────────────────────────────────────────
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "gateway", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

# ── Database & Redis ──────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://cloudguard_user:cloudguard_secret_2024@localhost:5432/cloudguard")

database = Database(DATABASE_URL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting CloudGuard Gateway...")
    
    # Retry logic for database connection
    max_retries = 5
    retry_interval = 2
    for i in range(max_retries):
        try:
            await database.connect()
            logger.info("Database connected.")
            break
        except Exception as e:
            if i == max_retries - 1:
                logger.error(f"Failed to connect to database after {max_retries} attempts: {e}")
                raise
            logger.warning(f"Database connection attempt {i+1} failed ({e}). Retrying in {retry_interval}s...")
            await asyncio.sleep(retry_interval)
            
    yield
    await database.disconnect()
    logger.info("Connections closed.")


# ── App Factory ───────────────────────────────────────────────
app = FastAPI(
    title="CloudGuard API Gateway",
    description="Unified Cloud Governance Platform — API Gateway",
    version="1.0.0",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Logging Middleware ────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = round((time.time() - start) * 1000, 2)
    logger.info(f"{request.method} {request.url.path} {response.status_code} {duration}ms")
    return response


# ── Health Check ──────────────────────────────────────────────
@app.get("/health", tags=["Health"])
async def health():
    return {
        "status": "healthy",
        "service": "cloudguard-gateway",
        "version": "1.0.0"
    }


# ── Register Routers ──────────────────────────────────────────
app.include_router(auth_router)
app.include_router(ingest_router)
app.include_router(alerts_router)
app.include_router(public_alerts_router)
app.include_router(finops_router)
app.include_router(compliance_router)
app.include_router(admin_router)
app.include_router(activity_router)
app.include_router(threshold_router)


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    error_msg = f"Unhandled error during {request.method} {request.url.path}: {str(exc)}"
    logger.error(error_msg, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_type": type(exc).__name__}
    )
