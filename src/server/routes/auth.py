"""
Authentication routes
"""
from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Literal, Optional
import httpx
import os
import re
import secrets
import string
import logging

from ..db import get_supabase_client
from ..roles import normalize_role

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SERVICE_ROLE_KEY", "")

router = APIRouter()
security = HTTPBearer()

class SignUpRequest(BaseModel):
    email: str
    password: str
    name: str
    mode: Literal["CREATE_ORG", "JOIN_ORG"] = "CREATE_ORG"
    organization_name: Optional[str] = None
    org_code: Optional[str] = None

class SignInRequest(BaseModel):
    email: str
    password: str

class UserProfile(BaseModel):
    user_id: str
    email: str
    organization_id: Optional[str] = None
    role: str
    created_at: Optional[str] = None

class AuthResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str]
    token_type: str = "bearer"
    user: dict
    profile: UserProfile
    organization: Optional[dict] = None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "org"


def _random_suffix(length: int = 4) -> str:
    """Low-entropy suffix for the public slug only — not a secret, just
    enough to avoid two companies with similar names colliding."""
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _generate_invite_code() -> str:
    """The invite code is a real credential — it gates joining an
    organization as PV_COORDINATOR — so it needs cryptographic entropy,
    not a short human-guessable string derived from public fields like the
    org name. 18 random bytes = 144 bits, URL-safe for copy/paste."""
    return secrets.token_urlsafe(18)


async def _create_organization_with_unique_codes(db, name: str) -> dict:
    """Creates an organization with a globally-unique public slug and a
    private invite code, retrying on the rare random collision instead of
    trusting a single guess against the unique DB indexes."""
    for _ in range(5):
        slug = f"{_slugify(name)}-{_random_suffix()}"
        invite_code = _generate_invite_code()
        existing = await db.query(
            "organizations",
            filters={"slug": slug},
            select="id",
        )
        if existing:
            continue
        created = await db.query(
            "organizations",
            method="POST",
            data={"name": name, "slug": slug, "invite_code": invite_code},
        )
        return created[0]
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Could not allocate a unique organization link — try again",
    )


async def _load_profile_async(user_id: str, email: str) -> tuple[UserProfile, Optional[dict]]:
    profile = await get_supabase_client().get_user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User profile not found")

    organization = profile.get("organizations")
    if isinstance(organization, list):
        organization = organization[0] if organization else None
    if organization:
        # This service-role lookup bypasses the DB's column-level grants
        # that keep invite_code out of anon/authenticated SELECTs — every
        # sign-in must strip it back out here, or it re-leaks to every
        # user regardless of role. The one deliberate exception is the
        # CREATE_ORG branch of sign_up below, which shows it once at
        # creation time; everywhere else (including this shared helper,
        # used by both /signin and /me) it's manager-gated via the
        # get_organization_invite_code() RPC instead.
        organization = {k: v for k, v in organization.items() if k != "invite_code"}
    return (
        UserProfile(
            user_id=user_id,
            email=email,
            organization_id=profile.get("organization_id"),
            role=normalize_role(profile.get("role", "")),
            created_at=profile.get("created_at"),
        ),
        organization,
    )

