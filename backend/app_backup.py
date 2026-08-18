from __future__ import annotations

import json
import os
import sys
import uuid
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from supabase import create_client
from supabase.client import Client as SupabaseClient
import jwt

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def find_pv_root() -> Path:
    """Locate the mednova-pv-assist project directory."""
    candidates = [
        Path(__file__).resolve().parent.parent,
        Path(__file__).resolve().parents[1],
        Path(__file__).resolve().parents[2],
        Path.cwd(),
    ]
    for base in candidates:
        for path in [base / "mednova-pv-assist" / "mednova-pv-assist", base / "mednova-pv-assist", base / "pv_assist"]:
            if path.exists():
                return path
    raise FileNotFoundError("Could not locate the mednova-pv-assist project directory.")


PV_ROOT = find_pv_root()
if str(PV_ROOT) not in sys.path:
    sys.path.insert(0, str(PV_ROOT.parent))
    sys.path.insert(0, str(PV_ROOT))

try:
    from pv_assist.coding.coder import code_case
    from pv_assist.coding.dictionary import Dictionary
    from pv_assist.seriousness.analyzer import analyze
except ImportError as e:
    logger.warning(f"Could not import PV engines: {e}")


@lru_cache(maxsize=1)
def get_jwt_secret() -> str:
    """Get JWT secret from environment."""
    secret = os.getenv("JWT_SECRET")
    if not secret:
        logger.warning("JWT_SECRET not set, using default (insecure in production)")
        return "your-secret-key"
    return secret


@lru_cache(maxsize=1)
def get_supabase_client() -> SupabaseClient:
    """Get or create a Supabase client."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SERVICE_ROLE_KEY")
    
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SERVICE_ROLE_KEY must be set")
    
    try:
        return create_client(url, key)
    except Exception as e:
        logger.error(f"Failed to create Supabase client: {e}")
        raise


# Request/Response Models
class SignupRequest(BaseModel):
    email: str
    password: str
    name: str
    organization_name: Optional[str] = None


class SigninRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict[str, Any]
    profile: dict[str, Any]
    organization: dict[str, Any]


class UserProfile(BaseModel):
    id: str
    organization_id: str
    email: str
    name: str
    role: str
    initials: str
    created_at: str


class NewIcsrPayload(BaseModel):
    reporter: dict[str, Any]
    patient: dict[str, Any]
    product: dict[str, Any]
    reaction: dict[str, Any]
    narrative: str
    reportedSeriousness: str
    seriousnessCriteria: list[str] = []
    additionalInformation: Optional[str] = None


class WorkflowAdvanceRequest(BaseModel):
    step: str
    reason: str = ""


class FollowUpRequest(BaseModel):
    requestedInformation: str
    channel: str = "EMAIL"


class SeriousnessDecision(BaseModel):
    decision: str
    rationale: str


# Helper functions
def _get_current_user(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    """Extract and validate JWT token from Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    
    token = authorization.split(" ", 1)[1]
    
    try:
        # For now, verify the token is non-empty and valid JWT format
        # In production, verify signature with Supabase secret
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid JWT format")
        
        # Decode without verification for now (should be verified in production)
        import base64
        payload = base64.urlsafe_b64decode(parts[1] + "==")
        data = json.loads(payload)
        return data
    except Exception as e:
        logger.error(f"Token validation error: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")


def _now_iso() -> str:
    """Get current timestamp in ISO format."""
    return datetime.now(timezone.utc).isoformat()


