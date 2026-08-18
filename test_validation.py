#!/usr/bin/env python3
import requests
import json
import time

time.sleep(2)
base = 'http://localhost:8000'

print('=== HEALTH ===')
r = requests.get(base + '/health', timeout=10)
print(f'Status: {r.status_code}')
print(r.json())

print('\n=== SIGNIN ===')
login = requests.post(
    base + '/api/auth/signin',
    json={'email': 'demo@example.com', 'password': 'Test123!'},
    timeout=10
)
print(f'Status: {login.status_code}')
token = login.json()['access_token']
print(f'Token: {token[:30]}...')

print('\n=== CREATE CASE ===')
create = requests.post(
    base + '/api/cases',
    json={
        'reporter': {'name': 'Dr. Demo', 'qualification': 'Physician', 'country': 'US'},
        'patient': {'identifier': 'PAT-UNIFIED-2', 'age': '29', 'sex': 'F'},
        'product': {'name': 'Ibuprofen', 'indication': 'Pain'},
        'reaction': {'term': 'Nausea'},
        'narrative': 'Patient developed nausea after taking ibuprofen.',
        'reportedSeriousness': 'SERIOUS',
        'seriousnessCriteria': ['Hospitalization'],
    },
    headers={'Authorization': f'Bearer {token}'},
    timeout=10
)
print(f'Status: {create.status_code}')
case_data = create.json()
print(f'Response: {json.dumps(case_data, indent=2)}')
case_id = case_data.get('id')

print(f'\n=== PROCESSING ENDPOINT (NEW) ===')
proc = requests.get(
    base + f'/api/cases/{case_id}/processing',
    headers={'Authorization': f'Bearer {token}'},
    timeout=10
)
print(f'Status: {proc.status_code}')
if proc.status_code == 200:
    data = proc.json()
    print(f'Keys: {list(data.keys())}')
    case_payload = data.get('case', {})
    print(f'Case ID: {case_payload.get("id")}')
    print(f'Seriousness: {data.get("seriousness")}')
    print(f'Workflow: {data.get("workflow")}')
    print(f'Triage: {data.get("triage")}')
    print('\nFULL PAYLOAD:')
    print(json.dumps(data, indent=2, default=str))
else:
    print(f'Error: {proc.text}')
