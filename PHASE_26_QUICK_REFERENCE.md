# Phase 2.6: Advanced Workflows - Quick Reference

## 🚀 Quick Start

### Installation & Setup
```bash
# Backend already includes Phase 2.6 endpoints
# No additional installation required
cd safety-insight-hub
python -m uvicorn backend.app:app --reload
```

### Running Tests
```bash
# Run full Phase 2.6 test suite
python test_phase26.py

# Expected: 12/12 tests passing ✅
```

---

## 📊 SLA Management

### Check SLA Status for a Case
```python
import requests

token = "your-jwt-token"
case_id = "43bb97a8-611d-4478-bccc-b8942d9be56f"

response = requests.get(
    f"http://localhost:8000/api/cases/{case_id}/sla-status",
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()
# {
#   "caseId": "...",
#   "workflowStep": "INTAKE",
#   "priority": "CRITICAL",
#   "dueDate": "2026-08-19",
#   "status": "DUE_SOON",
#   "daysRemaining": 0,
#   "slaHours": 24
# }
```

### SLA Rules at a Glance
| Workflow Step | CRITICAL | HIGH | MEDIUM | NORMAL |
|---|---|---|---|---|
| INTAKE | 1 day | 2 days | 3 days | 5 days |
| TRIAGE | 1 day | 1 day | 2 days | 3 days |
| CODING | 2 days | 3 days | 5 days | 7 days |
| REVIEW | 3 days | 5 days | 7 days | 10 days |
| QC | 2 days | 3 days | 5 days | 7 days |
| REGULATORY_READY | 1 day | 2 days | 3 days | 5 days |

*Note: Days are business days (Mon-Fri only, no weekends)*

### SLA Status Values
- **OVERDUE**: ⚠️ Past due - immediate action required
- **DUE_SOON**: 🟡 Due within 1 day - high priority
- **ON_TRACK**: ✅ Well within SLA - normal processing

### Priority Derivation
```
Case Seriousness: SERIOUS  → Priority: CRITICAL
Case Seriousness: NON_SERIOUS  → Priority: NORMAL
```

---

## 🔍 Signal Detection

### Check for Signals in a Case
```python
response = requests.get(
    f"http://localhost:8000/api/cases/{case_id}/signal-detection",
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()
# {
#   "caseId": "...",
#   "signal": {
#     "hasSignal": true,
#     "signalType": "FATAL_OUTCOME",
#     "weight": 20,
#     "description": "Potentially fatal outcome detected",
#     "matchedCriterion": "death"
#   },
#   "needsEscalation": true,
#   "escalationTarget": "MANAGER",
#   "recommendation": "Escalate to manager for urgent review"
# }
```

### Signal Types & Keywords
| Signal Type | Weight | Example Keywords |
|---|---|---|
| FATAL_OUTCOME | 20 | death, fatal, died, lethal |
| CONGENITAL_ABNORMALITY | 15 | birth defect, congenital, malformation |
| SERIOUS_HOSPITALIZATION | 10 | hospitalized, admitted, ICU, emergency |
| CLUSTER_POTENTIAL | 12 | cluster, outbreak, epidemic, pattern |
| MULTIPLE_SERIOUS | 8 | multiple serious reactions, combined effects |

### Escalation Rules
- **Weight >= 10**: Escalate to MANAGER
- **Weight >= 20**: Escalate to DIRECTOR
- **CRITICAL priority**: Auto-escalate

---

## 📈 Organization Metrics

### Get SLA Dashboard
```python
response = requests.get(
    "http://localhost:8000/api/cases/metrics/sla-dashboard",
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()
# {
#   "organizationId": "org-123",
#   "totalActiveCases": 15,
#   "overdueCount": 0,
#   "dueSoonCount": 12,
#   "onTrackCount": 3,
#   "overdueByPriority": {"CRITICAL": 0, "NORMAL": 0},
#   "averageSLADaysRemaining": 1,
#   "reportedAt": "2026-08-18T14:30:00+00:00"
# }
```

### Get Signal Summary
```python
response = requests.get(
    "http://localhost:8000/api/cases/metrics/signal-summary",
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()
# {
#   "organizationId": "org-123",
#   "signalDetectedCount": 8,
#   "signalsByType": {
#     "SERIOUS_HOSPITALIZATION": 5,
#     "FATAL_OUTCOME": 3
#   },
#   "highRiskCasesCount": 12,
#   "totalCasesAnalyzed": 15,
#   "reportedAt": "2026-08-18T14:30:00+00:00"
# }
```

---

## 🎯 Common Tasks

### Find All OVERDUE Cases
```bash
# Get dashboard metrics
GET /api/cases/metrics/sla-dashboard

# Check "overdueCount" field
# If > 0, query individual cases and check status == "OVERDUE"
```

