"""
Audit trail routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Optional
import logging

from ..dependencies import require_permission, AuthenticatedUser
from ..db import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("")
async def list_audit_events(
    limit: int = 50,
    offset: int = 0,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    user: AuthenticatedUser = Depends(require_permission("audit.view.all"))
):
    """
    List audit events for the organization
    """
    try:
        db = get_supabase_client()
        
        # Build filters
        filters = {"organization_id": user.organization_id}
        if entity_type:
            filters["entity_type"] = entity_type
        if entity_id:
            filters["entity_id"] = entity_id
        
        # Query audit events
        events = await db.query(
            "audit_events",
            filters=filters,
            select="*"
        )
        
        # Convert to response format
        return [
            {
                "id": event.get("id"),
                "timestamp": event.get("created_at"),
                "user": event.get("user_id"),
                "action": event.get("action"),
                "entity": event.get("entity_type"),
                "entityId": event.get("entity_id"),
                "reason": event.get("reason"),
                "previousValue": event.get("previous_value"),
                "newValue": event.get("new_value"),
            }
            for event in events
        ]
    
    except Exception as e:
        logger.error(f"List audit error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve audit events"
        )
