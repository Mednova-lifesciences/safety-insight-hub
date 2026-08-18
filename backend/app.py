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
import psycopg2
from psycopg2.extras import RealDictCursor
import psycopg2.pool

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def find_pv_root() -> Path:
    """
    Locate the mednova-pv-assist project directory.
    Works with git submodule or local filesystem installation.
    """
    candidates = [
        Path(__file__).resolve().parents[2] / "mednova-pv-assist" / "mednova-pv-assist",  # submodule at repo root
        Path(__file__).resolve().parent.parent,  # parent directory
        Path(__file__).resolve().parents[1],
        Path(__file__).resolve().parents[2],
        Path.cwd(),
        Path.home() / "Downloads" / "mednova-pv-assist" / "mednova-pv-assist",  # local dev
    ]
    for base in candidates:
        if base.exists() and (base / "pv_assist").exists():
            return base
    raise FileNotFoundError(
        "Could not locate mednova-pv-assist. "
        "Ensure it is either in a git submodule (mednova-pv-assist/) or at ~/Downloads/mednova-pv-assist. "
        "For Render deployment, push mednova-pv-assist to GitHub and add as a submodule."
    )


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


# PostgreSQL Connection Pool
_db_pool: Optional[psycopg2.pool.SimpleConnectionPool] = None

def get_db_pool() -> psycopg2.pool.SimpleConnectionPool:
    """Get or create PostgreSQL connection pool."""
    global _db_pool
    if _db_pool is None:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL must be set")
        try:
            _db_pool = psycopg2.pool.SimpleConnectionPool(1, 20, database_url)
            logger.info("PostgreSQL connection pool created")
        except Exception as e:
            logger.error(f"Failed to create connection pool: {e}")
            raise
    return _db_pool

def get_db_connection():
    """Get a database connection from the pool."""
    pool = get_db_pool()
    return pool.getconn()

def return_db_connection(conn):
    """Return a connection to the pool."""
    if conn:
        get_db_pool().putconn(conn)

def execute_query(query: str, params: tuple = ()) -> list[dict]:
    """Execute a SELECT query and return results as dicts."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(query, params)
        results = cursor.fetchall()
        cursor.close()
        return [dict(row) for row in results]
    finally:
        return_db_connection(conn)

def execute_write(query: str, params: tuple = ()) -> Any:
    """Execute an INSERT/UPDATE/DELETE query and return affected rows."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(query, params)
        result = cursor.rowcount
        conn.commit()
        cursor.close()
        return result
    except Exception as e:
        conn.rollback()
        raise
    finally:
        return_db_connection(conn)


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


class CodingDecision(BaseModel):
    suggestionId: str
    rationale: Optional[str] = None


class ConsistencyCheckResult(BaseModel):
    id: str
    caseId: str
    checkType: str
    severity: str  # INFO, WARNING, ERROR
    message: str
    evidence: Optional[dict] = None
    suggestedResolution: Optional[str] = None
    status: str = "OPEN"  # OPEN, ACKNOWLEDGED, RESOLVED


