"""
Authentication routes
"""
from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
import httpx
import os
import logging

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

router = APIRouter()
security = HTTPBearer()

class SignUpRequest(BaseModel):
    email: str
    password: str
    name: str
    organization_name: Optional[str] = None

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

@router.post("/signup")
async def sign_up(request: SignUpRequest):
    """
    Sign up a new user with email/password
    """
    try:
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
                    "password": request.password
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
        
        # Create organization and profile
        # Note: Database integration would happen here
        # For now, return basic auth response
        
        profile = UserProfile(
            user_id=user_id,
            email=request.email,
            organization_id=None,
            role="ADMIN"  # First user is admin
        )
        
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
            organization={
                "id": "org_default",
                "name": request.organization_name or f"{request.email}'s Organization"
            }
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
    try:
        async with httpx.AsyncClient() as client:
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
            error_detail = response.json().get("error_description", "Invalid credentials")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=error_detail
            )
        
        data = response.json()
        user_data = data.get("user", {})
        user_id = user_data.get("id")
        email = user_data.get("email")
        
        # In production, fetch user profile from database
        # For MVP, return basic profile
        profile = UserProfile(
            user_id=user_id,
            email=email,
            organization_id=None,
            role="COORDINATOR"
        )
        
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
            organization={
                "id": "org_default",
                "name": "MedNova Drug Safety"
            }
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
        
        # In production, fetch full profile from database
        # For MVP, return basic profile
        profile = UserProfile(
            user_id=user_id,
            email=email,
            organization_id=None,
            role="COORDINATOR"
        )
        
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
