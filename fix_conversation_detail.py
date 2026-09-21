import requests
import json

# Supabase credentials
SUPABASE_URL = 'https://ioxwfubcexnplusdhuab.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlveHdmdWJjZXhucGx1c2RodWFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjQwODc1NzgsImV4cCI6MTczOTY0NzU3OH0.YJYvIxIQWLW7LXBptqpXc9LZz4v64xVqhXLwNvCxdxw'

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
