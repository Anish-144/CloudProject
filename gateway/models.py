from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Any
from datetime import datetime
from uuid import UUID
from enum import Enum


class UserRole(str, Enum):
    ADMIN = "admin"
    FINOPS_MANAGER = "finops_manager"
    COMPLIANCE_OFFICER = "compliance_officer"
    VIEWER = "viewer"


class AlertSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertStatus(str, Enum):
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


# ── Auth Models ──────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


# ── Log Ingestion Models ─────────────────────────────────────
class LogEntry(BaseModel):
    resource_id: str
    cpu_usage: float = Field(..., ge=0, le=100)
    memory_usage: float = Field(..., ge=0, le=100)
    cost: float = Field(..., ge=0)
    network_in_gb: float = Field(default=0, ge=0)
    network_out_gb: float = Field(default=0, ge=0)
    tags: Optional[dict] = {}
    # Compliance-related metadata
    public_access: Optional[bool] = None
    encryption_at_rest: Optional[bool] = None
    mfa_enabled: Optional[bool] = None
    is_root_account: Optional[bool] = None
    logging_enabled: Optional[bool] = None
    in_private_subnet: Optional[bool] = None
    daily_cost: Optional[float] = None
    timestamp: Optional[datetime] = None


class LogBatch(BaseModel):
    logs: list[LogEntry]


class IngestResponse(BaseModel):
    accepted: int
    message: str


# ── Alert Models ─────────────────────────────────────────────
class AlertOut(BaseModel):
    id: UUID
    type: str
    source_id: Optional[UUID]
    severity: str
    message: str
    details: Optional[dict]
    status: str
    priority: float
    created_at: datetime

    class Config:
        from_attributes = True


class AlertFilterParams(BaseModel):
    severity: Optional[AlertSeverity] = None
    status: Optional[AlertStatus] = None
    type: Optional[str] = None
    limit: int = Field(default=50, le=200)
    offset: int = 0


# ── FinOps Models ────────────────────────────────────────────
class FinOpsSummary(BaseModel):
    total_savings_potential: float
    idle_resources: int
    overprovisioned_resources: int
    cost_spike_resources: int
    avg_monthly_cost: float
    forecast_30d: float


# ── Compliance Models ────────────────────────────────────────
class ComplianceScore(BaseModel):
    overall_score: float
    total_rules: int
    violated_rules: int
    active_violations: int
    critical_violations: int
    high_violations: int
    medium_violations: int
    low_violations: int
    by_category: dict[str, float]
