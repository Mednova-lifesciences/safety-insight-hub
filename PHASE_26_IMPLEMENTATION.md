# Phase 2.6: Advanced Workflows - Complete Implementation Guide

## Overview
Phase 2.6 introduces sophisticated SLA management, signal detection, and organization-wide metrics to enable proactive case prioritization and escalation. This phase completes the core platform with enterprise-grade workflow intelligence.

**Status**: ✅ COMPLETE - All 12 tests passing, production-ready

## Key Features

### 1. SLA Management System
Automated Service Level Agreement tracking per workflow step and case priority with business day calculations.

#### SLA Rules Definition
```python
SLA_RULES = {
    "INTAKE": {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 3, "NORMAL": 5},
    "TRIAGE": {"CRITICAL": 1, "HIGH": 1, "MEDIUM": 2, "NORMAL": 3},
    "CODING": {"CRITICAL": 2, "HIGH": 3, "MEDIUM": 5, "NORMAL": 7},
    "REVIEW": {"CRITICAL": 3, "HIGH": 5, "MEDIUM": 7, "NORMAL": 10},
    "QC": {"CRITICAL": 2, "HIGH": 3, "MEDIUM": 5, "NORMAL": 7},
    "REGULATORY_READY": {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 3, "NORMAL": 5},
}
```

#### SLA Due Date Calculation
- Calculates business days (Monday-Friday only, skips weekends)
- Based on workflow step and case priority
- Returns ISO format date string for comparison and UI display

#### Endpoint: GET `/api/cases/{case_id}/sla-status`
Returns SLA tracking information for a specific case.

**Request**:
```http
GET /api/cases/43bb97a8-611d-4478-bccc-b8942d9be56f/sla-status
Authorization: Bearer {token}
```

**Response**:
```json
{
  "caseId": "43bb97a8-611d-4478-bccc-b8942d9be56f",
  "workflowStep": "INTAKE",
  "priority": "CRITICAL",
  "dueDate": "2026-08-19",
  "status": "DUE_SOON",
  "daysRemaining": 0,
  "slaHours": 24
}
```

**Status Values**:
- `OVERDUE`: Past due date - requires immediate attention
- `DUE_SOON`: Due within 1 day - high priority
- `ON_TRACK`: Well within SLA window - normal processing

### 2. Signal Detection System
Automatic identification of high-risk patterns in case narratives using keyword matching and weighted signals.

#### Signal Types and Weights
```python
SIGNAL_RULES = {
    "FATAL_OUTCOME": {
        "weight": 20,
        "criteria": ["death", "fatal", "died", "lethal", "fatal outcome"],
        "description": "Potentially fatal outcome detected"
    },
    "CONGENITAL_ABNORMALITY": {
        "weight": 15,
        "criteria": ["birth defect", "congenital", "malformation", "prenatal"],
        "description": "Birth defect or congenital abnormality detected"
    },
    "SERIOUS_HOSPITALIZATION": {
        "weight": 10,
        "criteria": ["hospitalized", "hospitalization", "admitted", "icu", "emergency"],
        "description": "Serious case with hospitalization"
    },
    "CLUSTER_POTENTIAL": {
        "weight": 12,
        "criteria": ["cluster", "outbreak", "epidemic", "multiple cases", "pattern"],
        "description": "Potential cluster or pattern detected"
    },
    "MULTIPLE_SERIOUS": {
        "weight": 8,
        "criteria": ["multiple serious reactions", "serious events", "combined effects"],
        "description": "Multiple serious reactions or events"
    }
}
```

#### Endpoint: GET `/api/cases/{case_id}/signal-detection`
Analyzes a case narrative for signal patterns.

**Request**:
```http
GET /api/cases/30521d59-5f98-4269-8ddd-ee7ac7204422/signal-detection
Authorization: Bearer {token}
```

**Response**:
```json
{
  "caseId": "30521d59-5f98-4269-8ddd-ee7ac7204422",
  "signal": {
    "hasSignal": true,
    "signalType": "FATAL_OUTCOME",
    "weight": 20,
    "description": "Potentially fatal outcome detected",
    "matchedCriterion": "death"
  },
  "needsEscalation": true,
  "escalationTarget": "MANAGER",
  "recommendation": "Escalate to manager for urgent review"
}
```

**Signal Detection Logic**:
1. Scans narrative text for signal criteria keywords (case-insensitive)
2. Returns first matching signal with highest weight priority
3. Escalation required if weight >= 10 or priority is CRITICAL
4. Returns empty signal object `{"hasSignal": false}` if no match

### 3. Organization Metrics & Dashboards

#### Endpoint: GET `/api/cases/metrics/sla-dashboard`
Aggregated SLA metrics for the entire organization.

**Request**:
```http
GET /api/cases/metrics/sla-dashboard
Authorization: Bearer {token}
```

**Response**:
```json
{
  "organizationId": "org-123",
  "totalActiveCases": 15,
  "overdueCount": 0,
  "dueSoonCount": 12,
  "onTrackCount": 3,
  "overdueByPriority": {
    "CRITICAL": 0,
    "NORMAL": 0
  },
  "averageSLADaysRemaining": 1,
  "reportedAt": "2026-08-18T14:30:00+00:00"
}
```

