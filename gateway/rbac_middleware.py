"""
RBAC Middleware Module - Enterprise-grade Role-Based Access Control
Provides centralized role verification and authorization logic
"""

from fastapi import HTTPException, Depends, status
from functools import wraps
from typing import List, Optional, Callable, Any
import logging
from auth import get_current_user

logger = logging.getLogger(__name__)


class RBACMiddleware:
    """Enterprise-grade RBAC enforcement"""
    
    # Define role hierarchy and permissions
    ROLE_HIERARCHY = {
        'cloud_admin': {
            'description': 'Cloud Administration',
            'permissions': [
                'admin:*',
                'admin:overview',
                'admin:users',
                'admin:resources',
                'admin:audit',
                'admin:clear_data',
                'alerts:*',
                'ingest:*'
            ],
            'allowed_routes': [
                '/admin',
                '/dashboard/admin',
                '/api/v1/admin/*',
                '/api/v1/alerts/*',
                '/api/v1/ingest/*',
            ],
            'forbidden_routes': [
                '/finops',
                '/dashboard/finops',
                '/compliance',
                '/dashboard/compliance',
                '/infrastructure',
                '/dashboard/infra',
                '/api/v1/finops/*',
                '/api/v1/compliance/*',
            ]
        },
        'finops_admin': {
            'description': 'FinOps Administration',
            'permissions': [
                'finops:*',
                'alerts:view',
            ],
            'allowed_routes': [
                '/finops',
                '/dashboard/finops',
                '/api/v1/finops/*',
                '/api/v1/alerts',
            ],
            'forbidden_routes': [
                '/admin',
                '/dashboard/admin',
                '/compliance',
                '/dashboard/compliance',
                '/infrastructure',
                '/dashboard/infra',
            ]
        },
        'compliance_admin': {
            'description': 'Compliance Administration',
            'permissions': [
                'compliance:*',
                'alerts:view',
            ],
            'allowed_routes': [
                '/compliance',
                '/dashboard/compliance',
                '/api/v1/compliance/*',
                '/api/v1/alerts',
            ],
            'forbidden_routes': [
                '/admin',
                '/dashboard/admin',
                '/finops',
                '/dashboard/finops',
                '/infrastructure',
                '/dashboard/infra',
            ]
        },
        'infra_admin': {
            'description': 'Infrastructure Administration',
            'permissions': [
                'infrastructure:*',
                'alerts:*',
            ],
            'allowed_routes': [
                '/infrastructure',
                '/dashboard/infra',
                '/api/v1/alerts/*',
            ],
            'forbidden_routes': [
                '/admin',
                '/dashboard/admin',
                '/finops',
                '/dashboard/finops',
                '/compliance',
                '/dashboard/compliance',
            ]
        },
    }

    @staticmethod
    def verify_role(required_roles: List[str]):
        """
        Dependency factory for role-based access control.
        
        Args:
            required_roles: List of allowed role names
            
        Returns:
            Async function that validates user role
            
        Raises:
            HTTPException 403 if role not authorized
        """
        async def role_checker(current_user: dict = Depends(get_current_user)):
            user_role = current_user.get('role')
            
            if user_role not in required_roles:
                logger.warning(
                    f"Unauthorized access attempt - User: {current_user.get('email')}, "
                    f"Role: {user_role}, Required: {required_roles}"
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Insufficient permissions. Required roles: {required_roles}"
                )
            
            logger.info(f"Authorized access - User: {current_user.get('email')}, Role: {user_role}")
            return current_user
        
        return role_checker

    @staticmethod
    def check_route_access(user_role: str, route_path: str) -> bool:
        """
        Check if a user role can access a specific route path
        
        Args:
            user_role: User's role
            route_path: Request path
            
        Returns:
            True if access allowed, False otherwise
        """
        if user_role not in RBACMiddleware.ROLE_HIERARCHY:
            logger.error(f"Unknown role: {user_role}")
            return False
        
        role_config = RBACMiddleware.ROLE_HIERARCHY[user_role]
        forbidden_routes = role_config.get('forbidden_routes', [])
        
        # Check if route matches any forbidden patterns
        for forbidden in forbidden_routes:
            if RBACMiddleware._matches_pattern(route_path, forbidden):
                return False
        
        return True

    @staticmethod
    def _matches_pattern(path: str, pattern: str) -> bool:
        """
        Simple wildcard pattern matching for routes
        
        Args:
            path: Actual route path
            pattern: Pattern with optional wildcards (e.g., /api/v1/finops/*)
            
        Returns:
            True if path matches pattern
        """
        if pattern.endswith('/*'):
            pattern_prefix = pattern[:-2]
            return path.startswith(pattern_prefix)
        return path == pattern


# Convenience dependency factories for common roles
async def require_cloud_admin(current_user: dict = Depends(RBACMiddleware.verify_role(['cloud_admin']))):
    """Require cloud_admin role"""
    return current_user

async def require_finops_admin(current_user: dict = Depends(RBACMiddleware.verify_role(['finops_admin']))):
    """Require finops_admin role"""
    return current_user

async def require_compliance_admin(current_user: dict = Depends(RBACMiddleware.verify_role(['compliance_admin']))):
    """Require compliance_admin role"""
    return current_user

async def require_infra_admin(current_user: dict = Depends(RBACMiddleware.verify_role(['infra_admin']))):
    """Require infra_admin role"""
    return current_user


def enforce_rbac(required_roles: List[str]):
    """
    Decorator for enforcing RBAC on route handlers
    
    Usage:
        @router.get("/admin/users")
        @enforce_rbac(['cloud_admin'])
        async def get_users(current_user: dict = Depends(get_current_user)):
            ...
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, current_user: dict = Depends(get_current_user), **kwargs):
            if current_user.get('role') not in required_roles:
                logger.warning(
                    f"Unauthorized - User: {current_user.get('email')}, "
                    f"Role: {current_user.get('role')}, Required: {required_roles}"
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Insufficient permissions"
                )
            return await func(*args, current_user=current_user, **kwargs)
        return wrapper
    return decorator
