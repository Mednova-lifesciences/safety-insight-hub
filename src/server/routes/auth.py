"""
Authentication routes
"""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import httpx
import os
import logging

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

router = APIRouter()

class SignUpRequest(BaseModel):
    email: str
    password: str
    full_name: str
    organization_name: Optional[str] = None

class SignInRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str]
    user: dict

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
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User creation failed"
            )
        
        # Create organization
        from ..db import get_supabase_client
        db = get_supabase_client()
        
        org_results = await db.query(
            "organizations",
            method="POST",
            data={"name": request.organization_name or f"{request.email}'s Organization"}
        )
        org_id = org_results[0]["id"] if org_results else None
        
        # Create profile
        profile_results = await db.query(
            "profiles",
            method="POST",
            data={
                "id": user_id,
                "organization_id": org_id,
                "full_name": request.full_name,
                "email": request.email,
                "role": "ADMIN"  # First user is admin
            }
        )
        
        return {
            "user_id": user_id,
            "email": request.email,
            "message": "Sign up successful. Please log in."
        }
    
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
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )
        
        data = response.json()
        return AuthResponse(
            access_token=data.get("access_token"),
            refresh_token=data.get("refresh_token"),
            user={
                "id": data.get("user", {}).get("id"),
                "email": data.get("user", {}).get("email")
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
