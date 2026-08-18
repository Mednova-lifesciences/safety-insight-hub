"""
Supabase client and database utilities
"""
import os
from typing import Optional
import httpx
import json
from datetime import datetime

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

class SupabaseClient:
    def __init__(self):
        self.url = SUPABASE_URL
        self.key = SUPABASE_SERVICE_ROLE_KEY
        self.headers = {
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
    
    async def query(self, table: str, method: str = "GET", 
                   filters: Optional[dict] = None, 
                   data: Optional[dict] = None,
                   select: Optional[str] = None) -> list:
        """Generic query builder for Supabase REST API"""
        
        endpoint = f"{self.url}/rest/v1/{table}"
        
        if select:
            self.headers["Accept"] = "application/json"
        
        # Build filter query string
        params = {}
        if filters:
            for key, value in filters.items():
                if isinstance(value, bool):
                    params[key] = f"eq.{str(value).lower()}"
                elif isinstance(value, (int, float)):
                    params[key] = f"eq.{value}"
                elif isinstance(value, list):
                    params[key] = f"in.({','.join(str(v) for v in value)})"
                else:
                    params[key] = f"eq.{value}"
        
        if select:
            params["select"] = select
        
        async with httpx.AsyncClient() as client:
            if method == "GET":
                response = await client.get(endpoint, headers=self.headers, params=params)
            elif method == "POST":
                response = await client.post(endpoint, headers=self.headers, json=data)
            elif method == "PATCH":
                response = await client.patch(endpoint, headers=self.headers, json=data, params=filters)
            elif method == "DELETE":
                response = await client.delete(endpoint, headers=self.headers, params=filters)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            if response.status_code >= 400:
                raise Exception(f"Supabase error: {response.status_code} - {response.text}")
            
            if method == "DELETE":
                return []
            
            return response.json() if response.content else []
    
    async def get_user_profile(self, user_id: str):
        """Get user profile with organization"""
        results = await self.query(
            "profiles",
            filters={"id": user_id},
            select="*, organizations(*)"
        )
        return results[0] if results else None
    
    async def get_case(self, case_id: str, org_id: str):
        """Get a specific case"""
        results = await self.query(
            "cases",
            filters={"id": case_id, "organization_id": org_id},
            select="*"
        )
        return results[0] if results else None
    
    async def list_cases(self, org_id: str, user_id: str):
        """List cases for an organization"""
        return await self.query(
            "cases",
            filters={"organization_id": org_id},
            select="*"
        )
    
    async def create_case(self, org_id: str, user_id: str, case_data: dict):
        """Create a new case"""
        case_data["organization_id"] = org_id
        case_data["created_by"] = user_id
        case_data["created_at"] = datetime.utcnow().isoformat()
        
        results = await self.query("cases", method="POST", data=case_data)
        return results[0] if results else None
    
    async def create_audit_event(self, org_id: str, user_id: str, 
                                action: str, entity_type: str, entity_id: str,
                                reason: Optional[str] = None):
        """Log an audit event"""
        event = {
            "organization_id": org_id,
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "reason": reason,
            "created_at": datetime.utcnow().isoformat()
        }
        results = await self.query("audit_events", method="POST", data=event)
        return results[0] if results else None

# Singleton instance
_client = None

def get_supabase_client() -> SupabaseClient:
    global _client
    if _client is None:
        _client = SupabaseClient()
    return _client
