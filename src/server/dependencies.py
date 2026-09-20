"""
Authentication and authorization dependencies
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import hashlib
import httpx
import os
import time
from collections import OrderedDict
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

# One line list means one request per row — coding 50 reactions fires 50
# authenticated requests at once, each of which used to verify the token
# upstream and load the profile again. That burst is what times out, and a
# timed-out verification is reported as "temporarily unavailable", so a
# whole file came back "not fully checked" over nothing.
#
# A verified identity is therefore remembered for a minute, keyed by the
# token. The cost is bounded and stated plainly: a session revoked upstream
# keeps working here for at most _IDENTITY_TTL_SECONDS. Nothing is cached
# unless Supabase accepted the token, and a failure is never cached.
_IDENTITY_TTL_SECONDS = 60.0
_IDENTITY_CACHE_MAX = 512
_identity_cache: "OrderedDict[str, tuple[float, AuthenticatedUser]]" = OrderedDict()


def _token_key(token: str) -> str:
    """The cache is keyed by a digest, so a bearer token is never held in
    memory as a dictionary key."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cached_identity(token: str) -> Optional[AuthenticatedUser]:
    entry = _identity_cache.get(_token_key(token))
    if not entry:
        return None
    expires_at, user = entry
    if expires_at <= time.monotonic():
        _identity_cache.pop(_token_key(token), None)
        return None
    return user


def _remember_identity(token: str, user: AuthenticatedUser) -> None:
    key = _token_key(token)
    _identity_cache[key] = (time.monotonic() + _IDENTITY_TTL_SECONDS, user)
    _identity_cache.move_to_end(key)
    while len(_identity_cache) > _IDENTITY_CACHE_MAX:
        _identity_cache.popitem(last=False)


def forget_cached_identities() -> None:
    """Drops every remembered identity. For tests, and for a sign-out that
    should not leave a minute of grace behind it."""
    _identity_cache.clear()


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

    remembered = _cached_identity(token)
    if remembered is not None:
        return remembered

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

        user = AuthenticatedUser(
            user_id=user_id,
            email=email,
            organization_id=profile.get("organization_id"),
            role=role,
        )
        _remember_identity(token, user)
        return user

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


def require_any_permission(*permissions: str):
    """Admit a caller holding AT LEAST ONE of these permissions.

    Needed where one endpoint legitimately serves two different jobs. The AI
    review of a periodic report is the case that prompted it: the Review
    Officer runs it to screen an incoming report, and an Evaluator runs it
    again during scientific review. They hold different permissions for
    genuinely different reasons, and collapsing them into a single shared
    permission would have handed each of them the other's authority.
    """
    async def permission_checker(user: AuthenticatedUser = Depends(get_current_user)):
        if not any(has_permission(user.role, permission) for permission in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )
        return user

    return permission_checker