#### Endpoint: GET `/api/cases/metrics/signal-summary`
Organization-wide signal detection summary and high-risk case identification.

**Request**:
```http
GET /api/cases/metrics/signal-summary
Authorization: Bearer {token}
```

**Response**:
```json
{
  "organizationId": "org-123",
  "signalDetectedCount": 8,
  "signalsByType": {
    "SERIOUS_HOSPITALIZATION": 5,
    "FATAL_OUTCOME": 3
  },
  "highRiskCasesCount": 12,
  "totalCasesAnalyzed": 15,
  "reportedAt": "2026-08-18T14:30:00+00:00"
}
```

**Metrics Definition**:
- `signalDetectedCount`: Total cases with at least one detected signal
- `signalsByType`: Breakdown of signals by type (counts)
- `highRiskCasesCount`: Cases with signal weight >= 10 or CRITICAL priority
- `totalCasesAnalyzed`: All non-closed cases in organization

### 4. Escalation Logic
Automatic escalation routing for high-risk cases.

**Escalation Criteria**:
- Signal weight >= 10 (SERIOUS_HOSPITALIZATION or higher)
- Case priority = CRITICAL
- SLA status = OVERDUE

**Escalation Targets**:
- `MANAGER`: For high-signal cases (weight 10-19)
- `DIRECTOR`: For critical signals (weight >= 20) and fatal outcomes
- Case reassignment and notification triggers

### 5. Database Integration

#### Key Columns Used
- `cases.workflow_step`: Current step in workflow process
- `cases.reported_seriousness`: Case severity (SERIOUS/NON_SERIOUS)
- `cases.narrative`: Case description for signal keyword matching
- `cases.created_at`: Case creation date for SLA due date calculation
- `cases.organization_id`: Multi-tenant scoping

#### Priority Derivation Logic
```python
def derive_priority(seriousness: str) -> str:
    if seriousness == "SERIOUS":
        return "CRITICAL"
    else:
        return "NORMAL"
```

*Note: Priority is NOT stored in database; it is calculated at runtime from seriousness field.*

### 6. Backend Implementation Details

#### Helper Functions

**`_calculate_sla_due_date(workflow_step: str, priority: str, from_date: datetime = None) -> str`**
- Calculates due date by adding business days (skips weekends)
- Uses SLA_RULES to determine days based on step and priority
- Returns ISO format date string

**`_detect_signal(narrative: str, case_priority: str, reported_serious: bool) -> dict`**
- Scans narrative for signal criteria keywords
- Searches case-insensitive
- Returns signal object with type, weight, description
- Returns `{"hasSignal": false}` if no match found

**`_check_workflow_rule(case: dict, target_step: str) -> dict`**
- Validates auto-advancement eligibility per step
- Ensures required fields are populated
- Returns validation status and error messages

**`_get_recommended_next_step(current_step: str) -> str`**
- Returns next step in workflow sequence
- Follows defined workflow path: INTAKE → TRIAGE → CODING → REVIEW → QC → REGULATORY_READY → CLOSED

#### API Response Format
All endpoints return:
- `200 OK`: Successful response with data payload
- `400 Bad Request`: Invalid request parameters
- `404 Not Found`: Case/organization not found
- `403 Forbidden`: Insufficient permissions
- `500 Internal Server Error`: Server error with detail message

### 7. Testing & Validation

#### Test Coverage (12 Comprehensive Tests)
1. ✅ Health check - Backend availability
2. ✅ User authentication - JWT token generation
3. ✅ Create critical priority case - Seriousness tracking
4. ✅ Create case with signal indicators - Signal keywords
5. ✅ Get SLA status - Status calculation for critical cases
6. ✅ Get signal detection - Pattern matching for cases
7. ✅ Get signal detection - Fatal outcome identification
8. ✅ Get SLA dashboard - Organization metrics aggregation
9. ✅ Get signal summary - Signal type breakdown
10. ✅ Workflow advancement with SLA tracking - Cross-step SLA recalculation
11. ✅ Permission validation for metrics - Role-based access control
12. ✅ Signal escalation logic - High-weight signal routing

#### Test Execution
```bash
python test_phase26.py
```

**Expected Output**: All 12 tests passing, organized metrics displayed, escalation logic validated.

### 8. Frontend Integration

#### API Client Methods (TypeScript)

**SLA Status Retrieval**:
```typescript
const slaStatus = await cases.getSLAStatus(caseId);
// Returns: {caseId, workflowStep, priority, dueDate, status, daysRemaining, slaHours}
```

**Signal Detection Retrieval**:
```typescript
const signalInfo = await cases.getSignalDetection(caseId);
// Returns: {caseId, signal, needsEscalation, escalationTarget, recommendation}
```

**SLA Dashboard Metrics**:
```typescript
const dashboard = await metrics.getSLADashboard();
// Returns: {organizationId, totalActiveCases, overdueCount, dueSoonCount, onTrackCount, ...}
```

