from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
import os
import logging
from passlib.context import CryptContext
from models import UserRole

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "fallback-secret-key")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
logger = logging.getLogger(__name__)

# Roles that are equivalent to cloud_admin (backward compat)
CLOUD_ADMIN_ROLES = {UserRole.CLOUD_ADMIN.value, UserRole.ADMIN.value}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


from fastapi import Request

async def get_current_user(request: Request) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # 1. Try to get token from Header
    auth_header = request.headers.get("Authorization")
    token = None
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    
    # 2. Fallback to Query Parameter (for SSE/EventSource)
    if not token:
        token = request.query_params.get("token")
        
    if not token:
        raise credentials_exception

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        role: str = payload.get("role")
        if email is None:
            raise credentials_exception
        return {"email": email, "role": role, "user_id": payload.get("user_id")}
    except JWTError:
        raise credentials_exception


def require_roles(*roles: UserRole):
    """Role-based access control dependency factory."""
    allowed = {r.value for r in roles}

    async def role_checker(current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {list(allowed)}"
            )
        return current_user

    return role_checker


def require_role(allowed_roles: List[str]):
    """Generic role dependency using plain string list."""
    async def role_checker(current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {allowed_roles}"
            )
        return current_user
    return role_checker


# ── Convenience Role Dependencies ────────────────────────────
# cloud_admin and legacy admin can access everything
require_cloud_admin = require_roles(UserRole.CLOUD_ADMIN, UserRole.ADMIN)

# FinOps routes: finops_manager + cloud admins
require_finops = require_roles(
    UserRole.FINOPS_MANAGER, UserRole.CLOUD_ADMIN, UserRole.ADMIN
)

# Compliance routes: compliance_manager + cloud admins
require_compliance = require_roles(
    UserRole.COMPLIANCE_MANAGER, UserRole.COMPLIANCE_OFFICER,
    UserRole.CLOUD_ADMIN, UserRole.ADMIN
)

# IT Admin routes: it_admin + cloud admins
require_it_admin = require_roles(
    UserRole.IT_ADMIN, UserRole.CLOUD_ADMIN, UserRole.ADMIN
)

# Any authenticated user (alerts, ingest)
require_authenticated = require_roles(
    UserRole.CLOUD_ADMIN, UserRole.ADMIN,
    UserRole.FINOPS_MANAGER,
    UserRole.COMPLIANCE_MANAGER, UserRole.COMPLIANCE_OFFICER,
    UserRole.IT_ADMIN, UserRole.VIEWER
)

# Legacy alias
require_admin = require_cloud_admin
