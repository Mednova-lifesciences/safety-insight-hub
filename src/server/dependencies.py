"""
Authentication and authorization dependencies
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx
import os
from typing import Optional
import logging

from .roles import has_permission, normalize_role

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")

security = HTTPBearer()

class AuthenticatedUser:
    def __init__(self, user_id: str, email: str, organization_id: str, role: str):
        self.user_id = user_id
        self.email = email
        self.organization_id = organization_id
        self.role = role

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> AuthenticatedUser:
    """
    Verify JWT token from Supabase and return authenticated user
    """
    token = credentials.credentials
    
    # Verify token with Supabase
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SERVICE_ROLE_KEY", ""),
                    "Content-Type": "application/json"
                }
            )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        user_data = response.json()
        user_id = user_data.get("id")
        email = user_data.get("email")
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )
        
        # Get user profile from database to get org and role
        from .db import get_supabase_client
        
        client = get_supabase_client()
        profile = await client.get_user_profile(user_id)
        
        if not profile:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User profile not found",
            )
        
        try:
            role = normalize_role(profile.get("role", ""))
        except ValueError as error:
            logger.error("Invalid role for user %s: %s", user_id, error)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid user role") from error

        return AuthenticatedUser(
            user_id=user_id,
            email=email,
            organization_id=profile.get("organization_id"),
            role=role,
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Auth error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
        )

def require_role(*allowed_roles):
    """
    Decorator to check user role
    """
    async def role_checker(user: AuthenticatedUser = Depends(get_current_user)):
        normalized_roles = {normalize_role(role) for role in allowed_roles}
        if user.role not in normalized_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of: {', '.join(allowed_roles)}"
            )
        return user
    return role_checker


def require_permission(permission: str):
    async def permission_checker(user: AuthenticatedUser = Depends(get_current_user)):
        if not has_permission(user.role, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return permission_checker
