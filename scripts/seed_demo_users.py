"""Create or update the four Safety Insight Hub demo accounts.

This script is intentionally limited to accounts in the demo email namespace.
It never deletes users or application data.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import httpx


DEMO_PASSWORD = os.getenv("DEMO_USER_PASSWORD", "demo123")
DEMO_ORGANIZATION = "Safety Insight Hub Demo"
DEMO_ORG_SLUG = "demo"
DEMO_ORG_INVITE_CODE = "DEMO-0000"
DEMO_USERS = [
    ("field@demo.safetyinsighthub.com", "Demo Field Associate", "FIELD_ASSOCIATE"),
    ("coordinator@demo.safetyinsighthub.com", "Demo PV Coordinator", "PV_COORDINATOR"),
    ("manager@demo.safetyinsighthub.com", "Demo PV Manager", "PV_MANAGER"),
    ("admin@demo.safetyinsighthub.com", "Demo Administrator", "ADMIN"),
]


def env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def request(client: httpx.Client, method: str, path: str, **kwargs: Any) -> Any:
    response = client.request(method, path, **kwargs)
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase request failed: {method} {path} ({response.status_code})")
    return response.json() if response.content else None


def main() -> int:
    base_url = env("SUPABASE_URL").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip() or env("SERVICE_ROLE_KEY")
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    with httpx.Client(base_url=base_url, headers=headers, timeout=30) as client:
        users_payload = request(client, "GET", "/auth/v1/admin/users?page=1&per_page=1000")
        auth_users = {item["email"].lower(): item for item in users_payload.get("users", []) if item.get("email")}

        organizations = request(
            client,
            "GET",
            "/rest/v1/organizations",
            params={"name": f"eq.{DEMO_ORGANIZATION}", "select": "id,name", "limit": 1},
        )
        if organizations:
            organization_id = organizations[0]["id"]
            request(
                client,
                "PATCH",
                "/rest/v1/organizations",
                params={"id": f"eq.{organization_id}"},
                json={"slug": DEMO_ORG_SLUG, "invite_code": DEMO_ORG_INVITE_CODE},
            )
        else:
            created = request(
                client,
                "POST",
                "/rest/v1/organizations",
                headers={"Prefer": "return=representation"},
                json={
                    "name": DEMO_ORGANIZATION,
                    "slug": DEMO_ORG_SLUG,
                    "invite_code": DEMO_ORG_INVITE_CODE,
                },
            )
            organization_id = created[0]["id"]

        for email, full_name, role in DEMO_USERS:
            existing = auth_users.get(email)
            if existing:
                user_id = existing["id"]
                request(
                    client,
                    "PUT",
                    f"/auth/v1/admin/users/{user_id}",
                    json={
                        "password": DEMO_PASSWORD,
                        "email_confirm": True,
                        "user_metadata": {"name": full_name, "demo_role": role},
                    },
                )
            else:
                created = request(
                    client,
                    "POST",
                    "/auth/v1/admin/users",
                    json={
                        "email": email,
                        "password": DEMO_PASSWORD,
                        "email_confirm": True,
                        "user_metadata": {"name": full_name, "demo_role": role},
                    },
                )
                user_id = created["id"]

            request(
                client,
                "POST",
                "/rest/v1/profiles",
                headers={"Prefer": "resolution=merge-duplicates,return=representation"},
                json={
                    "id": user_id,
                    "organization_id": organization_id,
                    "full_name": full_name,
                    "email": email,
                    "role": role,
                },
            )
            print(f"Configured {email} as {role}")

    print("Configured four demo users. The common demo password is DEMO_USER_PASSWORD or the documented demo default.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (httpx.HTTPError, RuntimeError, KeyError) as error:
        print(f"Demo seed failed: {error}", file=sys.stderr)
        raise SystemExit(1)
