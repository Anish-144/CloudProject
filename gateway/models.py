from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Any
from datetime import datetime
from uuid import UUID
from enum import Enum


class UserRole(str, Enum):
    ADMIN = "admin"                         # backward compat → treated as cloud_admin
    CLOUD_ADMIN = "cloud_admin"
    FINOPS_MANAGER = "finops_manager"
    COMPLIANCE_MANAGER = "compliance_manager"
    COMPLIANCE_OFFICER = "compliance_officer"   # legacy alias
    IT_ADMIN = "it_admin"
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
    email: str


# ── Log Ingestion Models ─────────────────────────────────────
class LogEntry(BaseModel):
    resource_id: str
    cpu_usage: float = Field(..., ge=0, le=100)
    memory_usage: float = Field(..., ge=0, le=100)
    cost: float = Field(..., ge=0)
    network_in_gb: float = Field(default=0, ge=0)
    network_out_gb: float = Field(default=0, ge=0)
    tags: Optional[dict] = {}
    public_access: Optional[bool] = None
    encryption_at_rest: Optional[bool] = None
    mfa_enabled: Optional[bool] = None
    is_root_account: Optional[bool] = None
    logging_enabled: Optional[bool] = None
    in_private_subnet: Optional[bool] = None
    daily_cost: Optional[float] = None
    timestamp: Optional[datetime] = None
    # IAM user fields
    user: Optional[str] = None
    service: Optional[str] = None
    action: Optional[str] = None


class LogBatch(BaseModel):
    logs: list[LogEntry]


class IngestResponse(BaseModel):
    accepted: int
    message: str


# ── Alert Models ─────────────────────────────────────────────
class AlertOut(BaseModel):
    id: UUID
    type: str
    source_id: Optional[UUID] = None
    severity: str
    message: str
    details: Optional[dict] = None
    status: str
    priority: float
    target_roles: Optional[list[str]] = []
    iam_user: Optional[str] = None
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


# ── Admin Models ─────────────────────────────────────────────
class UserOut(BaseModel):
    id: UUID
    email: str
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── User Activity Models ─────────────────────────────────────
class UserActivityOut(BaseModel):
    id: UUID
    iam_user: str
    service: str
    action: str
    resource_id: Optional[str] = None
    source_ip: Optional[str] = None
    region: Optional[str] = None
    details: Optional[dict] = None
    event_time: datetime

    class Config:
        from_attributes = True


# ── Threshold Models ─────────────────────────────────────────
class ThresholdCreate(BaseModel):
    type: str = Field(..., pattern="^(budget|cost_spike|cpu_usage|custom)$")
    metric: str = "total_cost"
    value: float = Field(..., ge=0)
    iam_user: Optional[str] = None
    description: Optional[str] = None


class ThresholdOut(BaseModel):
    id: UUID
    type: str
    metric: str
    value: float
    iam_user: Optional[str] = None
    description: Optional[str] = None
    active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Per-User Cost Model ──────────────────────────────────────
class UserCostOut(BaseModel):
    iam_user: str
    total_cost_30d: float
    resource_count: int
    avg_daily_cost: float


# ── Admin Resource Monitoring Models ─────────────────────────
class AdminOverview(BaseModel):
    total_resources: int
    running_resources: int
    idle_resources: int
    estimated_savings: float
    compliance_score: float


class AdminResource(BaseModel):
    resource_id: str
    type: str
    name: Optional[str] = None
    state: str
    region: Optional[str] = None
    cpu: Optional[float] = None
    size_mb: Optional[float] = None
    last_activity: Optional[datetime] = None
    estimated_cost: float = 0.0
    idle: bool = False
    recommendation: Optional[str] = None
    iam_user: Optional[str] = None
    last_updated: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserSummaryOut(BaseModel):
    iam_user: str
    resource_count: int
    idle_resources: int
    total_cost: float


class FinOpsResourceSummaryOut(BaseModel):
    total_cost: float
    idle_cost: float
    potential_savings: float


class ComplianceSummaryOut(BaseModel):
    risky_users: int
    policy_issues: int
    recommendations: list[str]
