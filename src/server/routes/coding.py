"""
Coding assistance routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
import logging
import re
from functools import lru_cache
from pathlib import Path

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

MEDDRA_VERSION = "29.1"
MEDDRA_ROOT = Path(__file__).resolve().parents[3] / "docs" / "MedDRA_29_1_English" / "MedAscii"


class MedDraTerm(BaseModel):
    code: str
    term: str
    preferred_term: str
    preferred_term_code: str
    hierarchy: dict[str, str] = {}


class MedDraResolution(BaseModel):
    source_value: str
    status: str
    dictionary: str = "MedDRA"
    dictionary_version: str = MEDDRA_VERSION
    mapping_method: str = "LICENSED_DICTIONARY"
    term: Optional[MedDraTerm] = None


def _meddra_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


@lru_cache(maxsize=1)
def _load_meddra() -> tuple[dict[str, MedDraTerm], dict[str, MedDraTerm]]:
    """Load the supplied MedDRA release once per worker.

    LLT is the coding level used by E2B(R3). The hierarchy file supplies the
    corresponding PT/HLT/HLGT/SOC context without exposing the raw release
    files through the API.
    """
    llt_path = MEDDRA_ROOT / "llt.asc"
    hierarchy_path = MEDDRA_ROOT / "mdhier.asc"
    if not llt_path.is_file() or not hierarchy_path.is_file():
        raise FileNotFoundError(f"MedDRA {MEDDRA_VERSION} files are not installed")

    pt_names: dict[str, str] = {}
    with (MEDDRA_ROOT / "pt.asc").open(encoding="latin-1") as stream:
        for line in stream:
            fields = line.rstrip("\r\n").split("$")
            if len(fields) >= 2 and fields[0] and fields[1]:
                pt_names[fields[0]] = fields[1]

    hierarchy: dict[str, dict[str, str]] = {}
    with hierarchy_path.open(encoding="latin-1") as stream:
        for line in stream:
            fields = line.rstrip("\r\n").split("$")
            if len(fields) >= 9 and fields[0] and fields[4]:
                hierarchy[fields[0]] = {
                    "preferred_term_code": fields[0],
                    "preferred_term": pt_names.get(fields[0], fields[4]),
                    "hlt": fields[5],
                    "hlgt": fields[6],
                    "soc": fields[7],
                }

    by_code: dict[str, MedDraTerm] = {}
    by_key: dict[str, MedDraTerm] = {}
    with llt_path.open(encoding="latin-1") as stream:
        for line in stream:
            fields = line.rstrip("\r\n").split("$")
            if len(fields) < 3 or not fields[0] or not fields[1] or not fields[2]:
                continue
            context = hierarchy.get(fields[2])
            if not context or not context["preferred_term"]:
                continue
            term = MedDraTerm(
                code=fields[0],
                term=fields[1],
                preferred_term=context["preferred_term"],
                preferred_term_code=context["preferred_term_code"],
                hierarchy=context,
            )
            by_code[term.code] = term
            by_key.setdefault(_meddra_key(term.term), term)
    return by_code, by_key


@router.get("/meddra/status")
async def meddra_status(user: AuthenticatedUser = Depends(get_current_user)):
    by_code, _ = _load_meddra()
    return {"configured": bool(by_code), "dictionary": "MedDRA", "version": MEDDRA_VERSION}


@router.post("/meddra/resolve", response_model=MedDraResolution)
async def resolve_meddra(
    request: dict,
    user: AuthenticatedUser = Depends(get_current_user),
):
    source = str(request.get("text", "")).strip()
    if not source:
        return MedDraResolution(source_value=source, status="INVALID", term=None)
    by_code, by_key = _load_meddra()
    term = by_code.get(source) or by_key.get(_meddra_key(source))
    if not term:
        return MedDraResolution(source_value=source, status="UNMAPPED", term=None)
    return MedDraResolution(source_value=source, status="MAPPED", term=term)


@router.get("/meddra/search")
async def search_meddra(
    q: str = "",
    limit: int = 20,
    user: AuthenticatedUser = Depends(get_current_user),
):
    query = _meddra_key(q)
    if not query:
        return []
    _, by_key = _load_meddra()
    results = [
        term for key, term in by_key.items() if query in key
    ][: max(1, min(limit, 50))]
    return [
        {
            "term": term.term,
            "code": term.code,
            "dictionary": "MedDRA",
            "dictionaryVersion": MEDDRA_VERSION,
            "preferredTerm": term.preferred_term,
            "preferredTermCode": term.preferred_term_code,
        }
        for term in results
    ]

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
