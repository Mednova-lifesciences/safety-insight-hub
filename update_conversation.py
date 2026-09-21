#!/usr/bin/env python3
"""Update seeded conversation with detail fields (messages, extracted, missing)."""
import asyncio
import sys
sys.path.insert(0, '/Users/DELL/safety-insight-hub')

from src.server.database import get_supabase_client

async def update_conversation():
    client = get_supabase_client()
    
    # Enhanced conversation with messages, extracted, and missing fields
    updated_data = {
        "id": "demo-conv-001",
        "channel": "WHATSAPP",
        "reporterName": "Amina Bello",
        "reporterNumberMasked": "+234 80... 4821",
        "lastMessage": "I developed a rash after starting Paracetamol yesterday.",
        "lastMessageAt": "2026-08-19T02:30:00Z",
        "consent": "GRANTED",
        "criteria": {
            "reporter": True,
            "patient": True,
            "product": True,
            "event": True
        },
        "status": "NEW",
        "linkedCaseId": None,
        # Detail fields added
        "messages": [
            {
                "id": "m1",
                "direction": "INBOUND",
                "at": "2026-08-19T02:15:00Z",
                "body": "Hello, I'm writing to report an adverse event."
            },
            {
                "id": "m2",
                "direction": "OUTBOUND",
                "at": "2026-08-19T02:17:00Z",
                "body": "Thank you for reaching out. Do you consent to us contacting you for follow-up?"
            },
            {
                "id": "m3",
                "direction": "INBOUND",
                "at": "2026-08-19T02:20:00Z",
                "body": "Yes, I consent."
            },
            {
                "id": "m4",
                "direction": "INBOUND",
                "at": "2026-08-19T02:25:00Z",
                "body": "I developed a rash after starting Paracetamol yesterday."
            }
        ],
        "extracted": [
            {"field": "Reporter", "value": "Amina Bello", "sourceMessageId": "m1"},
            {"field": "Consent", "value": "Granted", "sourceMessageId": "m3"},
            {"field": "Patient", "value": "Female, age unknown", "sourceMessageId": "m4"},
            {"field": "Suspect product", "value": "Paracetamol", "sourceMessageId": "m4"},
            {"field": "Adverse event", "value": "Rash", "sourceMessageId": "m4"},
            {"field": "Onset date", "value": None},
            {"field": "Patient weight", "value": None}
        ],
        "missing": ["Onset date", "Patient weight", "Patient age", "Outcome"]
    }
    
    # Update the record
    result = await client.query(
        "pv_intake_conversations",
        filters={"id": "demo-conv-001"},
        data={"data": updated_data},
        is_update=True
    )
    print("Update result:", result)

asyncio.run(update_conversation())
