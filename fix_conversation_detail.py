import requests
import json

# Supabase credentials come from the environment, like everything else that
# talks to the project. Nothing is hardcoded here: the key that used to be
# was the anon/publishable one (public by design, gated by RLS) and had
# expired, but a script that hardcodes a credential invites the next one to
# hardcode a real one.
import os

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_ANON_KEY"]

# Enhanced conversation data with detail fields
updated_data = {
    'id': 'demo-conv-001',
    'channel': 'WHATSAPP',
    'reporterName': 'Amina Bello',
    'reporterNumberMasked': '+234 80... 4821',
    'lastMessage': 'I developed a rash after starting Paracetamol yesterday.',
    'lastMessageAt': '2026-08-19T02:30:00Z',
    'consent': 'GRANTED',
    'criteria': {
        'reporter': True,
        'patient': True,
        'product': True,
        'event': True
    },
    'status': 'NEW',
    'linkedCaseId': None,
    'messages': [
        {
            'id': 'm1',
            'direction': 'INBOUND',
            'at': '2026-08-19T02:15:00Z',
            'body': 'Hello, I am writing to report an adverse event.'
        },
        {
            'id': 'm2',
            'direction': 'OUTBOUND',
            'at': '2026-08-19T02:17:00Z',
            'body': 'Thank you for reaching out. Do you consent to us contacting you for follow-up?'
        },
        {
            'id': 'm3',
            'direction': 'INBOUND',
            'at': '2026-08-19T02:20:00Z',
            'body': 'Yes, I consent.'
        },
        {
            'id': 'm4',
            'direction': 'INBOUND',
            'at': '2026-08-19T02:25:00Z',
            'body': 'I developed a rash after starting Paracetamol yesterday.'
        }
    ],
    'extracted': [
        {'field': 'Reporter', 'value': 'Amina Bello', 'sourceMessageId': 'm1'},
        {'field': 'Consent', 'value': 'Granted', 'sourceMessageId': 'm3'},
        {'field': 'Patient', 'value': 'Female, age unknown', 'sourceMessageId': 'm4'},
        {'field': 'Suspect product', 'value': 'Paracetamol', 'sourceMessageId': 'm4'},
        {'field': 'Adverse event', 'value': 'Rash', 'sourceMessageId': 'm4'},
        {'field': 'Onset date', 'value': None},
        {'field': 'Patient weight', 'value': None}
    ],
    'missing': ['Onset date', 'Patient weight', 'Patient age', 'Outcome']
}

# Update via Supabase REST API
resp = requests.patch(
    f'{SUPABASE_URL}/rest/v1/pv_intake_conversations?id=eq.demo-conv-001',
    json={'data': updated_data},
    headers={
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    },
    timeout=10
)
print('Status:', resp.status_code)
if resp.status_code in [200, 201]:
    print('SUCCESS: Updated conversation')
    result = resp.json()
    if result and len(result) > 0:
        data = result[0].get('data', {})
        print('Has messages:', 'messages' in data)
        print('Messages count:', len(data.get('messages', [])))
else:
    print('Error:', resp.text[:500])
