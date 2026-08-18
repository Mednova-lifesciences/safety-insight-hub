#!/usr/bin/env python3
"""Test PV-Sentinel API endpoints."""

import requests
import json

BASE_URL = "http://localhost:8000"

def test_signup():
    """Test signup endpoint."""
    print("=== SIGNUP TEST ===")
    resp = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={
            "email": "testuser@example.com",
            "password": "Test123!",
            "name": "Test User"
        }
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print(f"✓ User: {data['user']['email']}")
        print(f"✓ Org: {data['organization']['name']}")
        print(f"✓ Token: {data['access_token'][:50]}...")
        return data['access_token'], data['organization']['id']
    else:
        print(f"✗ Error: {resp.text}")
        return None, None

def test_signin():
    """Test signin endpoint."""
    print("\n=== SIGNIN TEST ===")
    resp = requests.post(
        f"{BASE_URL}/api/auth/signin",
        json={
            "email": "demo@example.com",
            "password": "Test123!"
        }
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print(f"✓ User: {data['user']['email']}")
        print(f"✓ Token: {data['access_token'][:50]}...")
        return data['access_token']
    else:
        print(f"✗ Error: {resp.text}")
        return None

def test_health():
    """Test health endpoint."""
    print("\n=== HEALTH CHECK ===")
    resp = requests.get(f"{BASE_URL}/health")
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(f"Status: {data['status']}")
    print(f"Database: {data['database']}")

def test_create_case(token, org_id):
    """Test case creation."""
    print("\n=== CREATE CASE TEST ===")
    case_data = {
        "reporter": {
            "name": "Dr. John Doe",
            "qualification": "Physician",
            "country": "US"
        },
        "patient": {
            "identifier": "PAT-001",
            "age": "45",
            "sex": "M"
        },
        "product": {
            "name": "Aspirin",
            "indication": "Headache"
        },
        "reaction": {
            "term": "Rash"
        },
        "narrative": "Patient developed rash after taking Aspirin",
        "reportedSeriousness": "NON_SERIOUS"
    }
    
    resp = requests.post(
        f"{BASE_URL}/api/cases",
        json=case_data,
        headers={"Authorization": f"Bearer {token}"}
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code in [200, 201]:
        data = resp.json()
        print(f"✓ Case ID: {data.get('case_id')}")
        print(f"✓ Case UUID: {data.get('id')}")
        return data.get('id')
    else:
        print(f"✗ Error: {resp.text}")
        return None


def test_unified_case_processing_endpoint(token):
    """Phase 2.4 regression: unified case processing data should be available."""
    case_data = {
        "reporter": {"name": "Dr. Jane Doe", "qualification": "Physician", "country": "US"},
        "patient": {"identifier": "PAT-200", "age": "32", "sex": "F"},
        "product": {"name": "Ibuprofen", "indication": "Pain"},
        "reaction": {"term": "Nausea"},
        "narrative": "Patient developed nausea following ibuprofen intake and required follow-up.",
        "reportedSeriousness": "SERIOUS",
        "seriousnessCriteria": ["Hospitalization", "Life threatening"],
    }
    create_resp = requests.post(
        f"{BASE_URL}/api/cases",
        json=case_data,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    case_id = create_resp.json()["id"]

    processing_resp = requests.get(
        f"{BASE_URL}/api/cases/{case_id}/processing",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert processing_resp.status_code == 200, processing_resp.text
    body = processing_resp.json()
    assert body["case"]["id"] == case_id
    assert "seriousness" in body
    assert "workflow" in body


if __name__ == "__main__":
    print("🧪 PV-Sentinel API Test Suite\n")
    
    # Test health
    test_health()
    
    # Test signin
    token = test_signin()
    
    # Test signup (new user)
    new_token, org_id = test_signup()
    
    # Test case creation
    if token:
        case_id = test_create_case(token, "aa71143a-754e-4f72-aa36-1b91ccbca5e0")
    
    print("\n✓ All tests completed!")