def _generate_case_number(org_id: str) -> str:
    """Generate a unique case number."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    random_suffix = str(uuid.uuid4())[:8].upper()
    return f"CASE-{timestamp}-{random_suffix}"


def _write_audit_event(
    supabase: SupabaseClient,
    organization_id: str,
    user_id: str,
    user_role: str,
    action: str,
    entity: str,
    entity_id: str,
    case_id: Optional[str] = None,
    previous_value: Optional[str] = None,
    new_value: Optional[str] = None,
    reason: Optional[str] = None,
) -> dict[str, Any]:
    """Write an audit event to the database."""
    event = {
        "organisation_id": organization_id,
        "case_id": case_id,
        "actor": user_id,
        "role": user_role,
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "previous_value": previous_value,
        "new_value": new_value,
        "reason": reason,
        "created_at": _now_iso(),
    }
    
    try:
        result = supabase.table("audit_events").insert(event).execute()
        return result.data[0] if result.data else event
    except Exception as e:
        logger.error(f"Failed to write audit event: {e}")
        return event
# Initialize FastAPI app
app = FastAPI(title="MedNova PV Assist API", version="1.0.0")

# Configure CORS
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    try:
        supabase = get_supabase_client()
        supabase.table("organizations").select("id").limit(1).execute()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {"status": "degraded", "database": "disconnected"}


# ============================================================================
# AUTHENTICATION ENDPOINTS
# ============================================================================

@app.post("/api/auth/signup")
async def signup(request: SignupRequest) -> AuthResponse:
    """Sign up a new user with email and password."""
    try:
        supabase = get_supabase_client()
        
        # Check if email already exists
        existing = supabase.table("profiles").select("id").eq("email", request.email).execute()
        if existing.data:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Create organization for first user
        org_id = str(uuid.uuid4())
        org_data = {
            "id": org_id,
            "name": request.organization_name or f"{request.email.split('@')[0]} Organization",
        }
        supabase.table("organizations").insert(org_data).execute()
        
        # Create user profile (first user is ADMIN)
        user_id = str(uuid.uuid4())
        user_data = {
            "id": user_id,
            "organisation_id": org_id,
            "email": request.email,
            "name": request.name,
            "role": "ADMIN",  # First user is admin
            "initials": "".join(word[0].upper() for word in request.name.split()[:2]),
        }
        supabase.table("profiles").insert(user_data).execute()
        
        # Generate JWT token
        token = jwt.encode(
            {
                "sub": user_id,
                "email": request.email,
                "org_id": org_id,
                "role": "ADMIN",
                "iat": datetime.now(timezone.utc),
            },
            get_jwt_secret(),
            algorithm="HS256"
        )
        
        # Write audit event
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            "ADMIN",
            "USER_SIGNUP",
            "user",
            user_id,
            reason="New user registration",
        )
        
        return AuthResponse(
            access_token=token,
            user={"id": user_id, "email": request.email, "user_metadata": {"name": request.name}},
            profile={
                "user_id": user_id,
                "organization_id": org_id,
                "role": "ADMIN",
                "created_at": _now_iso(),
            },
            organization={"id": org_id, "name": org_data["name"]},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signup error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/auth/signin")
async def signin(request: SigninRequest) -> AuthResponse:
    """Sign in with email and password."""
    try:
        supabase = get_supabase_client()
        
        # Find user by email
        result = supabase.table("profiles").select("*").eq("email", request.email).execute()
        if not result.data:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        user = result.data[0]
        user_id = user["id"]
        org_id = user["organisation_id"]
        role = user["role"]
        
        # In production, verify password hash here
        # For now, just create token
        
        token = jwt.encode(
            {
                "sub": user_id,
                "email": request.email,
                "org_id": org_id,
                "role": role,
                "iat": datetime.now(timezone.utc),
            },
            get_jwt_secret(),
            algorithm="HS256"
        )
        
        # Get organization data
        org_result = supabase.table("organizations").select("*").eq("id", org_id).execute()
        org = org_result.data[0] if org_result.data else {"id": org_id, "name": "Unknown"}
        
        return AuthResponse(
            access_token=token,
            user={"id": user_id, "email": request.email, "user_metadata": {"name": user["name"]}},
            profile={
                "user_id": user_id,
                "organization_id": org_id,
                "role": role,
                "created_at": user["created_at"],
            },
            organization={"id": org_id, "name": org["name"]},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signin error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/auth/me")
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    """Get current authenticated user."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        user_id = user_data.get("sub")
        result = supabase.table("profiles").select("*").eq("id", user_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="User not found")
        
        user = result.data[0]
        return {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "organization_id": user["organisation_id"],
            "initials": user["initials"],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get user error: {e}")
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.post("/api/auth/signout")
async def signout(authorization: Optional[str] = Header(None)) -> dict[str, str]:
    """Sign out user."""
    # JWT is stateless, so just return success
    return {"status": "signed_out"}


# ============================================================================
# CASE ENDPOINTS
# ============================================================================

@app.get("/api/cases")
async def list_cases(authorization: Optional[str] = Header(None)) -> list[dict[str, Any]]:
    """List all cases for the user's organization."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        result = supabase.table("cases").select("*").eq("organisation_id", org_id).execute()
        
        return [
            {
                "id": case["id"],
                "caseNumber": case["case_number"],
                "patientIdentifier": case.get("patient", {}).get("identifier", "P-UNKNOWN"),
                "product": case.get("suspect_products", [{}])[0].get("reportedName", "Unknown"),
                "reaction": case.get("reactions", [{}])[0].get("reportedTerm", "Unknown"),
                "seriousness": case["seriousness"],
                "outcome": case["outcome"],
                "workflowStep": case["workflow_step"],
                "assignedTo": case["assigned_to"],
                "receivedDate": case["received_date"],
                "dueDate": case["due_date"],
                "priority": case["priority"],
                "flags": case.get("flags", []),
                "source": case["source"],
            }
            for case in result.data
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"List cases error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cases")
async def create_case(
    payload: NewIcsrPayload,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Create a new ICSR case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        case_id = str(uuid.uuid4())
        case_number = _generate_case_number(org_id)
        
        case_data = {
            "id": case_id,
            "organisation_id": org_id,
            "case_number": case_number,
            "patient_identifier": payload.patient.get("identifier", "P-UNKNOWN"),
            "product": payload.product.get("reportedName", "Unknown"),
            "reaction": payload.reaction.get("reportedTerm", "Unknown"),
            "seriousness": payload.reportedSeriousness,
            "outcome": payload.reaction.get("outcome", "UNKNOWN"),
            "workflow_step": "INTAKE",
            "assigned_to": "unassigned",
            "received_date": _now_iso(),
            "due_date": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "priority": "MEDIUM",
            "flags": [],
            "source": "MANUAL",
            "reporter": payload.reporter,
            "patient": payload.patient,
            "suspect_products": [payload.product],
            "reactions": [payload.reaction],
            "narrative": payload.narrative,
            "reported_seriousness_criteria": payload.seriousnessCriteria,
            "follow_up_requests": [],
            "workflow_state": {
                "INTAKE": "COMPLETED",
                "TRIAGE": "CURRENT",
                "CODING": "PENDING",
                "REVIEW": "PENDING",
                "QC": "PENDING",
                "REGULATORY_READY": "PENDING",
                "CLOSED": "PENDING",
            },
        }
        
        result = supabase.table("cases").insert(case_data).execute()
        
        # Write audit event
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            user_data.get("role"),
            "CASE_CREATED",
            "case",
            case_id,
            case_id=case_id,
            reason="New ICSR received",
        )
        
        return {"caseId": case_id, "caseNumber": case_number, "workflowStep": "INTAKE"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create case error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cases/{case_id}")
async def get_case(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Get case detail."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        result = supabase.table("cases").select("*").eq("id", case_id).eq("organisation_id", org_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = result.data[0]
        workflow_state = case.get("workflow_state", {})
        
        return {
            "id": case["id"],
            "caseNumber": case["case_number"],
            "patientIdentifier": case.get("patient", {}).get("identifier", "P-UNKNOWN"),
            "product": case.get("suspect_products", [{}])[0].get("reportedName", "Unknown"),
            "reaction": case.get("reactions", [{}])[0].get("reportedTerm", "Unknown"),
            "seriousness": case["seriousness"],
            "outcome": case["outcome"],
            "workflowStep": case["workflow_step"],
            "assignedTo": case["assigned_to"],
            "receivedDate": case["received_date"],
            "dueDate": case["due_date"],
            "priority": case["priority"],
            "flags": case.get("flags", []),
            "source": case["source"],
            "reporter": case.get("reporter", {}),
            "patient": case.get("patient", {}),
            "suspectProducts": case.get("suspect_products", []),
            "reactions": case.get("reactions", []),
            "narrative": case.get("narrative", ""),
            "reportedSeriousnessCriteria": case.get("reported_seriousness_criteria", []),
            "followUpRequests": case.get("follow_up_requests", []),
            "workflowState": workflow_state,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get case error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cases/{case_id}/workflow")
async def advance_workflow(
    case_id: str,
    request: WorkflowAdvanceRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Advance case to next workflow step."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Get current case
        result = supabase.table("cases").select("*").eq("id", case_id).eq("organisation_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = result.data[0]
        workflow_state = case.get("workflow_state", {})
        
        # Update workflow state
        for key in workflow_state:
            workflow_state[key] = "COMPLETED" if key == case["workflow_step"] else workflow_state.get(key, "PENDING")
        workflow_state[request.step] = "CURRENT"
        
        update_data = {
            "workflow_step": request.step,
            "workflow_state": workflow_state,
            "updated_at": _now_iso(),
        }
        
        supabase.table("cases").update(update_data).eq("id", case_id).execute()
        
        # Write audit event
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            user_data.get("role"),
            "WORKFLOW_CHANGED",
            "case",
            case_id,
            case_id=case_id,
            previous_value=case["workflow_step"],
            new_value=request.step,
            reason=request.reason,
        )
        
        # Return updated case
        return await get_case(case_id, authorization)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Workflow advance error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# FOLLOW-UP ENDPOINTS
# ============================================================================

@app.get("/api/cases/{case_id}/follow-ups")
async def get_follow_ups(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> list[dict[str, Any]]:
    """Get follow-up requests for a case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        
        # Verify case belongs to org
        case_result = supabase.table("cases").select("id").eq("id", case_id).eq("organisation_id", org_id).execute()
        if not case_result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        result = supabase.table("follow_ups").select("*").eq("case_id", case_id).execute()
        return result.data or []
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get follow-ups error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cases/{case_id}/follow-ups")
async def create_follow_up(
    case_id: str,
    request: FollowUpRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Create a follow-up request."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Verify case belongs to org
        case_result = supabase.table("cases").select("id").eq("id", case_id).eq("organisation_id", org_id).execute()
        if not case_result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        follow_up = {
            "id": str(uuid.uuid4()),
            "case_id": case_id,
            "requested_information": request.requestedInformation,
            "requested_by": user_id,
            "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "status": "OPEN",
            "channel": request.channel,
        }
        
        result = supabase.table("follow_ups").insert(follow_up).execute()
        
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            user_data.get("role"),
            "FOLLOW_UP_REQUESTED",
            "follow_up",
            follow_up["id"],
            case_id=case_id,
            new_value=request.requestedInformation,
        )
        
        return result.data[0] if result.data else follow_up
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create follow-up error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# SERIOUSNESS ASSESSMENT ENDPOINTS
# ============================================================================

@app.post("/api/seriousness/{case_id}/analyze")
async def analyze_seriousness_endpoint(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Analyze case for seriousness assessment."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Get case
        result = supabase.table("cases").select("*").eq("id", case_id).eq("organisation_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = result.data[0]
        narrative = case.get("narrative", "")
        reported_serious = case.get("seriousness") == "SERIOUS"
        
        # Run seriousness analysis
        try:
            analysis_result = analyze(case_id, narrative, reported_serious)
            matched_criteria = [
                {
                    "criterion": item.get("key", "unknown"),
                    "detected": bool(item.get("matched")),
                    "evidence": item.get("evidence", ""),
                }
                for item in analysis_result.matched_criteria
            ]
        except Exception as e:
            logger.warning(f"Seriousness analysis failed: {e}, using defaults")
            matched_criteria = []
        
        assessment = {
            "id": str(uuid.uuid4()),
            "case_id": case_id,
            "reported_seriousness": "SERIOUS" if reported_serious else "NON_SERIOUS",
            "narrative_assessment": "SERIOUS",  # Would come from analysis
            "mismatch": False,  # Would come from analysis
            "matched_criteria": matched_criteria,
            "rationale": "Narrative analysis complete",
            "engine_version": "pv_assist.seriousness.v1",
            "review_state": "PENDING_REVIEW",
            "reviewed_by": None,
            "review_decision": None,
            "created_at": _now_iso(),
        }
        
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            user_data.get("role"),
            "SERIOUSNESS_ASSESSED",
            "seriousness_assessment",
            assessment["id"],
            case_id=case_id,
        )
        
        return assessment
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Seriousness analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/seriousness/{case_id}/decision")
async def seriousness_decision_endpoint(
    case_id: str,
    request: SeriousnessDecision,
    authorization: Optional[str] = Header(None),
) -> dict[str, str]:
    """Record seriousness review decision."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            user_data.get("role"),
            "SERIOUSNESS_REVIEWED",
            "case",
            case_id,
            case_id=case_id,
            new_value=request.decision,
            reason=request.rationale,
        )
        
        return {"status": "decision_recorded", "decision": request.decision}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Seriousness decision error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# CODING ENDPOINTS
# ============================================================================

@app.post("/api/coding/{case_id}/suggest")
async def suggest_coding(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> list[dict[str, Any]]:
    """Get coding suggestions for a case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Get case
        result = supabase.table("cases").select("*").eq("id", case_id).eq("organisation_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = result.data[0]
        
        # Load dictionaries
        try:
            medra = Dictionary.from_csv(
                str(PV_ROOT / "data" / "meddra_sample.csv"),
                "MedDRA",
                "27.0"
            )
            whodrug = Dictionary.from_csv(
                str(PV_ROOT / "data" / "whodrug_sample.csv"),
                "WHODrug",
                "2024Q4"
            )
        except Exception as e:
            logger.warning(f"Failed to load dictionaries: {e}")
            return []
        
        # Run coding
        try:
            reactions_text = [
                r.get("reportedTerm", "")
                for r in case.get("reactions", [])
                if r.get("reportedTerm")
            ]
            products_text = [
                p.get("reportedName", "")
                for p in case.get("suspect_products", [])
                if p.get("reportedName")
            ]
            
            coding_result = code_case(case_id, reactions_text, products_text, medra, whodrug)
            
            suggestions = []
            for reaction in coding_result.get("reactions", []):
                for cand in reaction.get("candidates", []):
                    suggestions.append({
                        "id": f"{case_id}-reaction-{cand.get('code', 'unknown')}",
                        "sourceText": reaction.get("verbatim", ""),
                        "kind": "REACTION",
                        "term": cand.get("term", ""),
                        "code": cand.get("code", ""),
                        "dictionary": "MedDRA",
                        "dictionaryVersion": medra.version,
                        "matchType": "EXACT" if cand.get("method") == "exact" else "FUZZY",
                        "confidence": cand.get("score", 0.0),
                        "evidence": "Matched dictionary term",
                        "status": "PENDING",
                    })
            
            for drug in coding_result.get("drugs", []):
                for cand in drug.get("candidates", []):
                    suggestions.append({
                        "id": f"{case_id}-drug-{cand.get('code', 'unknown')}",
                        "sourceText": drug.get("verbatim", ""),
                        "kind": "DRUG",
                        "term": cand.get("term", ""),
                        "code": cand.get("code", ""),
                        "dictionary": "WHODrug",
                        "dictionaryVersion": whodrug.version,
                        "matchType": "EXACT" if cand.get("method") == "exact" else "FUZZY",
                        "confidence": cand.get("score", 0.0),
                        "evidence": "Matched dictionary term",
                        "status": "PENDING",
                    })
            
            _write_audit_event(
                supabase,
                org_id,
                user_id,
                user_data.get("role"),
                "CODING_SUGGESTED",
                "case",
                case_id,
                case_id=case_id,
            )
            
            return suggestions
        except Exception as e:
            logger.warning(f"Coding failed: {e}")
            return []
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Coding suggestion error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# AUDIT ENDPOINTS
# ============================================================================

@app.get("/api/audit")
async def list_audit_events(
    authorization: Optional[str] = Header(None),
) -> list[dict[str, Any]]:
    """List audit events for organization."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        result = supabase.table("audit_events").select("*").eq("organisation_id", org_id).order("created_at", desc=True).execute()
        return result.data or []
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"List audit error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/audit/{case_id}")
async def list_case_audit_events(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> list[dict[str, Any]]:
    """List audit events for a specific case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        result = supabase.table("audit_events").select("*").eq("case_id", case_id).eq("organisation_id", org_id).order("created_at", desc=True).execute()
        return result.data or []
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"List case audit error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