### Find High-Risk Cases (Signals Detected)
```bash
# Get signal summary
GET /api/cases/metrics/signal-summary

# Check "highRiskCasesCount"
# Individual case signals: GET /api/cases/{id}/signal-detection
```

### Create Critical Priority Case
```python
# Create case with seriousness = "SERIOUS"
# System automatically derives priority = "CRITICAL"
# SLA due date calculated as 1 business day from creation

post_data = {
    "caseNumber": "CASE-12345",
    "reportedSeriousness": "SERIOUS",
    "narrative": "Patient hospitalized with serious reaction",
    ...
}
```

### Track SLA Through Workflow
```python
# As case moves through workflow, SLA recalculates for each step

# Step 1: INTAKE (1 day for CRITICAL)
# Step 2: TRIAGE (1 day for CRITICAL)
# Step 3: CODING (2 days for CRITICAL)
# ... and so on

# Check GET /api/cases/{id}/sla-status after each workflow transition
```

---

## 🔐 Permission Requirements

### Metrics Access
- **GET /api/cases/metrics/sla-dashboard**: 
  - Required role: ADMIN, MANAGER, COORDINATOR
  - Returns: Entire organization metrics

- **GET /api/cases/metrics/signal-summary**: 
  - Required role: ADMIN, MANAGER, COORDINATOR
  - Returns: Entire organization metrics

### Case-Level Access
- **GET /api/cases/{id}/sla-status**: 
  - Required: Case belongs to user's organization
  - Returns: Case-specific SLA information

- **GET /api/cases/{id}/signal-detection**: 
  - Required: Case belongs to user's organization
  - Returns: Case-specific signal analysis

---

## 🛠️ Configuration

### Modify SLA Rules
Edit `backend/app.py`, find `SLA_RULES` dict (~line 1340):
```python
SLA_RULES = {
    "INTAKE": {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 3, "NORMAL": 5},
    # Modify days-allowed per step and priority
    # Changes auto-apply to all new due date calculations
}
```

### Add New Signal Type
Edit `backend/app.py`, find `SIGNAL_RULES` dict (~line 1347):
```python
SIGNAL_RULES = {
    "MY_NEW_SIGNAL": {
        "weight": 15,  # 1-20 scale
        "criteria": ["keyword1", "keyword2", "phrase"],
        "description": "Description of what this signal means"
    },
    # Signal automatically included in all detection endpoints
}
```

### Change Escalation Threshold
In `backend/app.py`, search for `needsEscalation`:
```python
needsEscalation = signal.get("weight", 0) >= 10 or priority == "CRITICAL"
# Change "10" to different threshold if needed
```

---

## 📋 API Endpoints Summary

| Endpoint | Method | Purpose | Response |
|---|---|---|---|
| `/api/cases/{id}/sla-status` | GET | Get case SLA status | SLA details, due date, status |
| `/api/cases/{id}/signal-detection` | GET | Detect signals in case | Signal type, weight, escalation info |
| `/api/cases/metrics/sla-dashboard` | GET | Organization SLA metrics | Active cases, overdue/due-soon counts |
| `/api/cases/metrics/signal-summary` | GET | Organization signal summary | Signal counts by type, high-risk count |

---

## 🐛 Troubleshooting

### Endpoint Returns 404
**Check**: Case exists and belongs to your organization
```python
# Verify case with
GET /api/cases/{id}  # Should return case details
```

### SLA Status Shows Wrong Priority
**Check**: Case seriousness field is "SERIOUS" or "NON_SERIOUS"
```python
# Verify with
GET /api/cases/{id}/processing  # Check "seriousness" field
```

### Signal Not Detected
**Check**: Narrative contains signal keywords (case-insensitive)
```python
# Signal keywords are:
# "death", "fatal", "hospitalized", "cluster", "multiple serious", etc.
# Add narrative with these keywords and re-test
```

### Metrics Show 0 Cases
**Check**: Are there non-closed cases in your organization?
```sql
SELECT COUNT(*) FROM cases 
WHERE organization_id = 'your-org' AND workflow_step != 'CLOSED'
```

---

## 📞 Support

### Running Tests
```bash
python test_phase26.py
# Should show: ✅ All tests passed!
```

### Checking Backend Status
```bash
curl http://localhost:8000/health
# Should return: {"status": "healthy"}
```

### Database Connection
```python
# Backend logs will show any database connection errors
# Ensure PostgreSQL is running and credentials are correct
```

---

## 📖 Full Documentation
See [PHASE_26_IMPLEMENTATION.md](PHASE_26_IMPLEMENTATION.md) for complete feature details, database schema, and developer guide.

---

**Last Updated**: 2026-08-18  
**Status**: ✅ Production Ready
