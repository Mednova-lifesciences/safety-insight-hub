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

# httpx's default timeout is 5s across connect/read/write. Verification is
# one small request to Supabase and should never take that long, so a
# tighter budget with one retry beats a single slow attempt: the failure
# being guarded against is a brief blip, and waiting 5s to report it costs
# the user the whole request.
_VERIFY_TIMEOUT = httpx.Timeout(3.0, connect=3.0)
_VERIFY_ATTEMPTS = 2


async def _verify_token_with_supabase(token: str) -> httpx.Response:
    """Asks Supabase whether this token is valid, retrying a transport
    failure once.

    Every authenticated request makes this hop, so a momentary network
    problem between Render and Supabase used to fail a request outright.
    Retrying once costs nothing on the normal path and removes the
    single-blip failure entirely. A response is returned as-is — deciding
    what a non-200 MEANS is the caller's job, and the distinction that
    matters is upstream-said-no (401/403) versus upstream-had-a-problem
    (anything else), which the old code collapsed into one answer.
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SERVICE_ROLE_KEY", ""),
        "Content-Type": "application/json",
    }
    last_error: Optional[httpx.HTTPError] = None
    for attempt in range(_VERIFY_ATTEMPTS):
        try:
            async with httpx.AsyncClient(timeout=_VERIFY_TIMEOUT) as client:
                return await client.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers)
        except httpx.HTTPError as error:
            last_error = error
            if attempt + 1 < _VERIFY_ATTEMPTS:
                logger.warning("Token verification attempt %s failed (%s); retrying", attempt + 1, error)
    assert last_error is not None
    raise last_error


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> AuthenticatedUser:
    """
    Verify JWT token from Supabase and return authenticated user
    """
    token = credentials.credentials

    # Verify token with Supabase
    try:
        response = await _verify_token_with_supabase(token)

        if response.status_code != 200:
            # Only Supabase actually rejecting the token is an auth failure.
            # Anything else it returns is Supabase having a problem, not the
            # caller presenting a bad one — see _verify_token_with_supabase.
            if response.status_code in (401, 403):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication credentials",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            logger.error(
                "Token verification upstream returned %s; reporting as unavailable, not as a bad token",
                response.status_code,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Could not verify your session right now. Please try again.",
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
    except httpx.HTTPError as e:
        # The verification hop itself failed — a timeout, a dropped
        # connection, DNS. This says nothing whatsoever about the token, and
        # calling it 401 was actively misleading: the frontend reads a 401 as
        # "your session ended" and moves the user towards signing in again,
        # so a two-second network blip on Render looked to the user like
        # being logged out. Reproduced live as intermittent 401s on
        # /map-columns and /map-outcomes with a valid, freshly-issued token
        # attached, roughly one run in four.
        logger.error("Token verification transport failure: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not verify your session right now. Please try again.",
        ) from e
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