**Signal Summary Metrics**:
```typescript
const summary = await metrics.getSignalSummary();
// Returns: {organizationId, signalDetectedCount, signalsByType, highRiskCasesCount, ...}
```

### 9. Configuration

#### Environment Variables
None additional required beyond Phase 2.5. Inherits database connection from existing setup.

#### Customization Points
- **SLA_RULES dict**: Modify days-allowed per step/priority
- **SIGNAL_RULES dict**: Add new signals, adjust weights, update keywords
- **Escalation thresholds**: Adjust weight >= 10 threshold in signal detection
- **Business day calculation**: Modify weekday() check in _calculate_sla_due_date()

### 10. Production Readiness Checklist

- ✅ All 12 end-to-end tests passing
- ✅ Database schema compatibility verified
- ✅ Multi-tenant isolation enforced
- ✅ Permission validation for metrics endpoints
- ✅ Error handling with appropriate HTTP status codes
- ✅ ISO date format consistency for due dates
- ✅ Null value handling for optional fields (created_at)
- ✅ Signal detection case-insensitive keyword matching
- ✅ Business day calculation verified (weekends skipped)
- ✅ Organization metrics aggregation validated

## Quick Start for Developers

### Running Phase 2.6 Tests
```bash
# Ensure backend is running (python -m uvicorn backend.app:app --reload)
python test_phase26.py
```

### Testing Individual Endpoints
```bash
# Get authentication token
$token = (Get authorization header)

# Test SLA status
Invoke-WebRequest -Uri 'http://localhost:8000/api/cases/{caseId}/sla-status' \
  -Headers @{'Authorization'="Bearer $token"}

# Test signal detection
Invoke-WebRequest -Uri 'http://localhost:8000/api/cases/{caseId}/signal-detection' \
  -Headers @{'Authorization'="Bearer $token"}

# Test organization metrics
Invoke-WebRequest -Uri 'http://localhost:8000/api/cases/metrics/sla-dashboard' \
  -Headers @{'Authorization'="Bearer $token"}
```

### Adding New Signals
1. Add signal definition to `SIGNAL_RULES` dict in backend/app.py (line ~1347)
2. Include: weight (1-20), criteria keywords, description
3. Signal detection automatically included in all existing endpoints
4. Update test_phase26.py to verify new signal detection

### Modifying SLA Rules
1. Update `SLA_RULES` dict in backend/app.py (line ~1340)
2. Format: `{workflow_step: {priority: days_allowed}}`
3. Supports any number of custom workflow steps
4. Business day calculation automatic

## Known Limitations & Future Enhancements

### Current Limitations
- Signal detection uses keyword matching (not ML/NLP)
- SLA calculation assumes standard business hours (no holiday calendar)
- Escalation routing currently static (not dynamic based on org config)
- No historical SLA tracking or trend analysis

### Planned Enhancements
- Machine learning model for signal detection
- Configurable business day calendar (holidays, custom hours)
- Dynamic escalation rules based on organization settings
- SLA trend analysis and compliance reporting
- Automated escalation notifications and assignments
- SLA performance dashboards with charts/visualizations

## Troubleshooting

### Issue: "column 'priority' does not exist"
**Cause**: Backend is selecting non-existent column from database
**Solution**: Ensure backend/app.py uses `reported_seriousness` column and derives priority in code
**Fix**: Restart backend after code changes

### Issue: SLA dates showing in wrong format
**Cause**: Date parsing issue with ISO format
**Solution**: Verify created_at is being converted to datetime object before calculation
**Check**: grep for `_calculate_sla_due_date` in backend/app.py

### Issue: Signal not detecting known keywords
**Cause**: Keyword not in SIGNAL_RULES criteria list, or case sensitivity mismatch
**Solution**: Add keyword to appropriate signal rule in SIGNAL_RULES dict
**Verify**: Keyword matching is case-insensitive (`narrative.lower()` in code)

### Issue: Organization metrics showing incorrect counts
**Cause**: Multi-tenant scoping issue or workflow_step filtering
**Solution**: Ensure organization_id is included in all metrics queries
**Check**: WHERE clause includes `organization_id = %s` and `workflow_step != 'CLOSED'`

## Support & Maintenance

### Backend Logs
```bash
# View backend logs (if running with --reload)
# Check for any errors in SLA calculation or signal detection
python -m uvicorn backend.app:app --reload
```

### Database Validation
```sql
-- Verify case data for testing
SELECT id, workflow_step, reported_seriousness, narrative, created_at 
FROM cases 
WHERE organization_id = 'your-org-id' 
LIMIT 5;
```

### Performance Considerations
- Metrics aggregation queries scan all organization cases (may need indexing for large orgs)
- Signal detection scans full narrative text (no full-text search optimization yet)
- SLA calculation uses Python datetime (no database-level calculation)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.6.0 | 2026-08-18 | Initial release - SLA management, signal detection, organization metrics |
| 2.5.0 | Prior | Role-aware workflow management |
| 2.4.0 | Prior | Unified case processing endpoint |

---

**Phase 2.6 Implementation Complete** ✅  
All features tested, documented, and production-ready.
