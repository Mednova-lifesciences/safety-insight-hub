"""
Signal Detection and Signal Lifecycle Routes

This module implements the pharmacovigilance signal workflow:
1. Signal Detection Runs (frozen, immutable dataset snapshots)
2. Signal Candidates (individual potential signals identified)
3. Signal Assessments (human review and decisions)

Key principle: AI/automated systems can FLAG candidates.
ONLY humans can CONFIRM/REFUTE signals after review.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
import logging
import json

from ..dependencies import get_current_user, AuthenticatedUser
from ..db import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("")
async def list_signals(
    status: Optional[str] = None,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Return signal candidates through the frontend's collection endpoint."""
    filters = {"organization_id": user.organization_id}
    if status:
        filters["state"] = status
    candidates = await get_supabase_client().query(
        "signal_candidates",
        filters=filters,
        select="*",
    )
    return [
        {
            "id": candidate.get("id"),
            "reference": candidate.get("id"),
            "product": candidate.get("product_name"),
            "reaction": candidate.get("reaction_term"),
            "status": candidate.get("state"),
            "caseCount": candidate.get("case_count"),
            "confidence": candidate.get("confidence_level"),
        }
        for candidate in candidates
    ]

# Request/Response Models

class SignalDetectionRunRequest(BaseModel):
    """Request to create a new signal detection run."""
    start_date: date
    end_date: date
    detection_method: str = "CASE_SERIES_SCREENING"
    dictionary_version: str
    total_cases_in_period: int
    cases_after_deduplication: int
    cases_included_in_detection: int
    exclusion_criteria: Optional[dict] = None
    threshold_config: Optional[dict] = None


class SignalCandidateCreateRequest(BaseModel):
    """Request to create a signal candidate."""
    detection_run_id: str
    product_name: str
    reaction_term: str
    reaction_soc: Optional[str] = None
    case_count: int
    cases_serious: int = 0
    cases_fatal: int = 0
    statistical_metric: Optional[dict] = None
    confidence_level: Optional[str] = None  # LOW, MEDIUM, HIGH
    evidence_case_ids: List[str] = []


class SignalAssessmentRequest(BaseModel):
    """Request to assess a signal candidate."""
    evidence_for: str
    evidence_against: str = ""
    confounders: str = ""
    alternative_explanations: str = ""
    regulatory_context: str = ""
    lit_search_performed: bool = False
    lit_search_result: Optional[str] = None
    recommendation: str  # NO_ACTION, CONTINUE_MONITORING, INVESTIGATION_NEEDED, etc.
    decision: str  # CONFIRMED_SIGNAL, POTENTIAL_SIGNAL, NOT_A_SIGNAL, INSUFFICIENT_DATA
    action: Optional[str] = None
    next_review_date: Optional[date] = None
    closure_rationale: Optional[str] = None


class SignalStateChangeRequest(BaseModel):
    """Request to change signal state."""
    new_state: str  # DETECTED, UNDER_REVIEW, VALIDATED, CONFIRMED, REFUTED, WITHDRAWN


# Signal Detection Run Endpoints