@router.post("/signup")
async def sign_up(request: SignUpRequest):
    """
    Sign up a new user with email/password.

    CREATE_ORG mints a brand-new organization (a new public slug and a
    private invite code) and makes the signing-up user its PV_MANAGER.
    JOIN_ORG requires an existing organization's exact invite_code and
    attaches the user as a PV_COORDINATOR — organizations are never
    resolved by matching name text, which used to let anyone claim ADMIN
    on an existing company by typing its name.
    """
    try:
        db = get_supabase_client()

        if request.mode == "JOIN_ORG":
            if not request.org_code or not request.org_code.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="An organization code is required to join an existing organization",
                )
            matches = await db.query(
                "organizations",
                filters={"invite_code": request.org_code.strip()},
                select="*",
            )
            if not matches:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No organization matches that code",
                )
            organization = matches[0]
            new_member_role = "PV_COORDINATOR"
        else:
            organization = await _create_organization_with_unique_codes(
                db, request.organization_name or f"{request.email}'s Organization"
            )
            new_member_role = "PV_MANAGER"

        async with httpx.AsyncClient() as client:
            # Create auth user
            auth_response = await client.post(
                f"{SUPABASE_URL}/auth/v1/signup",
                headers={
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Content-Type": "application/json"
                },
                json={
                    "email": request.email,
                    "password": request.password,
                    "data": {"name": request.name},
                }
            )

        if auth_response.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to create user"
            )

        auth_data = auth_response.json()
        user_id = auth_data.get("user", {}).get("id")
        access_token = auth_data.get("access_token")

        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User creation failed"
            )

        await db.query(
            "profiles",
            method="POST",
            data={
                "id": user_id,
                "organization_id": organization["id"],
                "full_name": request.name,
                "email": request.email,
                "role": new_member_role,
            },
        )
        profile = UserProfile(
            user_id=user_id,
            email=request.email,
            organization_id=organization["id"],
            role=new_member_role,
        )

        # The invite code is a credential — only ever return it to the
        # person creating the organization, never to someone joining it.
        organization_payload = dict(organization)
        if request.mode == "JOIN_ORG":
            organization_payload.pop("invite_code", None)

        return AuthResponse(
            access_token=access_token,
            refresh_token=auth_data.get("refresh_token"),
            user={
                "id": user_id,
                "email": request.email,
                "user_metadata": {
                    "name": request.name
                }
            },
            profile=profile,
            organization=organization_payload,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sign up error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sign up failed"
        )

@router.post("/signin")
async def sign_in(request: SignInRequest):
    """
    Sign in with email/password
    Returns JWT token and user profile
    """
    logger.info("AUTH: signin endpoint reached")
    try:
        async with httpx.AsyncClient() as client:
            logger.info("AUTH: Supabase authentication attempted")
            response = await client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Content-Type": "application/json"
                },
                json={
                    "email": request.email,
                    "password": request.password
                }
            )
        
        if response.status_code >= 400:
            error_payload = response.json()
            logger.warning(
                "AUTH: Supabase authentication failed with status=%s code=%s error=%s",
                response.status_code,
                error_payload.get("error_code"),
                error_payload.get("error"),
            )
            error_detail = error_payload.get("error_description", "Invalid credentials")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=error_detail
            )
        
        data = response.json()
        logger.info("AUTH: Supabase authentication succeeded")
        user_data = data.get("user", {})
        user_id = user_data.get("id")
        email = user_data.get("email")
        
        profile, organization = await _load_profile_async(user_id, email)
        
        return AuthResponse(
            access_token=data.get("access_token"),
            refresh_token=data.get("refresh_token"),
            user={
                "id": user_id,
                "email": email,
                "user_metadata": {
                    "name": email.split("@")[0]
                }
            },
            profile=profile,
            organization=organization,
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sign in error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed"
        )

@router.get("/me")
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Get current user profile using Bearer token
    """
    try:
        token = credentials.credentials
        
        async with httpx.AsyncClient() as client:
            # Verify token with Supabase
            response = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": SUPABASE_SERVICE_ROLE_KEY
                }
            )
        
        if response.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )
        
        user_data = response.json()
        user_id = user_data.get("id")
        email = user_data.get("email")
        
        profile, _ = await _load_profile_async(user_id, email)
        
        return profile
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get current user error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to verify token"
        )

@router.post("/signout")
async def sign_out(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Sign out (optional - mainly for client-side cleanup)
    Backend doesn't maintain sessions, token validity is handled by Supabase
    """
    # In a real system, you might revoke the token or log the logout
    # For now, just acknowledge the request
    return {"message": "Signed out successfully"}
