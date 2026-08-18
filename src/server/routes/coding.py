"""
Coding assistance routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
import logging

from ..dependencies import get_current_user, AuthenticatedUser
from ..db import get_supabase_client

# Import PV-Assist coding module
try:
    from pv_assist.coding.coder import suggest, code_case
    from pv_assist.coding.dictionary import Dictionary
    PV_ASSIST_AVAILABLE = True
except ImportError:
    PV_ASSIST_AVAILABLE = False
    logging.warning("PV-Assist coding module not available")

logger = logging.getLogger(__name__)

router = APIRouter()

class CodingSuggestion(BaseModel):
    id: str
    sourceText: str
    kind: str  # DRUG or REACTION
    term: str
    code: str
    dictionary: str  # MedDRA or WHODrug
    dictionaryVersion: str
    matchType: str
    confidence: float
    evidence: str
    status: str

class CodingRequest(BaseModel):
    caseId: str
    sourceText: str
    kind: str  # DRUG or REACTION

@router.post("/suggest/{case_id}")
async def suggest_coding(
    case_id: str,
    request: CodingRequest,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get coding suggestions for a reaction or drug
    """
    
    if not PV_ASSIST_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PV-Assist coding module not available"
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
        
        # Load dictionaries (currently using sample data)
        # In production, these would be loaded from configuration
        import os
        from pathlib import Path
        
        sample_data_dir = Path(__file__).parent.parent.parent.parent / "mednova-pv-assist" / "mednova-pv-assist" / "data"
        
        try:
            if request.kind == "REACTION":
                dictionary = Dictionary.from_csv(
                    str(sample_data_dir / "meddra_sample.csv"),
                    "MedDRA",
                    "27.0"
                )
            else:  # DRUG
                dictionary = Dictionary.from_csv(
                    str(sample_data_dir / "whodrug_sample.csv"),
                    "WHODrug",
                    "GLOBAL-2025-Sep"
                )
        except Exception as e:
            logger.warning(f"Could not load dictionary: {str(e)}")
            return []
        
        # Get suggestions
        candidates = suggest(request.sourceText, dictionary, top_n=5)
        
        suggestions = []
        for i, candidate in enumerate(candidates):
            suggestion_id = f"cs-{i+1}"
            suggestion = {
                "id": suggestion_id,
                "sourceText": request.sourceText,
                "kind": request.kind,
                "term": candidate.term,
                "code": candidate.code,
                "dictionary": dictionary.name,
                "dictionaryVersion": dictionary.version,
                "matchType": candidate.method,
                "confidence": candidate.score,
                "evidence": f"Match: {candidate.method}",
                "status": "PENDING"
            }
            
            # Save to database
            await db.query(
                "coding_suggestions",
                method="POST",
                data={
                    "organization_id": user.organization_id,
                    "case_id": case_id,
                    "source_text": request.sourceText,
                    "kind": request.kind,
                    "term": candidate.term,
                    "code": candidate.code,
                    "dictionary": dictionary.name,
                    "dictionary_version": dictionary.version,
                    "match_type": candidate.method,
                    "confidence": float(candidate.score),
                    "evidence": f"Match: {candidate.method}",
                    "status": "PENDING"
                }
            )
            
            suggestions.append(suggestion)
        
        # Log audit event
        await db.create_audit_event(
            user.organization_id,
            user.user_id,
            "CODING_SUGGESTED",
            "Case",
            case_id,
            f"Coding suggestions generated for {request.kind}: {request.sourceText}"
        )
        
        return suggestions
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Coding suggestion error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate coding suggestions"
        )

@router.post("/{case_id}/accept")
async def accept_coding(
    case_id: str,
    suggestion_id: str,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Accept a coding suggestion
    """
    try:
        db = get_supabase_client()
        
        # Update the suggestion status
        await db.query(
            "coding_suggestions",
            method="PATCH",
            filters={"id": suggestion_id},
            data={
                "status": "ACCEPTED",
                "accepted_by": user.user_id,
                "accepted_at": db.query.__self__.url  # timestamp
            }
        )
        
        # Log audit event
        await db.create_audit_event(
            user.organization_id,
            user.user_id,
            "CODING_ACCEPTED",
            "Case",
            case_id,
            f"Coding suggestion accepted"
        )
        
        return {"status": "accepted"}
    
    except Exception as e:
        logger.error(f"Accept coding error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to accept coding"
        )

@router.post("/{case_id}/reject")
async def reject_coding(
    case_id: str,
    suggestion_id: str,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Reject a coding suggestion
    """
    try:
        db = get_supabase_client()
        
        # Update the suggestion status
        await db.query(
            "coding_suggestions",
            method="PATCH",
            filters={"id": suggestion_id},
            data={"status": "REJECTED"}
        )
        
        # Log audit event
        await db.create_audit_event(
            user.organization_id,
            user.user_id,
            "CODING_REJECTED",
            "Case",
            case_id,
            f"Coding suggestion rejected"
        )
        
        return {"status": "rejected"}
    
    except Exception as e:
        logger.error(f"Reject coding error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reject coding"
        )