# Helper functions
def _get_current_user(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    """Extract and validate JWT token from Authorization header.
    
    SECURITY: Token signature is verified using JWT_SECRET.
    This prevents forged tokens from being accepted.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    
    token = authorization.split(" ", 1)[1]
    
    try:
        # Verify JWT signature and decode
        secret = get_jwt_secret()
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        
        # Validate required fields
        if not payload.get("sub"):
            raise ValueError("Missing user ID in token")
        
        return payload
    except jwt.InvalidSignatureError:
        logger.warning(f"Invalid token signature attempted")
        raise HTTPException(status_code=401, detail="Invalid token signature")
    except jwt.ExpiredSignatureError:
        logger.warning(f"Expired token attempted")
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        logger.error(f"Invalid token: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Token validation error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


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
    action: str,
    entity_type: str,
    entity_id: str,
    case_id: Optional[str] = None,
    previous_value: Optional[dict] = None,
    new_value: Optional[dict] = None,
    reason: Optional[str] = None,
) -> dict[str, Any]:
    """Write an audit event to the database."""
    event = {
        "organization_id": organization_id,
        "user_id": user_id,
        "action": action,
        "entity_type": entity_type,
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


def _write_audit_event_direct(
    organization_id: str,
    user_id: str,
    action: str,
    entity_type: str,
    entity_id: str,
    case_id: Optional[str] = None,
    previous_value: Optional[dict] = None,
    new_value: Optional[dict] = None,
    reason: Optional[str] = None,
) -> dict[str, Any]:
    """Write an audit event to the database using direct PostgreSQL."""
    event_id = str(uuid.uuid4())
    created_at = _now_iso()
    
    try:
        import json
        prev_val_json = json.dumps(previous_value) if previous_value else None
        new_val_json = json.dumps(new_value) if new_value else None
        
        execute_write(
            """INSERT INTO audit_events 
               (id, organization_id, user_id, action, entity_type, entity_id, 
                previous_value, new_value, reason, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (event_id, organization_id, user_id, action, entity_type, entity_id,
             prev_val_json, new_val_json, reason, created_at)
        )
        return {
            "id": event_id,
            "organization_id": organization_id,
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "previous_value": previous_value,
            "new_value": new_value,
            "reason": reason,
            "created_at": created_at,
        }
    except Exception as e:
        logger.error(f"Failed to write audit event: {e}")
        return {
            "id": event_id,
            "organization_id": organization_id,
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "created_at": created_at,
        }


def _perform_consistency_checks(case: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Perform automated quality and consistency checks on a case.
    
    Returns a list of consistency check results.
    """
    checks = []
    check_id_base = str(uuid.uuid4())[:8]
    check_num = 0
    
    # Helper function to add a check result
    def add_check(check_type: str, severity: str, message: str, evidence: Optional[dict] = None, suggestion: Optional[str] = None):
        nonlocal check_num
        check_num += 1
        checks.append({
            "id": f"{check_id_base}-{check_num}",
            "caseId": case.get("id"),
            "checkType": check_type,
            "severity": severity,
            "message": message,
            "evidence": evidence,
            "suggestedResolution": suggestion,
            "status": "OPEN",
        })
    
    # 1. Patient Information Completeness
    patient_id = case.get("patient_identifier", "").strip()
    if not patient_id or patient_id == "P-UNKNOWN":
        add_check(
            "PATIENT_IDENTIFICATION",
            "WARNING",
            "Patient identifier is missing or unknown",
            {"field": "patient_identifier", "value": patient_id},
            "Obtain and enter valid patient identifier"
        )
    
    # 2. Product Information Completeness
    product_name = case.get("product_name", "").strip()
    if not product_name or product_name == "Unknown":
        add_check(
            "PRODUCT_IDENTIFICATION",
            "ERROR",
            "Product/medicinal product name is missing",
            {"field": "product_name", "value": product_name},
            "Enter the suspect product name"
        )
    
    # 3. Reaction Information
    reaction_term = case.get("reaction_term", "").strip()
    if not reaction_term or reaction_term == "Unknown":
        add_check(
            "REACTION_INFORMATION",
            "ERROR",
            "Reaction/adverse event term is missing",
            {"field": "reaction_term", "value": reaction_term},
            "Describe the reported adverse event"
        )
    
    # 4. Seriousness Assessment
    reported_serious = case.get("reported_seriousness") == "SERIOUS"
    has_narrative = bool(case.get("narrative", "").strip())
    
    if reported_serious and not has_narrative:
        add_check(
            "SERIOUSNESS_JUSTIFICATION",
            "WARNING",
            "Case marked as serious but no narrative/justification provided",
            {"reported_seriousness": case.get("reported_seriousness"), "has_narrative": has_narrative},
            "Add narrative details supporting the serious classification"
        )
    
    # 5. Narrative Completeness
    if not has_narrative:
        add_check(
            "NARRATIVE_MISSING",
            "INFO",
            "Case narrative/background information is not provided",
            None,
            "Consider adding narrative to provide context for reviewers"
        )
    
    # 6. Reporter Information
    reporter_name = case.get("reporter_name", "").strip() if isinstance(case.get("reporter_name"), str) else ""
    if not reporter_name:
        add_check(
            "REPORTER_INFORMATION",
            "INFO",
            "Reporter name/identifier is not documented",
            {"field": "reporter_name"},
            "Record reporter information for follow-up"
        )
    
    # 7. Minimum Information Standard
    required_fields = ["product_name", "reaction_term", "patient_identifier"]
    missing_required = [f for f in required_fields if not case.get(f, "").strip() or case.get(f) == "Unknown"]
    
    if missing_required:
        add_check(
            "MINIMUM_INFO_STANDARD",
            "ERROR",
            f"Missing minimum required information: {', '.join(missing_required)}",
            {"missing_fields": missing_required},
            "Complete all minimum required fields before proceeding"
        )
    
    return checks


def _calculate_similarity_score(str1: str, str2: str) -> float:
    """
    Calculate Levenshtein distance-based similarity score (0-100).
    """
    if not str1 or not str2:
        return 0.0
    
    str1 = str(str1).lower().strip()
    str2 = str(str2).lower().strip()
    
    if str1 == str2:
        return 100.0
    
    # Simple Levenshtein distance implementation
    m, n = len(str1), len(str2)
    if m == 0:
        return 0.0 if n > 0 else 100.0
    if n == 0:
        return 0.0
    
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if str1[i - 1] == str2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    
    distance = dp[m][n]
    max_len = max(m, n)
    similarity = ((max_len - distance) / max_len) * 100.0
    return max(0.0, min(100.0, similarity))


def _find_duplicate_candidates(
    case: dict[str, Any],
    org_cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Find potentially duplicate cases based on patient, product, and reaction information.
    
    Returns a list of potential duplicates ranked by match confidence.
    """
    duplicates = []
    
    case_product = str(case.get("product_name", "")).lower().strip()
    case_reaction = str(case.get("reaction_term", "")).lower().strip()
    case_patient = str(case.get("patient_identifier", "")).lower().strip()
    case_dob = case.get("patient_dob")
    
    for other_case in org_cases:
        # Don't compare case with itself
        if other_case.get("id") == case.get("id"):
            continue
        
        other_product = str(other_case.get("product_name", "")).lower().strip()
        other_reaction = str(other_case.get("reaction_term", "")).lower().strip()
        other_patient = str(other_case.get("patient_identifier", "")).lower().strip()
        other_dob = other_case.get("patient_dob")
        
        # Calculate similarity scores
        product_sim = _calculate_similarity_score(case_product, other_product)
        reaction_sim = _calculate_similarity_score(case_reaction, other_reaction)
        patient_sim = _calculate_similarity_score(case_patient, other_patient)
        
        # Check for exact date of birth match (if available)
        dob_match = (case_dob == other_dob) if case_dob and other_dob else False
        
        # Calculate overall confidence (weighted average)
        # Higher weight on product + patient combination
        if product_sim > 70 and patient_sim > 70:
            # Strong match: same product and same/similar patient
            confidence = (product_sim * 0.4 + patient_sim * 0.4 + reaction_sim * 0.2)
        elif product_sim > 80 and reaction_sim > 80:
            # Strong match: same product and same reaction
            confidence = (product_sim * 0.35 + reaction_sim * 0.35 + patient_sim * 0.3)
        elif patient_sim > 85:
            # Medium-strong match: same patient
            confidence = (patient_sim * 0.5 + product_sim * 0.25 + reaction_sim * 0.25)
        else:
            confidence = (product_sim * 0.3 + patient_sim * 0.3 + reaction_sim * 0.4)
        
        # Boost confidence if date of birth matches
        if dob_match:
            confidence = min(100.0, confidence * 1.15)
        
        # Only include if confidence is above threshold (60%)
        if confidence >= 60:
            duplicates.append({
                "id": str(uuid.uuid4())[:8],
                "caseId": other_case.get("id"),
                "caseNumber": other_case.get("case_id"),
                "confidence": round(confidence, 1),
                "matchedFields": {
                    "product": product_sim,
                    "reaction": reaction_sim,
                    "patient": patient_sim,
                    "dobMatch": dob_match,
                },
                "evidence": {
                    "product": f"{case_product} vs {other_product}",
                    "reaction": f"{case_reaction} vs {other_reaction}",
                    "patient": f"{case_patient} vs {other_patient}",
                },
                "createdAt": other_case.get("created_at"),
                "status": "OPEN",
            })
    
    # Sort by confidence (descending)
    duplicates.sort(key=lambda x: x["confidence"], reverse=True)
    
    return duplicates


def _calculate_triage_score(case: dict[str, Any]) -> dict[str, Any]:
    """
    Calculate intelligent triage score and routing recommendations for a case.
    
    Factors considered:
    - Seriousness: Is case marked as serious?
    - Completeness: How complete is the data? (patient, product, reaction, narrative)
    - Urgency: Time-sensitive flags (e.g., hospitalization, death)
    - Reporter type: Healthcare professional vs lay reporter
    - Duplicates: Already found duplicates
    """
    score = 0
    factors = []
    recommended_workflow_step = "TRIAGE"
    priority = "NORMAL"
    
    # Factor 1: Seriousness (0-30 points)
    is_serious = case.get("reported_seriousness") == "SERIOUS"
    if is_serious:
        score += 30
        factors.append({"name": "Serious Case", "points": 30, "description": "Case marked as serious"})
        priority = "HIGH"
    else:
        score += 5
        factors.append({"name": "Non-Serious Case", "points": 5, "description": "Case marked as non-serious"})
    
    # Factor 2: Data Completeness (0-20 points)
    completeness = 0
    max_completeness_points = 0
    
    # Check essential fields
    required_fields = [
        "patient_identifier",
        "product_name",
        "reaction_term",
        "narrative",
    ]
    
    for field in required_fields:
        max_completeness_points += 5
        if case.get(field) and case.get(field).strip() and case.get(field) != "Unknown":
            completeness += 5
    
    score += completeness
    if completeness == 20:
        factors.append({
            "name": "Complete Data",
            "points": completeness,
            "description": "All required fields populated",
        })
    else:
        factors.append({
            "name": "Incomplete Data",
            "points": completeness,
            "description": f"Only {int(completeness/5)}/4 required fields complete",
        })
    
    # Factor 3: Urgency (0-25 points)
    urgency_score = 0
    narrative = (case.get("narrative") or "").lower()
    
    # High urgency indicators
    urgent_keywords = ["death", "died", "fatal", "hospitalization", "hospitalized", 
                       "icu", "intensive care", "emergency", "critical", "life-threatening",
                       "congenital", "disability"]
    
    for keyword in urgent_keywords:
        if keyword in narrative:
            urgency_score = 25
            factors.append({
                "name": "Urgent Medical Event",
                "points": 25,
                "description": f"Narrative contains urgent keyword: '{keyword}'",
            })
            priority = "CRITICAL"
            recommended_workflow_step = "REVIEW"
            break
    
    if urgency_score == 0:
        factors.append({"name": "No Urgent Flags", "points": 0, "description": "No critical events detected"})
    
    score += urgency_score
    
    # Factor 4: Reporter Quality (0-15 points)
    reporter_qualification = (case.get("reporter_qualification") or "").lower()
    if "healthcare" in reporter_qualification or "physician" in reporter_qualification or "doctor" in reporter_qualification:
        score += 15
        factors.append({
            "name": "Healthcare Professional Reporter",
            "points": 15,
            "description": "Report from qualified healthcare professional",
        })
    elif "pharmacist" in reporter_qualification or "nurse" in reporter_qualification:
        score += 12
        factors.append({
            "name": "Healthcare Worker Reporter",
            "points": 12,
            "description": "Report from healthcare worker",
        })
    else:
        score += 5
        factors.append({
            "name": "Lay Reporter",
            "points": 5,
            "description": "Report from non-healthcare source",
        })
    
    # Factor 5: Assignment Status (0-10 points)
    if case.get("assigned_to"):
        score += 10
        factors.append({
            "name": "Already Assigned",
            "points": 10,
            "description": "Case has been assigned to reviewer",
        })
        recommended_workflow_step = "CODING"
    else:
        factors.append({
            "name": "Unassigned",
            "points": 0,
            "description": "Case awaiting assignment",
        })
    
    # Normalize score to 0-100
    normalized_score = min(100, max(0, score))
    
    # Determine recommended next workflow step
    if urgency_score >= 25:
        recommended_workflow_step = "REVIEW"
    elif completeness >= 15:
        if is_serious:
            recommended_workflow_step = "CODING"
        else:
            recommended_workflow_step = "TRIAGE"
    
    return {
        "triageScore": normalized_score,
        "priority": priority,
        "factors": factors,
        "recommendedNextStep": recommended_workflow_step,
        "rationale": f"Case scored {normalized_score}/100 based on severity, completeness, and urgency indicators",
    }


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
        # Test direct PostgreSQL connection
        results = execute_query("SELECT 1")
        if results:
            return {"status": "ok", "database": "connected"}
        else:
            return {"status": "degraded", "database": "disconnected"}
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {"status": "degraded", "database": "disconnected", "error": str(e)}


# ============================================================================
# AUTHENTICATION ENDPOINTS
# ============================================================================

@app.post("/api/auth/signup")
async def signup(request: SignupRequest) -> AuthResponse:
    """Sign up a new user with email and password."""
    try:
        # Check if email already exists
        existing = execute_query(
            "SELECT id FROM profiles WHERE email = %s",
            (request.email,)
        )
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Create organization for first user
        org_id = str(uuid.uuid4())
        org_name = request.organization_name or f"{request.email.split('@')[0]} Organization"
        execute_write(
            "INSERT INTO organizations (id, name) VALUES (%s, %s)",
            (org_id, org_name)
        )
        
        # Create user profile (first user is ADMIN)
        user_id = str(uuid.uuid4())
        execute_write(
            "INSERT INTO profiles (id, organization_id, email, full_name, role) VALUES (%s, %s, %s, %s, %s)",
            (user_id, org_id, request.email, request.name, "ADMIN")
        )
        
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
        _write_audit_event_direct(
            org_id,
            user_id,
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
            organization={"id": org_id, "name": org_name},
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
        # Find user by email
        result = execute_query(
            "SELECT * FROM profiles WHERE email = %s",
            (request.email,)
        )
        if not result:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        user = result[0]
        user_id = user["id"]
        org_id = user["organization_id"]
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
        org_result = execute_query(
            "SELECT * FROM organizations WHERE id = %s",
            (org_id,)
        )
        org = org_result[0] if org_result else {"id": org_id, "name": "Unknown"}
        
        return AuthResponse(
            access_token=token,
            user={"id": user_id, "email": request.email, "user_metadata": {"name": user["full_name"]}},
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
            "name": user["full_name"],
            "role": user["role"],
            "organization_id": user["organization_id"],
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

def _case_to_api_response(case: dict[str, Any]) -> dict[str, Any]:
    """Normalize a DB row into the case-detail payload expected by the frontend."""
    workflow_state = case.get("workflow_state") or {}
    if isinstance(workflow_state, str):
        try:
            workflow_state = json.loads(workflow_state)
        except Exception:
            workflow_state = {}

    return {
        "id": case["id"],
        "caseNumber": case["case_id"],
        "patientIdentifier": case.get("patient_identifier", "P-UNKNOWN"),
        "product": case.get("product_name", "Unknown"),
        "reaction": case.get("reaction_term", "Unknown"),
        "seriousness": case.get("reported_seriousness", "UNASSESSED"),
        "outcome": case.get("reaction_outcome", "UNKNOWN"),
        "workflowStep": case.get("workflow_step", "INTAKE"),
        "assignedTo": case.get("assigned_to", "unassigned"),
        "receivedDate": case.get("created_at"),
        "dueDate": case.get("updated_at"),
        "priority": "MEDIUM",
        "flags": [],
        "source": case.get("source", "MANUAL"),
        "narrative": case.get("narrative", ""),
        "reportedSeriousnessCriteria": case.get("seriousness_criteria", []),
        "followUpRequests": [],
        "workflowState": workflow_state,
    }


@app.get("/api/cases")
async def list_cases(authorization: Optional[str] = Header(None)) -> list[dict[str, Any]]:
    """List all cases for the user's organization."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        result = supabase.table("cases").select("*").eq("organization_id", org_id).order("created_at", desc=True).execute()
        
        return [
            {
                "id": case["id"],
                "caseNumber": case["case_id"],
                "patientIdentifier": case.get("patient_identifier", "P-UNKNOWN"),
                "product": case.get("product_name", "Unknown"),
                "reaction": case.get("reaction_term", "Unknown"),
                "seriousness": case["reported_seriousness"],
                "outcome": case["reaction_outcome"],
                "workflowStep": case["workflow_step"],
                "assignedTo": case.get("assigned_to", "unassigned"),
                "receivedDate": case["created_at"],
                "dueDate": case["updated_at"],
                "priority": "MEDIUM",
                "flags": [],
                "source": case.get("source", "MANUAL"),
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
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        case_id = str(uuid.uuid4())
        case_number = _generate_case_number(org_id)
        
        # Insert case directly into database
        # Use direct connection to handle array type properly
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """INSERT INTO cases 
                   (id, organization_id, case_id, reporter_name, reporter_qualification, 
                    reporter_country, reporter_contact, reporter_consent_to_contact,
                    patient_identifier, patient_age, patient_sex, patient_weight_kg, patient_medical_history,
                    product_name, product_active_ingredient, product_dose, product_route, product_indication,
                    product_therapy_start, product_action, reaction_term, reaction_onset_date, reaction_outcome, 
                    reported_seriousness, workflow_step, source, narrative, seriousness_criteria, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    case_id, org_id, case_number,
                    payload.reporter.get("name"),
                    payload.reporter.get("qualification"),
                    payload.reporter.get("country"),
                    payload.reporter.get("contact"),
                    payload.reporter.get("consentToContact"),
                    payload.patient.get("identifier", "P-UNKNOWN"),
                    payload.patient.get("age"),
                    payload.patient.get("sex"),
                    payload.patient.get("weightKg"),
                    payload.patient.get("medicalHistory"),
                    payload.product.get("reportedName", "Unknown"),
                    payload.product.get("activeIngredient"),
                    payload.product.get("dose"),
                    payload.product.get("route"),
                    payload.product.get("indication"),
                    payload.product.get("therapyStart"),
                    payload.product.get("action"),
                    payload.reaction.get("reportedTerm", "Unknown"),
                    payload.reaction.get("onsetDate"),
                    payload.reaction.get("outcome", "UNKNOWN"),
                    payload.reportedSeriousness,
                    "INTAKE",
                    "MANUAL",
                    payload.narrative,
                    payload.seriousnessCriteria,
                    user_id
                )
            )
            conn.commit()
            cursor.close()
        finally:
            return_db_connection(conn)
        
        # Write audit event
        _write_audit_event_direct(
            org_id,
            user_id,
            "CASE_CREATED",
            "case",
            case_id,
            reason="New ICSR received",
        )
        
        return {"caseId": case_id, "caseNumber": case_number, "workflowStep": "INTAKE", "id": case_id}
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
        org_id = user_data.get("org_id")
        rows = execute_query(
            "SELECT * FROM cases WHERE id = %s AND organization_id = %s",
            (case_id, org_id),
        )

        if not rows:
            raise HTTPException(status_code=404, detail="Case not found")

        return _case_to_api_response(rows[0])
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get case error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cases/{case_id}/processing")
async def get_case_processing(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Return the aggregated case-processing payload used by the unified workflow screen."""
    try:
        user_data = _get_current_user(authorization)
        org_id = user_data.get("org_id")

        rows = execute_query(
            "SELECT * FROM cases WHERE id = %s AND organization_id = %s",
            (case_id, org_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Case not found")

        case = rows[0]
        case_payload = _case_to_api_response(case)

        seriousness_rows = execute_query(
            "SELECT * FROM seriousness_assessments WHERE case_id = %s AND organization_id = %s ORDER BY created_at DESC LIMIT 1",
            (case_id, org_id),
        )
        seriousness_payload = None
        if seriousness_rows:
            assessment = seriousness_rows[0]
            seriousness_payload = {
                "id": assessment["id"],
                "caseId": assessment["case_id"],
                "reportedSeriousness": assessment.get("reported_seriousness"),
                "narrativeAssessment": assessment.get("narrative_assessment"),
                "mismatch": assessment.get("mismatch", False),
                "criteria": assessment.get("criteria", []),
                "rationale": assessment.get("rationale"),
                "engineVersion": assessment.get("engine_version"),
                "reviewState": assessment.get("review_state"),
                "reviewDecision": assessment.get("review_decision"),
                "reviewedBy": assessment.get("reviewed_by"),
            }

        consistency_rows = execute_query(
            "SELECT * FROM consistency_checks WHERE case_id = %s AND organization_id = %s ORDER BY created_at DESC",
            (case_id, org_id),
        )
        consistency_payload = [
            {
                "id": row["id"],
                "caseId": row["case_id"],
                "checkType": row["check_type"],
                "severity": row["severity"],
                "message": row["message"],
                "evidence": row.get("evidence"),
                "suggestedResolution": row.get("suggested_resolution"),
                "status": row.get("status", "OPEN"),
            }
            for row in consistency_rows
        ]
        if not consistency_rows:
            consistency_payload = _perform_consistency_checks(case)

        triage_payload = _calculate_triage_score(case)

        return {
            "case": case_payload,
            "seriousness": seriousness_payload,
            "coding": [],
            "consistency": consistency_payload,
            "triage": triage_payload,
            "workflow": {
                "currentStep": case.get("workflow_step", "INTAKE"),
                "nextRecommendedStep": triage_payload.get("recommendedNextStep", "TRIAGE"),
                "state": case.get("workflow_state") or {},
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get case processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Role-based workflow transition rules
WORKFLOW_TRANSITIONS: dict[str, dict[str, list[str]]] = {
    "ADMIN": {
        "INTAKE": ["TRIAGE", "CLOSED"],
        "TRIAGE": ["CODING", "INTAKE", "CLOSED"],
        "CODING": ["REVIEW", "TRIAGE", "CLOSED"],
        "REVIEW": ["QC", "CODING", "CLOSED"],
        "QC": ["REGULATORY_READY", "REVIEW", "CLOSED"],
        "REGULATORY_READY": ["CLOSED"],
        "CLOSED": ["INTAKE"],
    },
    "MANAGER": {
        "INTAKE": ["TRIAGE"],
        "TRIAGE": ["CODING", "INTAKE"],
        "CODING": ["REVIEW"],
        "REVIEW": ["QC"],
        "QC": ["REGULATORY_READY"],
        "REGULATORY_READY": [],
        "CLOSED": [],
    },
    "COORDINATOR": {
        "INTAKE": ["TRIAGE"],
        "TRIAGE": ["CODING"],
        "CODING": ["REVIEW"],
        "REVIEW": [],
        "QC": [],
        "REGULATORY_READY": [],
        "CLOSED": [],
    },
    "FIELD_ASSOCIATE": {
        "INTAKE": ["TRIAGE"],
        "TRIAGE": [],
        "CODING": [],
        "REVIEW": [],
        "QC": [],
        "REGULATORY_READY": [],
        "CLOSED": [],
    },
}


def _get_valid_transitions(role: str, current_step: str) -> list[str]:
    """Get valid workflow transitions for a role from the current step."""
    role_transitions = WORKFLOW_TRANSITIONS.get(role, {})
    return role_transitions.get(current_step, [])


@app.get("/api/cases/{case_id}/workflow-actions")
async def get_workflow_actions(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Get valid workflow actions available to the current user for this case."""
    try:
        user_data = _get_current_user(authorization)
        org_id = user_data.get("org_id")
        role = user_data.get("role", "FIELD_ASSOCIATE")
        
        rows = execute_query(
            "SELECT workflow_step FROM cases WHERE id = %s AND organization_id = %s",
            (case_id, org_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Case not found")
        
        current_step = rows[0].get("workflow_step", "INTAKE")
        valid_transitions = _get_valid_transitions(role, current_step)
        
        return {
            "caseId": case_id,
            "currentStep": current_step,
            "validTransitions": valid_transitions,
            "canAdvanceWorkflow": len(valid_transitions) > 0,
            "role": role,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get workflow actions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cases/{case_id}/workflow")
async def advance_workflow(
    case_id: str,
    request: WorkflowAdvanceRequest,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Advance case to next workflow step with role-based validation."""
    try:
        user_data = _get_current_user(authorization)
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        role = user_data.get("role", "FIELD_ASSOCIATE")
        
        # Get current case
        rows = execute_query(
            "SELECT workflow_step FROM cases WHERE id = %s AND organization_id = %s",
            (case_id, org_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = rows[0]
        current_step = case.get("workflow_step", "INTAKE")
        
        # Validate transition is allowed for this role
        valid_transitions = _get_valid_transitions(role, current_step)
        if request.step not in valid_transitions:
            raise HTTPException(
                status_code=403,
                detail=f"Role {role} cannot transition from {current_step} to {request.step}"
            )
        
        # Update case workflow step
        execute_write(
            "UPDATE cases SET workflow_step = %s, updated_at = NOW() WHERE id = %s",
            (request.step, case_id)
        )
        
        # Write audit event
        _write_audit_event_direct(
            org_id,
            user_id,
            "WORKFLOW_ADVANCED",
            "case",
            case_id,
            reason=f"Workflow advanced from {current_step} to {request.step}. {request.reason}"
        )
        
        # Return updated processing payload
        return await get_case_processing(case_id, authorization)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Workflow advance error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PHASE 2.6: SLA MANAGEMENT, WORKFLOW RULES ENGINE, SIGNAL DETECTION
# ============================================================================

# SLA Rules: Business day requirements per workflow step
SLA_RULES: dict[str, dict[str, int]] = {
    "INTAKE": {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 3, "NORMAL": 5},  # Days
    "TRIAGE": {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 3, "NORMAL": 5},
    "CODING": {"CRITICAL": 2, "HIGH": 3, "MEDIUM": 5, "NORMAL": 7},
    "REVIEW": {"CRITICAL": 2, "HIGH": 3, "MEDIUM": 5, "NORMAL": 7},
    "QC": {"CRITICAL": 1, "HIGH": 1, "MEDIUM": 2, "NORMAL": 3},
    "REGULATORY_READY": {"CRITICAL": 1, "HIGH": 1, "MEDIUM": 1, "NORMAL": 1},
}

# Signal Detection Rules: Criteria for flagging safety signals
SIGNAL_RULES = {
    "SERIOUS_HOSPITALIZATION": {
        "weight": 10,
        "criteria": ["hospitalization", "hospital", "admitted"],
        "description": "Serious case with hospitalization"
    },
    "FATAL_OUTCOME": {
        "weight": 20,
        "criteria": ["fatal", "death", "died", "mortality"],
        "description": "Potentially fatal outcome detected"
    },
    "MULTIPLE_SERIOUS": {
        "weight": 8,
        "criteria": ["serious", "multiple reactions"],
        "description": "Multiple serious reactions reported"
    },
    "CONGENITAL_ABNORMALITY": {
        "weight": 15,
        "criteria": ["congenital", "birth defect", "fetal", "pregnancy"],
        "description": "Congenital abnormality or pregnancy-related issue"
    },
    "CLUSTER_POTENTIAL": {
        "weight": 12,
        "criteria": ["cluster", "outbreak", "multiple patients", "similar cases"],
        "description": "Potential case cluster detected"
    },
}

def _calculate_sla_due_date(workflow_step: str, priority: str, from_date: datetime = None) -> str:
    """Calculate SLA due date based on workflow step and case priority."""
    if from_date is None:
        from_date = datetime.now(timezone.utc)
    
    days_allowed = SLA_RULES.get(workflow_step, {}).get(priority, 5)
    # Add days to from_date, skipping weekends
    due_date = from_date
    days_added = 0
    while days_added < days_allowed:
        due_date += timedelta(days=1)
        # 0=Monday, 6=Sunday
        if due_date.weekday() < 5:  # Monday to Friday
            days_added += 1
    
    return due_date.date().isoformat()

def _detect_signal(narrative: str, case_priority: str, reported_seriousness: str) -> dict[str, Any]:
    """Detect potential safety signals in case narrative."""
    if not narrative:
        return {"hasSignal": False, "signalType": None, "weight": 0, "description": ""}
    
    narrative_lower = narrative.lower()
    
    # Check each signal rule
    for signal_type, rule in SIGNAL_RULES.items():
        for criterion in rule.get("criteria", []):
            if criterion.lower() in narrative_lower:
                return {
                    "hasSignal": True,
                    "signalType": signal_type,
                    "weight": rule.get("weight", 5),
                    "description": rule.get("description", ""),
                    "matchedCriterion": criterion,
                }
    
    return {"hasSignal": False, "signalType": None, "weight": 0, "description": ""}

def _check_workflow_rule(current_step: str, case_data: dict[str, Any]) -> dict[str, Any]:
    """Check workflow rules to determine auto-advancement eligibility."""
    rules = {
        "INTAKE": {
            "autoAdvance": all([
                case_data.get("patient_identifier"),
                case_data.get("product_name"),
                case_data.get("reaction_term"),
            ]),
            "reason": "All required intake fields populated"
        },
        "TRIAGE": {
            "autoAdvance": case_data.get("triageScore", 0) >= 0,  # Any triage done
            "reason": "Triage assessment completed"
        },
        "CODING": {
            "autoAdvance": len(case_data.get("reactions", [])) > 0,
            "reason": "Reactions coded"
        },
        "REVIEW": {
            "autoAdvance": case_data.get("reviewDecision") in ["APPROVED", "REFERRED"],
            "reason": "Review completed"
        },
    }
    
    rule = rules.get(current_step)
    if not rule:
        return {"canAutoAdvance": False, "reason": "No auto-advancement rule for this step"}
    
    return {
        "canAutoAdvance": rule.get("autoAdvance", False),
        "reason": rule.get("reason", ""),
        "nextStep": _get_recommended_next_step(current_step)
    }

def _get_recommended_next_step(current_step: str) -> Optional[str]:
    """Get the recommended next step in workflow."""
    workflow_sequence = ["INTAKE", "TRIAGE", "CODING", "REVIEW", "QC", "REGULATORY_READY", "CLOSED"]
    try:
        current_idx = workflow_sequence.index(current_step)
        if current_idx < len(workflow_sequence) - 1:
            return workflow_sequence[current_idx + 1]
    except ValueError:
        pass
    return None

@app.get("/api/cases/{case_id}/sla-status")
async def get_sla_status(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Get SLA status and due date for a case."""
    try:
        user_data = _get_current_user(authorization)
        org_id = user_data.get("org_id")
        
        rows = execute_query(
            "SELECT workflow_step, reported_seriousness, created_at FROM cases WHERE id = %s AND organization_id = %s",
            (case_id, org_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = rows[0]
        workflow_step = case.get("workflow_step", "INTAKE")
        created_at = case.get("created_at")
        seriousness = case.get("reported_seriousness", "NON_SERIOUS")
        
        # Determine priority from seriousness
        if seriousness == "SERIOUS":
            priority = "CRITICAL"
        else:
            priority = "NORMAL"
        
        # Parse created_at if it's a string
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        elif created_at is None:
            created_at = datetime.now(timezone.utc)
        
        due_date_str = _calculate_sla_due_date(workflow_step, priority, created_at)
        due_date = datetime.fromisoformat(due_date_str).replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        
        # Calculate status
        if now > due_date:
            status = "OVERDUE"
        elif (due_date - now).days <= 1:
            status = "DUE_SOON"
        else:
            status = "ON_TRACK"
        
        days_remaining = (due_date - now).days
        
        return {
            "caseId": case_id,
            "workflowStep": workflow_step,
            "priority": priority,
            "dueDate": due_date_str,
            "status": status,
            "daysRemaining": days_remaining,
            "slaHours": SLA_RULES.get(workflow_step, {}).get(priority, 5) * 24,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SLA status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cases/{case_id}/signal-detection")
async def get_signal_detection(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Get signal detection analysis for a case."""
    try:
        user_data = _get_current_user(authorization)
        org_id = user_data.get("org_id")
        
        rows = execute_query(
            "SELECT narrative, reported_seriousness FROM cases WHERE id = %s AND organization_id = %s",
            (case_id, org_id),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = rows[0]
        narrative = case.get("narrative", "")
        seriousness = case.get("reported_seriousness", "NON_SERIOUS")
        reported_serious = seriousness == "SERIOUS"
        
        # Determine priority from seriousness
        if seriousness == "SERIOUS":
            priority = "CRITICAL"
        else:
            priority = "NORMAL"
        
        # Detect signals
        signal = _detect_signal(narrative, priority, reported_serious)
        
        # Determine escalation needed
        needs_escalation = signal.get("weight", 0) >= 10 or priority == "CRITICAL"
        
        return {
            "caseId": case_id,
            "signal": signal,
            "needsEscalation": needs_escalation,
            "escalationTarget": "MANAGER" if needs_escalation else None,
            "recommendation": "Escalate to manager for urgent review" if needs_escalation else "Routine processing",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signal detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cases/metrics/sla-dashboard")
async def sla_dashboard(
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Get SLA metrics dashboard for organization."""
    try:
        user_data = _get_current_user(authorization)
        org_id = user_data.get("org_id")
        
        rows = execute_query(
            "SELECT workflow_step, reported_seriousness, created_at FROM cases WHERE organization_id = %s AND workflow_step != 'CLOSED'",
            (org_id,),
        )
        
        if not rows:
            return {
                "organizationId": org_id,
                "totalActiveCases": 0,
                "overdueCount": 0,
                "dueSoonCount": 0,
                "onTrackCount": 0,
                "overdueByPriority": {"CRITICAL": 0, "NORMAL": 0},
                "averageSLADaysRemaining": 0,
            }
        
        now = datetime.now(timezone.utc)
        overdue = 0
        due_soon = 0
        on_track = 0
        overdue_by_priority = {"CRITICAL": 0, "NORMAL": 0}
        total_days_remaining = 0
        
        for case in rows:
            workflow_step = case.get("workflow_step", "INTAKE")
            seriousness = case.get("reported_seriousness", "NON_SERIOUS")
            created_at = case.get("created_at")
            
            # Determine priority from seriousness
            if seriousness == "SERIOUS":
                priority = "CRITICAL"
            else:
                priority = "NORMAL"
            
            if isinstance(created_at, str):
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            elif created_at is None:
                created_at = datetime.now(timezone.utc)
            
            due_date_str = _calculate_sla_due_date(workflow_step, priority, created_at)
            due_date = datetime.fromisoformat(due_date_str).replace(tzinfo=timezone.utc)
            days_remaining = (due_date - now).days
            total_days_remaining += max(0, days_remaining)
            
            if days_remaining < 0:
                overdue += 1
                overdue_by_priority[priority] += 1
            elif days_remaining <= 1:
                due_soon += 1
            else:
                on_track += 1
        
        return {
            "organizationId": org_id,
            "totalActiveCases": len(rows),
            "overdueCount": overdue,
            "dueSoonCount": due_soon,
            "onTrackCount": on_track,
            "overdueByPriority": overdue_by_priority,
            "averageSLADaysRemaining": round(total_days_remaining / len(rows)) if rows else 0,
            "reportedAt": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SLA dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cases/metrics/signal-summary")
async def signal_summary(
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Get signal detection summary for organization."""
    try:
        user_data = _get_current_user(authorization)
        org_id = user_data.get("org_id")
        
        rows = execute_query(
            "SELECT narrative, reported_seriousness FROM cases WHERE organization_id = %s AND workflow_step != 'CLOSED'",
            (org_id,),
        )
        
        signal_counts = {}
        high_risk_cases = 0
        
        for case in rows:
            narrative = case.get("narrative", "")
            seriousness = case.get("reported_seriousness", "NON_SERIOUS")
            
            # Determine priority from seriousness
            if seriousness == "SERIOUS":
                priority = "CRITICAL"
            else:
                priority = "NORMAL"
            
            signal = _detect_signal(narrative, priority, seriousness == "SERIOUS")
            
            if signal.get("hasSignal"):
                signal_type = signal.get("signalType")
                signal_counts[signal_type] = signal_counts.get(signal_type, 0) + 1
            
            if signal.get("weight", 0) >= 10 or priority == "CRITICAL":
                high_risk_cases += 1
        
        return {
            "organizationId": org_id,
            "signalDetectedCount": sum(signal_counts.values()),
            "signalsByType": signal_counts,
            "highRiskCasesCount": high_risk_cases,
            "totalCasesAnalyzed": len(rows),
            "reportedAt": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signal summary error: {e}")
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
        result = supabase.table("cases").select("*").eq("id", case_id).eq("organization_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = result.data[0]
        narrative = case.get("narrative", "")
        reported_serious = case.get("reported_seriousness") == "SERIOUS"
        
        # Run seriousness analysis
        matched_criteria = []
        mismatch = False
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
            # Check if there's a mismatch between reported and detected seriousness
            mismatch = reported_serious != bool(any(c["detected"] for c in matched_criteria))
        except Exception as e:
            logger.warning(f"Seriousness analysis failed: {e}, using defaults")
        
        assessment_id = str(uuid.uuid4())
        assessment_data = {
            "id": assessment_id,
            "organization_id": org_id,
            "case_id": case_id,
            "reported_seriousness": "SERIOUS" if reported_serious else "NON_SERIOUS",
            "narrative_assessment": "SERIOUS" if any(c["detected"] for c in matched_criteria) else "NON_SERIOUS",
            "mismatch": mismatch,
            "criteria": matched_criteria,
            "rationale": "Narrative analysis complete",
            "engine_version": "pv_assist.seriousness.v1",
            "review_state": "PENDING_REVIEW",
            "reviewed_by": None,
            "review_decision": None,
        }
        
        # Persist to database
        supabase.table("seriousness_assessments").insert(assessment_data).execute()
        
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            "SERIOUSNESS_ASSESSED",
            "seriousness_assessment",
            assessment_id,
            reason=f"Analysis detected mismatch: {mismatch}",
        )
        
        return {
            "id": assessment_id,
            "caseId": case_id,
            "reportedSeriousness": assessment_data["reported_seriousness"],
            "narrativeAssessment": assessment_data["narrative_assessment"],
            "mismatch": mismatch,
            "criteria": matched_criteria,
            "rationale": assessment_data["rationale"],
            "engineVersion": "pv_assist.seriousness.v1",
            "reviewState": "PENDING_REVIEW",
            "reviewedBy": None,
            "reviewDecision": None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Seriousness analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/seriousness/{case_id}")
async def get_seriousness_assessment(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> Optional[dict[str, Any]]:
    """Get latest seriousness assessment for a case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        result = supabase.table("seriousness_assessments").select("*").eq("case_id", case_id).eq("organization_id", org_id).order("created_at", desc=True).limit(1).execute()
        
        if not result.data:
            return None
        
        assessment = result.data[0]
        return {
            "id": assessment["id"],
            "caseId": assessment["case_id"],
            "reportedSeriousness": assessment["reported_seriousness"],
            "narrativeAssessment": assessment["narrative_assessment"],
            "mismatch": assessment["mismatch"],
            "criteria": assessment.get("criteria", []),
            "rationale": assessment["rationale"],
            "engineVersion": assessment["engine_version"],
            "reviewState": assessment["review_state"],
            "reviewedBy": assessment.get("reviewed_by"),
            "reviewDecision": assessment.get("review_decision"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get seriousness error: {e}")
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
        
        # Get latest assessment
        result = supabase.table("seriousness_assessments").select("*").eq("case_id", case_id).eq("organization_id", org_id).order("created_at", desc=True).limit(1).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Assessment not found")
        
        assessment = result.data[0]
        
        # Update assessment with decision
        update_data = {
            "review_state": "REVIEWED",
            "reviewed_by": user_id,
            "review_decision": request.decision,
            "updated_at": _now_iso(),
        }
        
        supabase.table("seriousness_assessments").update(update_data).eq("id", assessment["id"]).execute()
        
        # If decision is to mark serious, update case seriousness
        if request.decision == "MARK_SERIOUS":
            supabase.table("cases").update({"reported_seriousness": "SERIOUS"}).eq("id", case_id).execute()
        
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            "SERIOUSNESS_REVIEWED",
            "seriousness_assessment",
            assessment["id"],
            previous_value={"review_decision": None},
            new_value={"review_decision": request.decision},
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
        result = supabase.table("cases").select("*").eq("id", case_id).eq("organization_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = result.data[0]
        
        # Load dictionaries
        try:
            data_dir = PV_ROOT / "data"
            medra = Dictionary.from_csv(
                str(data_dir / "meddra_sample.csv"),
                "MedDRA",
                "27.0"
            )
            whodrug = Dictionary.from_csv(
                str(data_dir / "whodrug_sample.csv"),
                "WHODrug",
                "2024Q4"
            )
        except Exception as e:
            logger.warning(f"Failed to load dictionaries: {e}")
            return []
        
        # Run coding
        try:
            reaction_text = case.get("reaction_term", "")
            product_text = case.get("product_name", "")
            
            coding_result = code_case(case_id, [reaction_text] if reaction_text else [], [product_text] if product_text else [], medra, whodrug)
            
            suggestions = []
            
            # Process reactions
            for reaction in coding_result.get("reactions", []):
                for cand in reaction.get("candidates", []):
                    suggestion_id = str(uuid.uuid4())
                    suggestion_data = {
                        "id": suggestion_id,
                        "organization_id": org_id,
                        "case_id": case_id,
                        "source_text": reaction.get("verbatim", ""),
                        "kind": "REACTION",
                        "term": cand.get("term", ""),
                        "code": cand.get("code", ""),
                        "dictionary": "MedDRA",
                        "dictionary_version": "27.0",
                        "match_type": "EXACT" if cand.get("method") == "exact" else "FUZZY",
                        "confidence": float(cand.get("score", 0.0)),
                        "evidence": "Matched dictionary term",
                        "status": "PENDING",
                    }
                    supabase.table("coding_suggestions").insert(suggestion_data).execute()
                    
                    suggestions.append({
                        "id": suggestion_id,
                        "sourceText": suggestion_data["source_text"],
                        "kind": "REACTION",
                        "term": cand.get("term", ""),
                        "code": cand.get("code", ""),
                        "dictionary": "MedDRA",
                        "dictionaryVersion": "27.0",
                        "matchType": "EXACT" if cand.get("method") == "exact" else "FUZZY",
                        "confidence": float(cand.get("score", 0.0)),
                        "evidence": "Matched dictionary term",
                        "status": "PENDING",
                    })
            
            # Process drugs
            for drug in coding_result.get("drugs", []):
                for cand in drug.get("candidates", []):
                    suggestion_id = str(uuid.uuid4())
                    suggestion_data = {
                        "id": suggestion_id,
                        "organization_id": org_id,
                        "case_id": case_id,
                        "source_text": drug.get("verbatim", ""),
                        "kind": "DRUG",
                        "term": cand.get("term", ""),
                        "code": cand.get("code", ""),
                        "dictionary": "WHODrug",
                        "dictionary_version": "2024Q4",
                        "match_type": "EXACT" if cand.get("method") == "exact" else "FUZZY",
                        "confidence": float(cand.get("score", 0.0)),
                        "evidence": "Matched dictionary term",
                        "status": "PENDING",
                    }
                    supabase.table("coding_suggestions").insert(suggestion_data).execute()
                    
                    suggestions.append({
                        "id": suggestion_id,
                        "sourceText": suggestion_data["source_text"],
                        "kind": "DRUG",
                        "term": cand.get("term", ""),
                        "code": cand.get("code", ""),
                        "dictionary": "WHODrug",
                        "dictionaryVersion": "2024Q4",
                        "matchType": "EXACT" if cand.get("method") == "exact" else "FUZZY",
                        "confidence": float(cand.get("score", 0.0)),
                        "evidence": "Matched dictionary term",
                        "status": "PENDING",
                    })
            
            _write_audit_event(
                supabase,
                org_id,
                user_id,
                "CODING_SUGGESTED",
                "case",
                case_id,
                reason=f"Generated {len(suggestions)} coding suggestions",
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


@app.get("/api/coding/{case_id}")
async def get_coding_suggestions(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> list[dict[str, Any]]:
    """Get all coding suggestions for a case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        result = supabase.table("coding_suggestions").select("*").eq("case_id", case_id).eq("organization_id", org_id).execute()
        
        return [
            {
                "id": s["id"],
                "sourceText": s["source_text"],
                "kind": s["kind"],
                "term": s["term"],
                "code": s["code"],
                "dictionary": s["dictionary"],
                "dictionaryVersion": s["dictionary_version"],
                "matchType": s["match_type"],
                "confidence": s["confidence"],
                "evidence": s["evidence"],
                "status": s["status"],
            }
            for s in result.data
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get coding suggestions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/coding/{case_id}/accept")
async def accept_coding(
    case_id: str,
    request: CodingDecision,
    authorization: Optional[str] = Header(None),
) -> dict[str, str]:
    """Accept a coding suggestion."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Get suggestion
        result = supabase.table("coding_suggestions").select("*").eq("id", request.suggestionId).eq("organization_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Suggestion not found")
        
        # Update suggestion status
        update_data = {
            "status": "ACCEPTED",
            "accepted_by": user_id,
            "accepted_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        supabase.table("coding_suggestions").update(update_data).eq("id", request.suggestionId).execute()
        
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            "CODING_ACCEPTED",
            "coding_suggestion",
            request.suggestionId,
            reason=request.rationale,
        )
        
        return {"status": "coding_accepted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Accept coding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/coding/{case_id}/reject")
async def reject_coding(
    case_id: str,
    request: CodingDecision,
    authorization: Optional[str] = Header(None),
) -> dict[str, str]:
    """Reject a coding suggestion."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Get suggestion
        result = supabase.table("coding_suggestions").select("*").eq("id", request.suggestionId).eq("organization_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Suggestion not found")
        
        # Update suggestion status
        update_data = {
            "status": "REJECTED",
            "updated_at": _now_iso(),
        }
        supabase.table("coding_suggestions").update(update_data).eq("id", request.suggestionId).execute()
        
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            "CODING_REJECTED",
            "coding_suggestion",
            request.suggestionId,
            reason=request.rationale,
        )
        
        return {"status": "coding_rejected"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reject coding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# CONSISTENCY CHECK ENDPOINTS (Phase 2.2)
# ============================================================================

@app.post("/api/cases/{case_id}/consistency-check")
async def run_consistency_check(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> list[dict[str, Any]]:
    """Run consistency and quality checks on a case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Get case
        result = supabase.table("cases").select("*").eq("id", case_id).eq("organization_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = result.data[0]
        
        # Run consistency checks
        checks = _perform_consistency_checks(case)
        
        # Optionally persist checks to a consistency_checks table
        for check in checks:
            check_data = {
                "id": check["id"],
                "organization_id": org_id,
                "case_id": case_id,
                "check_type": check["checkType"],
                "severity": check["severity"],
                "message": check["message"],
                "evidence": check.get("evidence"),
                "suggested_resolution": check.get("suggestedResolution"),
                "status": "OPEN",
            }
            try:
                # This will fail if consistency_checks table doesn't exist yet,
                # but we still return the checks to the user
                supabase.table("consistency_checks").insert(check_data).execute()
            except Exception:
                pass  # Table might not exist yet
        
        # Audit event
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            "CONSISTENCY_CHECK_RUN",
            "case",
            case_id,
            reason=f"Generated {len(checks)} consistency checks",
        )
        
        return checks
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Consistency check error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cases/{case_id}/consistency-check")
async def get_consistency_checks(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> list[dict[str, Any]]:
    """Retrieve consistency checks for a case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        
        # Verify case belongs to org
        case_result = supabase.table("cases").select("id").eq("id", case_id).eq("organization_id", org_id).execute()
        if not case_result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        # Try to retrieve from database (might fail if table doesn't exist)
        try:
            result = supabase.table("consistency_checks").select("*").eq("case_id", case_id).eq("organization_id", org_id).execute()
            return [
                {
                    "id": c["id"],
                    "caseId": c["case_id"],
                    "checkType": c["check_type"],
                    "severity": c["severity"],
                    "message": c["message"],
                    "evidence": c.get("evidence"),
                    "suggestedResolution": c.get("suggested_resolution"),
                    "status": c["status"],
                }
                for c in (result.data or [])
            ]
        except Exception:
            # Table doesn't exist yet, return empty list
            return []
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get consistency checks error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cases/{case_id}/consistency-check/{check_id}/acknowledge")
async def acknowledge_check(
    case_id: str,
    check_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, str]:
    """Acknowledge a consistency check finding."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Update check status
        try:
            update_data = {"status": "ACKNOWLEDGED", "updated_at": _now_iso()}
            supabase.table("consistency_checks").update(update_data).eq("id", check_id).execute()
            
            _write_audit_event(
                supabase,
                org_id,
                user_id,
                "CONSISTENCY_CHECK_ACKNOWLEDGED",
                "consistency_check",
                check_id,
                reason="User reviewed and acknowledged check finding",
            )
        except Exception:
            pass  # Table might not exist
        
        return {"status": "acknowledged"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Acknowledge check error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# INTELLIGENT TRIAGE ENDPOINTS (Phase 2.3)
# ============================================================================

@app.post("/api/cases/{case_id}/triage")
async def calculate_triage_score(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Calculate intelligent triage score and workflow recommendations for a case."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Get case
        result = supabase.table("cases").select("*").eq("id", case_id).eq("organization_id", org_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case = result.data[0]
        
        # Calculate triage score
        triage_result = _calculate_triage_score(case)
        
        # Audit event
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            "TRIAGE_SCORED",
            "case",
            case_id,
            reason=f"Triage score calculated: {triage_result['triageScore']}/100, Priority: {triage_result['priority']}",
        )
        
        return triage_result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Triage calculation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/triage/dashboard")
async def get_triage_dashboard(
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Get organization-wide triage dashboard with case metrics and trends."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        
        # Get all cases in organization
        cases_result = supabase.table("cases").select("*").eq("organization_id", org_id).execute()
        cases = cases_result.data or []
        
        # Calculate metrics
        total_cases = len(cases)
        serious_cases = len([c for c in cases if c.get("reported_seriousness") == "SERIOUS"])
        high_priority_cases = 0
        critical_cases = 0
        by_workflow_step = {}
        average_triage_score = 0
        
        triage_scores = []
        for case in cases:
            triage = _calculate_triage_score(case)
            triage_scores.append(triage["triageScore"])
            
            if triage["priority"] == "HIGH":
                high_priority_cases += 1
            elif triage["priority"] == "CRITICAL":
                critical_cases += 1
            
            workflow_step = case.get("workflow_step", "UNKNOWN")
            if workflow_step not in by_workflow_step:
                by_workflow_step[workflow_step] = 0
            by_workflow_step[workflow_step] += 1
        
        if triage_scores:
            average_triage_score = sum(triage_scores) / len(triage_scores)
        
        return {
            "totalCases": total_cases,
            "seriousCases": serious_cases,
            "seriousCasePercentage": round((serious_cases / total_cases * 100) if total_cases > 0 else 0, 1),
            "highPriorityCases": high_priority_cases,
            "criticalCases": critical_cases,
            "averageTriageScore": round(average_triage_score, 1),
            "casesByWorkflowStep": by_workflow_step,
            "metrics": {
                "completionRate": round((len([c for c in cases if c.get("workflow_step") in ["QC", "REGULATORY_READY", "CLOSED"]]) / total_cases * 100) if total_cases > 0 else 0, 1),
                "averageCasesPerUser": "N/A",  # Would require user assignment data
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Triage dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# DUPLICATE DETECTION ENDPOINTS (Phase 2.1)
# ============================================================================

@app.post("/api/cases/{case_id}/duplicate-check")
async def check_for_duplicates(
    case_id: str,
    authorization: Optional[str] = Header(None),
) -> list[dict[str, Any]]:
    """Check for duplicate cases within the organization."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Get the current case
        case_result = supabase.table("cases").select("*").eq("id", case_id).eq("organization_id", org_id).execute()
        if not case_result.data:
            raise HTTPException(status_code=404, detail="Case not found")
        
        current_case = case_result.data[0]
        
        # Get all other cases in the organization
        all_cases_result = supabase.table("cases").select("*").eq("organization_id", org_id).execute()
        all_cases = all_cases_result.data or []
        
        # Find potential duplicates
        duplicates = _find_duplicate_candidates(current_case, all_cases)
        
        # Audit event
        _write_audit_event(
            supabase,
            org_id,
            user_id,
            "DUPLICATE_CHECK_RUN",
            "case",
            case_id,
            reason=f"Found {len(duplicates)} potential duplicates",
        )
        
        return duplicates
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Duplicate check error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/duplicates/summary")
async def get_duplicates_summary(
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Get summary of duplicate issues across organization."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        
        # Try to get duplicate summary from database (might fail if table doesn't exist)
        try:
            result = supabase.table("duplicate_matches").select("*").eq("organization_id", org_id).execute()
            all_duplicates = result.data or []
            
            open_duplicates = [d for d in all_duplicates if d.get("status") == "OPEN"]
            resolved_duplicates = [d for d in all_duplicates if d.get("status") == "RESOLVED"]
            merged_cases = [d for d in all_duplicates if d.get("status") == "MERGED"]
        except Exception:
            # Table doesn't exist yet
            all_duplicates = []
            open_duplicates = []
            resolved_duplicates = []
            merged_cases = []
        
        return {
            "total": len(all_duplicates),
            "open": len(open_duplicates),
            "resolved": len(resolved_duplicates),
            "merged": len(merged_cases),
            "details": all_duplicates,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Duplicates summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/duplicates/{match_id}/resolve")
async def resolve_duplicate_match(
    match_id: str,
    action: str = "REVIEWED",  # REVIEWED, MERGED, KEEP_SEPARATE
    authorization: Optional[str] = Header(None),
) -> dict[str, str]:
    """Mark a duplicate match as reviewed/resolved."""
    try:
        user_data = _get_current_user(authorization)
        supabase = get_supabase_client()
        
        org_id = user_data.get("org_id")
        user_id = user_data.get("sub")
        
        # Update match status
        try:
            update_data = {
                "status": "RESOLVED",
                "resolution_action": action,
                "resolved_by": user_id,
                "resolved_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            supabase.table("duplicate_matches").update(update_data).eq("id", match_id).eq("organization_id", org_id).execute()
            
            _write_audit_event(
                supabase,
                org_id,
                user_id,
                "DUPLICATE_RESOLVED",
                "duplicate_match",
                match_id,
                reason=f"User reviewed and resolved with action: {action}",
            )
        except Exception:
            pass  # Table might not exist
        
        return {"status": "resolved", "action": action}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Resolve duplicate error: {e}")
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
        result = supabase.table("audit_events").select("*").eq("organization_id", org_id).order("created_at", desc=True).execute()
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
        result = supabase.table("audit_events").select("*").eq("organization_id", org_id).order("created_at", desc=True).execute()
        return [e for e in (result.data or []) if e.get("entity_id") == case_id]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"List case audit error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