@router.post("/detection-runs")
async def create_detection_run(
    request: SignalDetectionRunRequest,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Create a new signal detection run.
    
    This creates an immutable snapshot of detection parameters and results.
    Once created, a detection run cannot be modified.
    
    Detection runs are the foundation for reproducible signal detection.
    All signal candidates reference their parent detection run and the
    frozen dataset configuration at detection time.
    """
    try:
        db = get_supabase_client()
        
        # Create detection run
        run_data = {
            "organization_id": user.organization_id,
            "start_date": request.start_date.isoformat(),
            "end_date": request.end_date.isoformat(),
            "detection_method": request.detection_method,
            "dictionary_version": request.dictionary_version,
            "total_cases_in_period": request.total_cases_in_period,
            "cases_after_deduplication": request.cases_after_deduplication,
            "cases_included_in_detection": request.cases_included_in_detection,
            "exclusion_criteria": request.exclusion_criteria,
            "threshold_config": request.threshold_config,
            "created_by": user.user_id,
        }
        
        result = db.table("signal_detection_runs").insert(run_data).execute()
        
        return {
            "id": result.data[0].get("id"),
            "status": "created",
            "message": "Detection run created successfully (immutable)"
        }
    
    except Exception as e:
        logger.error(f"Failed to create detection run: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create detection run: {str(e)}")


@router.get("/detection-runs")
async def list_detection_runs(
    limit: int = 50,
    offset: int = 0,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """List signal detection runs for the organization."""
    try:
        db = get_supabase_client()
        
        runs = db.table("signal_detection_runs")\
            .select("*")\
            .eq("organization_id", user.organization_id)\
            .order("created_at", desc=True)\
            .limit(limit)\
            .offset(offset)\
            .execute()
        
        return {
            "runs": runs.data or [],
            "total": len(runs.data)
        }
    
    except Exception as e:
        logger.error(f"Failed to list detection runs: {e}")
        raise HTTPException(status_code=500, detail="Failed to list detection runs")


# Signal Candidate Endpoints

@router.post("/candidates")
async def create_signal_candidate(
    request: SignalCandidateCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Create a new signal candidate from a detection run.
    
    A signal candidate is a DETECTED signal flagged by an automated system.
    The candidate remains in DETECTED state until human review.
    
    NO automatic confirmation occurs.
    Human assessment is mandatory before transitioning to CONFIRMED/REFUTED.
    """
    try:
        db = get_supabase_client()
        
        candidate_data = {
            "organization_id": user.organization_id,
            "detection_run_id": request.detection_run_id,
            "product_name": request.product_name,
            "reaction_term": request.reaction_term,
            "reaction_soc": request.reaction_soc,
            "case_count": request.case_count,
            "cases_serious": request.cases_serious,
            "cases_fatal": request.cases_fatal,
            "statistical_metric": request.statistical_metric,
            "confidence_level": request.confidence_level,
            "evidence_case_ids": request.evidence_case_ids,
            "state": "DETECTED",
        }
        
        result = db.table("signal_candidates").insert(candidate_data).execute()
        
        return {
            "id": result.data[0].get("id"),
            "state": "DETECTED",
            "message": "Signal candidate created and awaiting human review"
        }
    
    except Exception as e:
        logger.error(f"Failed to create signal candidate: {e}")
        raise HTTPException(status_code=500, detail="Failed to create signal candidate")


@router.get("/candidates")
async def list_signal_candidates(
    state: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    List signal candidates for the organization.
    
    Filter by state: DETECTED, UNDER_REVIEW, VALIDATED, CONFIRMED, REFUTED, WITHDRAWN
    """
    try:
        db = get_supabase_client()
        
        query = db.table("signal_candidates")\
            .select("*")\
            .eq("organization_id", user.organization_id)
        
        if state:
            query = query.eq("state", state)
        
        candidates = query.order("created_at", desc=True)\
            .limit(limit)\
            .offset(offset)\
            .execute()
        
        return {
            "candidates": candidates.data or [],
            "total": len(candidates.data)
        }
    
    except Exception as e:
        logger.error(f"Failed to list signal candidates: {e}")
        raise HTTPException(status_code=500, detail="Failed to list signal candidates")


@router.get("/candidates/{candidate_id}")
async def get_signal_candidate(
    candidate_id: str,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """Get details of a specific signal candidate."""
    try:
        db = get_supabase_client()
        
        candidate = db.table("signal_candidates")\
            .select("*")\
            .eq("id", candidate_id)\
            .eq("organization_id", user.organization_id)\
            .single()\
            .execute()
        
        if not candidate.data:
            raise HTTPException(status_code=404, detail="Signal candidate not found")
        
        # Get assessment history
        assessments = db.table("signal_assessments")\
            .select("*")\
            .eq("signal_candidate_id", candidate_id)\
            .order("assessed_at", desc=True)\
            .execute()
        
        return {
            "candidate": candidate.data,
            "assessments": assessments.data or []
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get signal candidate: {e}")
        raise HTTPException(status_code=500, detail="Failed to get signal candidate")


@router.post("/candidates/{candidate_id}/state")
async def change_signal_state(
    candidate_id: str,
    request: SignalStateChangeRequest,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Change the state of a signal candidate.
    
    Allowed transitions:
    - DETECTED → UNDER_REVIEW (human starts reviewing)
    - UNDER_REVIEW → VALIDATED (human completes review without final decision)
    - VALIDATED → CONFIRMED (human confirms signal)
    - VALIDATED → REFUTED (human refutes signal)
    - ANY → WITHDRAWN (signal invalidated)
    
    CRITICAL: State changes to CONFIRMED/REFUTED require an accompanying assessment.
    """
    try:
        db = get_supabase_client()
        
        # Verify candidate exists
        candidate = db.table("signal_candidates")\
            .select("state")\
            .eq("id", candidate_id)\
            .eq("organization_id", user.organization_id)\
            .single()\
            .execute()
        
        if not candidate.data:
            raise HTTPException(status_code=404, detail="Signal candidate not found")
        
        current_state = candidate.data.get("state")
        
        # Validate state transition
        valid_transitions = {
            "DETECTED": ["UNDER_REVIEW", "WITHDRAWN"],
            "UNDER_REVIEW": ["VALIDATED", "WITHDRAWN"],
            "VALIDATED": ["CONFIRMED", "REFUTED", "WITHDRAWN"],
            "CONFIRMED": ["WITHDRAWN"],
            "REFUTED": ["WITHDRAWN"],
            "WITHDRAWN": []
        }
        
        if request.new_state not in valid_transitions.get(current_state, []):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid state transition: {current_state} → {request.new_state}"
            )
        
        # Update state
        db.table("signal_candidates")\
            .update({"state": request.new_state})\
            .eq("id", candidate_id)\
            .execute()
        
        logger.info(f"Signal {candidate_id} state changed: {current_state} → {request.new_state}")
        
        return {
            "id": candidate_id,
            "previous_state": current_state,
            "new_state": request.new_state,
            "message": f"Signal state updated to {request.new_state}"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to change signal state: {e}")
        raise HTTPException(status_code=500, detail="Failed to change signal state")


# Signal Assessment Endpoints

@router.post("/candidates/{candidate_id}/assess")
async def create_signal_assessment(
    candidate_id: str,
    request: SignalAssessmentRequest,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Create a signal assessment for a candidate.
    
    This is where the HUMAN DECISION is made.
    Assessment must include rationale and decision.
    
    Decision options:
    - CONFIRMED_SIGNAL: Signal is real, warrants action
    - POTENTIAL_SIGNAL: Needs more data
    - NOT_A_SIGNAL: Explained by confounders or bias
    - INSUFFICIENT_DATA: Cannot determine
    
    This is an audit-required decision point.
    """
    try:
        db = get_supabase_client()
        
        assessment_data = {
            "organization_id": user.organization_id,
            "signal_candidate_id": candidate_id,
            "evidence_for": request.evidence_for,
            "evidence_against": request.evidence_against,
            "confounders": request.confounders,
            "alternative_explanations": request.alternative_explanations,
            "regulatory_context": request.regulatory_context,
            "lit_search_performed": request.lit_search_performed,
            "lit_search_result": request.lit_search_result,
            "recommendation": request.recommendation,
            "decision": request.decision,
            "action": request.action,
            "next_review_date": request.next_review_date.isoformat() if request.next_review_date else None,
            "closure_rationale": request.closure_rationale,
            "assessed_by": user.user_id,
        }
        
        result = db.table("signal_assessments").insert(assessment_data).execute()
        
        logger.info(f"Signal assessment created: {candidate_id} → {request.decision}")
        
        return {
            "id": result.data[0].get("id"),
            "decision": request.decision,
            "message": "Signal assessment recorded with human decision"
        }
    
    except Exception as e:
        logger.error(f"Failed to create signal assessment: {e}")
        raise HTTPException(status_code=500, detail="Failed to create signal assessment")


@router.get("/candidates/{candidate_id}/assessments")
async def list_signal_assessments(
    candidate_id: str,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """Get all assessments for a signal candidate (versioned history)."""
    try:
        db = get_supabase_client()
        
        assessments = db.table("signal_assessments")\
            .select("*")\
            .eq("signal_candidate_id", candidate_id)\
            .eq("organization_id", user.organization_id)\
            .order("assessed_at", desc=True)\
            .execute()
        
        return {
            "assessments": assessments.data or [],
            "total": len(assessments.data)
        }
    
    except Exception as e:
        logger.error(f"Failed to list assessments: {e}")
        raise HTTPException(status_code=500, detail="Failed to list assessments")


# Summary Endpoints

@router.get("/summary")
async def get_signals_summary(
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get organization-wide signal summary.
    
    Provides:
    - Count by state (DETECTED, CONFIRMED, REFUTED, etc.)
    - Recent candidates
    - Pending assessments
    """
    try:
        db = get_supabase_client()
        
        candidates = db.table("signal_candidates")\
            .select("state")\
            .eq("organization_id", user.organization_id)\
            .execute()
        
        # Aggregate by state
        state_counts = {}
        for candidate in candidates.data or []:
            state = candidate.get("state", "UNKNOWN")
            state_counts[state] = state_counts.get(state, 0) + 1
        
        return {
            "total_candidates": len(candidates.data or []),
            "by_state": state_counts,
            "summary": {
                "awaiting_review": state_counts.get("DETECTED", 0) + state_counts.get("UNDER_REVIEW", 0),
                "confirmed": state_counts.get("CONFIRMED", 0),
                "refuted": state_counts.get("REFUTED", 0),
                "withdrawn": state_counts.get("WITHDRAWN", 0),
            }
        }
    
    except Exception as e:
        logger.error(f"Failed to get signals summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to get signals summary")
