"""
Seriousness assessment routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
import logging

from ..dependencies import get_current_user, AuthenticatedUser
from ..db import get_supabase_client

# Import PV-Assist seriousness module
try:
    from pv_assist.seriousness.analyzer import analyze
    from pv_assist.audit import AuditTrail
    from pv_assist.llm import LLMClient
    PV_ASSIST_AVAILABLE = True
except ImportError:
    PV_ASSIST_AVAILABLE = False
    logging.warning("PV-Assist seriousness module not available")

logger = logging.getLogger(__name__)

router = APIRouter()

class SeriousnessAnalysisRequest(BaseModel):
    caseId: str
    narrative: str
    reportedSeriousness: Optional[str] = None

class CriterionHit(BaseModel):
    key: str
    label: str
    evidence: str

class SeriousnessAnalysisResponse(BaseModel):
    caseId: str
    reportedSeriousness: Optional[str]
    narrativeAssessment: str
    mismatch: bool
    criteria: List[dict]
    rationale: str
    priority: str

@router.post("/analyze/{case_id}")
async def analyze_seriousness(
    case_id: str,
    request: SeriousnessAnalysisRequest,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Analyze seriousness of a case using PV-Assist rules
    """
    
    if not PV_ASSIST_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PV-Assist seriousness module not available"
        )
    
    try:
        db = get_supabase_client()
        
        # Get the case
        case = await db.get_case(case_id, user.organization_id)
        if not case:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Case not found"
            )
        
        # Run seriousness analysis
        reported_serious = None
        if request.reportedSeriousness:
            reported_serious = request.reportedSeriousness == "SERIOUS"
        
        # Initialize LLM client (disabled by default for now)
        llm = LLMClient(provider="none")
        
        # Run analysis
        result = analyze(
            case_id,
            request.narrative,
            reported_serious,
            audit=None,  # Audit handled separately
            llm=llm
        )
        
        # Map result to response
        response = {
            "caseId": case_id,
            "reportedSeriousness": request.reportedSeriousness,
            "narrativeAssessment": "SERIOUS" if result.narrative_suggests_serious else "NON_SERIOUS",
            "mismatch": result.mismatch,
            "criteria": [
                {
                    "key": c.get("key"),
                    "label": c.get("label"),
                    "evidence": c.get("evidence"),
                }
                for c in result.matched_criteria
            ],
            "rationale": result.priority,
            "priority": result.priority
        }
        
        # Save assessment to database
        assessment_data = {
            "case_id": case_id,
            "reported_seriousness": request.reportedSeriousness,
            "narrative_assessment": response["narrativeAssessment"],
            "mismatch": result.mismatch,
            "criteria": result.matched_criteria,
            "rationale": result.priority,
            "engine_version": "pv_assist.seriousness",
            "review_state": "PENDING_REVIEW"
        }
        
        await db.query(
            "seriousness_assessments",
            method="POST",
            data={
                "organization_id": user.organization_id,
                **assessment_data
            }
        )
        
        # Log audit event
        await db.create_audit_event(
            user.organization_id,
            user.user_id,
            "SERIOUSNESS_ANALYZED",
            "Case",
            case_id,
            f"Seriousness analysis completed - Mismatch: {result.mismatch}"
        )
        
        return response
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Seriousness analysis error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to analyze seriousness"
        )

@router.get("/{case_id}")
async def get_seriousness_assessment(
    case_id: str,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get seriousness assessment for a case
    """
    try:
        db = get_supabase_client()
        
        results = await db.query(
            "seriousness_assessments",
            filters={"case_id": case_id, "organization_id": user.organization_id}
        )
        
        if not results:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        assessment = results[0]
        return {
            "caseId": case_id,
            "reportedSeriousness": assessment.get("reported_seriousness"),
            "narrativeAssessment": assessment.get("narrative_assessment"),
            "mismatch": assessment.get("mismatch"),
            "criteria": assessment.get("criteria", []),
            "rationale": assessment.get("rationale"),
            "priority": assessment.get("rationale"),
            "reviewState": assessment.get("review_state"),
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get assessment error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve assessment"
        )
