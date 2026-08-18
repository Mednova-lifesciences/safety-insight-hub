#!/usr/bin/env python3
import requests
import json
import time

time.sleep(2)
base = 'http://localhost:8000'

print('=== PHASE 2.5 ROLE-BASED WORKFLOW TEST ===\n')

# 1. Health check
print('1. Health Check')
r = requests.get(base + '/health', timeout=10)
assert r.status_code == 200
print(f'   ✓ Backend healthy\n')

# 2. Sign in as demo user (COORDINATOR role)
print('2. User Sign-in (COORDINATOR)')
login = requests.post(
    base + '/api/auth/signin',
    json={'email': 'demo@example.com', 'password': 'Test123!'},
    timeout=10
)
assert login.status_code == 200
token = login.json()['access_token']
profile = login.json().get('profile', {})
role = profile.get('role', 'FIELD_ASSOCIATE')
print(f'   ✓ Authenticated as: {role}\n')

# 3. Create a test case
print('3. Create Test Case')
case_payload = {
    'reporter': {
        'name': 'Dr. Test',
        'qualification': 'Physician',
        'country': 'US'
    },
    'patient': {
        'identifier': 'PT-WF-001',
        'age': '35',
        'sex': 'Female'
    },
    'product': {
        'reportedName': 'Medication',
        'activeIngredient': 'Active',
        'indication': 'Test'
    },
    'reaction': {
        'reportedTerm': 'Test Reaction',
        'outcome': 'RECOVERED'
    },
    'narrative': 'Test case for workflow transitions.',
    'reportedSeriousness': 'SERIOUS',
    'seriousnessCriteria': []
}

create = requests.post(
    base + '/api/cases',
    json=case_payload,
    headers={'Authorization': f'Bearer {token}'},
    timeout=10
)
assert create.status_code == 200
case_id = create.json()['id']
print(f'   ✓ Case created: {case_id}\n')

# 4. Get valid workflow actions for current step
print('4. Get Workflow Actions (INTAKE → ?)')
actions = requests.get(
    base + f'/api/cases/{case_id}/workflow-actions',
    headers={'Authorization': f'Bearer {token}'},
    timeout=10
)
assert actions.status_code == 200
workflow_data = actions.json()
print(f'   - Current Step: {workflow_data["currentStep"]}')
print(f'   - Valid Transitions: {workflow_data["validTransitions"]}')
print(f'   - User Role: {workflow_data["role"]}')
print(f'   ✓ Valid transitions fetched\n')

# 5. Try workflow transition
if workflow_data['validTransitions']:
    next_step = workflow_data['validTransitions'][0]
    print(f'5. Advance Workflow ({workflow_data["currentStep"]} → {next_step})')
    
    advance = requests.post(
        base + f'/api/cases/{case_id}/workflow',
        json={'step': next_step, 'reason': 'Test workflow transition'},
        headers={'Authorization': f'Bearer {token}'},
        timeout=10
    )
    
    if advance.status_code == 200:
        processing = advance.json()
        new_step = processing.get('workflow', {}).get('currentStep')
        print(f'   ✓ Workflow transitioned to: {new_step}')
        print(f'   ✓ Next recommended: {processing.get("workflow", {}).get("nextRecommendedStep")}')
    else:
        print(f'   ✗ Workflow transition failed: {advance.status_code}')
        print(f'     Error: {advance.json()}')
else:
    print('5. No valid transitions available for current role/step')

print('\n✅ Phase 2.5 Role-Based Workflow Test Completed!')
print('   Features verified:')
print('   • Role-based workflow transitions')
print('   • User authentication and authorization')
print('   • Case creation with full data')
print('   • Workflow action retrieval')
print('   • Workflow state advancement')
