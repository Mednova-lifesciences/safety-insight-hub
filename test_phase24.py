#!/usr/bin/env python3
import requests
import json
import time

time.sleep(2)
base = 'http://localhost:8000'

print('=== PHASE 2.4 UNIFIED PROCESSING ENDPOINT TEST ===\n')

# 1. Health check
print('1. Health Check')
r = requests.get(base + '/health', timeout=10)
assert r.status_code == 200
print(f'   ✓ Backend healthy: {r.json()}\n')

# 2. Sign in
print('2. User Sign-in')
login = requests.post(
    base + '/api/auth/signin',
    json={'email': 'demo@example.com', 'password': 'Test123!'},
    timeout=10
)
assert login.status_code == 200
token = login.json()['access_token']
print(f'   ✓ Authenticated token obtained\n')

# 3. Create case with complete data
print('3. Create Case with Full Data')
case_payload = {
    'reporter': {
        'name': 'Dr. Jane Smith',
        'qualification': 'Physician',
        'country': 'US',
        'contact': 'jane@example.com',
        'consentToContact': True
    },
    'patient': {
        'identifier': 'PT-2026-00815',
        'age': '45',
        'sex': 'Female',
        'weightKg': '72',
        'medicalHistory': 'Type 2 diabetes'
    },
    'product': {
        'reportedName': 'Aspirin',
        'activeIngredient': 'Acetylsalicylic acid',
        'dose': '500mg',
        'route': 'Oral',
        'indication': 'Pain management',
        'therapyStart': '2026-08-10',
        'action': 'Continued'
    },
    'reaction': {
        'reportedTerm': 'Severe gastrointestinal bleeding',
        'onsetDate': '2026-08-15',
        'outcome': 'RECOVERED_WITH_SEQUELAE'
    },
    'narrative': 'Patient developed severe gastrointestinal bleeding after taking Aspirin for pain management. Required hospitalization for transfusion.',
    'reportedSeriousness': 'SERIOUS',
    'seriousnessCriteria': ['Hospitalization', 'Life threatening']
}

create = requests.post(
    base + '/api/cases',
    json=case_payload,
    headers={'Authorization': f'Bearer {token}'},
    timeout=10
)
assert create.status_code == 200, f"Create failed: {create.text}"
case_data = create.json()
case_id = case_data['id']
print(f'   ✓ Case created: {case_data["caseNumber"]}\n')

# 4. Fetch unified processing payload
print('4. Fetch Unified Processing Payload')
proc = requests.get(
    base + f'/api/cases/{case_id}/processing',
    headers={'Authorization': f'Bearer {token}'},
    timeout=10
)
assert proc.status_code == 200, f"Processing fetch failed: {proc.text}"
processing_data = proc.json()
print(f'   ✓ Processing payload retrieved\n')

# 5. Validate payload structure
print('5. Validate Payload Structure')
required_keys = ['case', 'seriousness', 'coding', 'consistency', 'triage', 'workflow']
for key in required_keys:
    assert key in processing_data, f"Missing key: {key}"
    print(f'   ✓ {key}: present')

print('\n6. Payload Content Summary')
case_detail = processing_data.get('case', {})
print(f'   - Case ID: {case_detail.get("id")}')
print(f'   - Case Number: {case_detail.get("caseNumber")}')
print(f'   - Patient: {case_detail.get("patientIdentifier")}')
print(f'   - Seriousness: {case_detail.get("seriousness")}')
print(f'   - Workflow Step: {case_detail.get("workflowStep")}')

consistency = processing_data.get('consistency', [])
print(f'\n   - Consistency Checks: {len(consistency)} issues found')
for check in consistency[:3]:
    print(f'     • {check["severity"]}: {check["message"]}')

triage = processing_data.get('triage', {})
print(f'\n   - Triage Score: {triage.get("triageScore")}/100')
print(f'   - Priority: {triage.get("priority")}')
print(f'   - Recommended Next Step: {triage.get("recommendedNextStep")}')

workflow = processing_data.get('workflow', {})
print(f'\n   - Current Workflow Step: {workflow.get("currentStep")}')
print(f'   - Next Recommended: {workflow.get("nextRecommendedStep")}')

print('\n✅ Phase 2.4 Unified Case Processing Implementation Verified!')
print('   • Backend endpoint: /api/cases/{case_id}/processing')
print('   • Response payload: aggregated case, seriousness, coding, consistency, triage, workflow')
print('   • Frontend integration ready for role-based case detail page')
