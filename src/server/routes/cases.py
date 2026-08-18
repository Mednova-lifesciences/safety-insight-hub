"""
Cases (ICSR) routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import logging

from ..dependencies import get_current_user, require_permission, AuthenticatedUser
from ..db import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter()

class ReporterInfo(BaseModel):
    name: str
    qualification: Optional[str] = None
    country: Optional[str] = None
    contact: Optional[str] = None
    consentToContact: Optional[bool] = None

class PatientInfo(BaseModel):
    identifier: str
    age: Optional[str] = None
    sex: Optional[str] = None
    weightKg: Optional[str] = None
    medicalHistory: Optional[str] = None

class SuspectProduct(BaseModel):
    reportedName: str
    activeIngredient: Optional[str] = None
    dose: Optional[str] = None
    route: Optional[str] = None
    indication: Optional[str] = None
    therapyStart: Optional[str] = None
    action: Optional[str] = None

class ReactionEvent(BaseModel):
    reportedTerm: str
    onsetDate: Optional[str] = None
    outcome: Optional[str] = None

class CreateCaseRequest(BaseModel):
    reporter: ReporterInfo
    patient: PatientInfo
    product: SuspectProduct
    reaction: ReactionEvent
    narrative: Optional[str] = None
    reportedSeriousness: Optional[str] = None
    seriousnessCriteria: Optional[List[str]] = None

class CaseListItem(BaseModel):
    id: str
    caseId: str
    patientIdentifier: str
    product: str
    reaction: str
    seriousness: Optional[str] = None
    workflowStep: str
    assignedTo: Optional[str] = None
    receivedDate: str
    dueDate: Optional[str] = None

@router.post("")
async def create_case(
    request: CreateCaseRequest,
    user: AuthenticatedUser = Depends(require_permission("case.create"))
):
    """
    Create a new ICSR/case
    """
    try:
        db = get_supabase_client()
        
        # Generate case ID (organization prefix + timestamp)
        case_id = f"MN-{datetime.utcnow().strftime('%Y')}-{datetime.utcnow().timestamp():.0f}"
        
        case_data = {
            "case_id": case_id,
            "reporter_name": request.reporter.name,
            "reporter_qualification": request.reporter.qualification,
            "reporter_country": request.reporter.country,
            "reporter_contact": request.reporter.contact,
            "reporter_consent_to_contact": request.reporter.consentToContact,
            "patient_identifier": request.patient.identifier,
            "patient_age": request.patient.age,
            "patient_sex": request.patient.sex,
            "patient_weight_kg": request.patient.weightKg,
            "patient_medical_history": request.patient.medicalHistory,
            "product_name": request.product.reportedName,
            "product_active_ingredient": request.product.activeIngredient,
            "product_dose": request.product.dose,
            "product_route": request.product.route,
            "product_indication": request.product.indication,
            "product_therapy_start": request.product.therapyStart,
            "product_action": request.product.action,
            "reaction_term": request.reaction.reportedTerm,
            "reaction_onset_date": request.reaction.onsetDate,
            "reaction_outcome": request.reaction.outcome,
            "narrative": request.narrative,
            "reported_seriousness": request.reportedSeriousness,
            "seriousness_criteria": request.seriousnessCriteria or [],
            "workflow_step": "INTAKE",
            "source": "MANUAL"
        }
        
        case = await db.create_case(user.organization_id, user.user_id, case_data)
        
        # Log audit event
        await db.create_audit_event(
            user.organization_id,
            user.user_id,
            "CASE_CREATED",
            "Case",
            case_id,
            f"New ICSR created: {request.patient.identifier} - {request.product.reportedName}"
        )
        
        return {
            "caseId": case.get("id"),
            "caseNumber": case_id,
            "status": "created"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Case creation error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create case"
        )

@router.get("")
async def list_cases(
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    List all cases for the user's organization
    """
    try:
        db = get_supabase_client()
        cases = await db.list_cases(user.organization_id, user.user_id)
        
        return [
            {
                "id": case.get("id"),
                "caseId": case.get("case_id"),
                "patientIdentifier": case.get("patient_identifier"),
                "product": case.get("product_name"),
                "reaction": case.get("reaction_term"),
                "seriousness": case.get("reported_seriousness"),
                "workflowStep": case.get("workflow_step"),
                "assignedTo": case.get("assigned_to"),
                "receivedDate": case.get("created_at", "").split("T")[0] if case.get("created_at") else "",
                "dueDate": None,
                "outcome": case.get("reaction_outcome") or "UNKNOWN",
                "priority": "HIGH" if case.get("reported_seriousness") == "SERIOUS" else "MEDIUM",
                "flags": [],
                "source": case.get("source") or "MANUAL",
            }
            for case in cases
        ]
    
    except Exception as e:
        logger.error(f"List cases error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list cases"
        )

@router.get("/{case_id}")
async def get_case(
    case_id: str,
    user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get a specific case
    """
    try:
        db = get_supabase_client()
        case = await db.get_case(case_id, user.organization_id)
        
        if not case:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Case not found"
            )
        
        return {
            "id": case.get("id"),
            "caseId": case.get("case_id"),
            "patientIdentifier": case.get("patient_identifier"),
            "product": case.get("product_name"),
            "reaction": case.get("reaction_term"),
            "seriousness": case.get("reported_seriousness"),
            "workflowStep": case.get("workflow_step"),
            "reporter": {
                "name": case.get("reporter_name"),
                "qualification": case.get("reporter_qualification"),
                "country": case.get("reporter_country"),
            },
            "patient": {
                "identifier": case.get("patient_identifier"),
                "age": case.get("patient_age"),
                "sex": case.get("patient_sex"),
                "weightKg": case.get("patient_weight_kg"),
            },
            "product": {
                "reportedName": case.get("product_name"),
                "dose": case.get("product_dose"),
                "route": case.get("product_route"),
            },
            "reaction": {
                "reportedTerm": case.get("reaction_term"),
                "onsetDate": case.get("reaction_onset_date"),
                "outcome": case.get("reaction_outcome"),
            },
            "narrative": case.get("narrative"),
            "createdAt": case.get("created_at"),
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get case error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve case"
        )
