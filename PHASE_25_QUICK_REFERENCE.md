# Phase 2.5 Quick Reference - Role-Based Workflows

## What is Phase 2.5?

Phase 2.5 implements **role-based workflow management** - a system that controls which case workflow states different user roles can move cases to. It ensures proper governance and tracks every change.

**Example**: A FIELD_ASSOCIATE can only move a case from INTAKE to TRIAGE. A MANAGER can move it through multiple stages. An ADMIN can move it anywhere.

---

## Quick Start

### For Testing

1. Start backend: `python -m uvicorn backend.app:app --reload`
2. Run tests: `python test_phase25.py`
3. Expected output: All tests pass, workflow transitions work

### For Frontend Development

1. Use `useAuth()` hook to get current user role
2. Use `usePermission("permission.name")` to check if user can do something
3. Call `cases.getWorkflowActions(caseId)` to get valid transitions
4. Call `cases.advanceWorkflow(caseId, nextStep, reason)` to move case

---

## Understanding the 7 Workflow States

| State                | Typical Owner                | Main Tasks                                                   | Next Step        |
| -------------------- | ---------------------------- | ------------------------------------------------------------ | ---------------- |
| **INTAKE**           | FIELD_ASSOCIATE, COORDINATOR | Verify data quality, validate reporter/patient info          | TRIAGE           |
| **TRIAGE**           | COORDINATOR, MANAGER         | Assess seriousness, determine priority (0-100)               | CODING           |
| **CODING**           | COORDINATOR, MANAGER         | Code products (drugs) and reactions in dictionaries          | REVIEW           |
| **REVIEW**           | MANAGER                      | Full case review, confirm seriousness, assess safety signals | QC               |
| **QC**               | MANAGER                      | Final quality control, ensure compliance, sign-off           | REGULATORY_READY |
| **REGULATORY_READY** | ADMIN                        | Prepare for regulatory submission                            | CLOSED           |
| **CLOSED**           | ADMIN                        | Final state, no transitions possible                         | (none)           |

---

## Role Permissions

### ADMIN

Can move cases: **everywhere** (unlimited transitions)

- INTAKE → TRIAGE, CLOSED (forward or exit)
- TRIAGE → CODING, INTAKE, CLOSED (advance, back up, or exit)
- CODING → REVIEW, TRIAGE, CLOSED
- REVIEW → QC, CODING, CLOSED
- QC → REGULATORY_READY, REVIEW, CLOSED
- REGULATORY_READY → CLOSED
- CLOSED → (no transitions)

### MANAGER

Can move cases: **through normal workflow only** (forward only)

- INTAKE → TRIAGE
- TRIAGE → CODING, INTAKE
- CODING → REVIEW
- REVIEW → QC
- QC → REGULATORY_READY
- REGULATORY_READY → (cannot close)

### COORDINATOR

Can move cases: **through intake and coding phases**

- INTAKE → TRIAGE
- TRIAGE → CODING
- CODING → REVIEW
- REVIEW → (cannot advance)
- Cannot access QC or REGULATORY_READY

### FIELD_ASSOCIATE

Can move cases: **only initial triage**

- INTAKE → TRIAGE (only)
- All other states locked

---

## Backend Implementation Details

### Get Valid Transitions

```python
# User calls this to find out what they can do with a case
GET /api/cases/{case_id}/workflow-actions

# Response example (if ADMIN on INTAKE case):
{
  "caseId": "abc-123",
  "currentStep": "INTAKE",
  "validTransitions": ["TRIAGE", "CLOSED"],
  "canAdvanceWorkflow": true,
  "role": "ADMIN"
}

# Response example (if FIELD_ASSOCIATE on CODING case):
{
  "caseId": "abc-123",
  "currentStep": "CODING",
  "validTransitions": [],  // Cannot advance
  "canAdvanceWorkflow": false,
  "role": "FIELD_ASSOCIATE"
}
```

### Move Case to Next State

```python
# User calls this to actually move the case
POST /api/cases/{case_id}/workflow
Body: {
  "step": "TRIAGE",
  "reason": "Quality checks passed, case ready for triage assessment"
}

# Response: Updated case data with new workflow_step

# If unauthorized, returns 403 Forbidden:
{
  "detail": "Role FIELD_ASSOCIATE cannot advance from CODING to REVIEW"
}
```

### Audit Trail

Every workflow transition creates an audit record:

```json
{
  "id": "audit-456",
  "action": "WORKFLOW_ADVANCED",
  "caseId": "abc-123",
  "userId": "user-789",
  "timestamp": "2026-08-18T14:32:00Z",
  "fromState": "INTAKE",
  "toState": "TRIAGE",
  "reason": "Quality checks passed, case ready for triage assessment"
}
```

---

## Frontend Implementation

### Hook: Check User Permissions

```typescript
import { usePermission } from "@/lib/auth";

function MyCaseComponent() {
  const canCode = usePermission("coding.review");

  if (!canCode) {
    return <p>You don't have permission to code reactions.</p>;
  }

  return <CodingWorkspace caseId="abc-123" />;
}
```

### Hook: Get Current User

```typescript
import { useAuth } from "@/lib/auth";

function MyComponent() {
  const { user } = useAuth();

  console.log(user.role); // "ADMIN", "MANAGER", "COORDINATOR", "FIELD_ASSOCIATE"
  console.log(user.email); // "user@example.com"
}
```

### API: Get Valid Transitions

```typescript
import { cases } from "@/services/api/cases";

async function getNextSteps(caseId: string) {
  const actions = await cases.getWorkflowActions(caseId);
  console.log(actions.validTransitions); // ["TRIAGE", "CLOSED"]
  console.log(actions.canAdvanceWorkflow); // true
}
```

### API: Move Case Forward

```typescript
import { cases } from "@/services/api/cases";

async function moveCase(caseId: string, nextStep: string) {
  try {
    const updatedCase = await cases.advanceWorkflow(
      caseId,
      nextStep,
      "Completed triage assessment, ready for coding",
    );
    console.log("Case moved to:", updatedCase.workflowStep);
  } catch (error) {
    console.error("Cannot move case:", error.message);
  }
}
```

### UI: Show Available Actions

```typescript
function CaseActions({ caseId }: { caseId: string }) {
  const { data: actions } = useQuery({
    queryKey: ["workflow", caseId],
    queryFn: () => cases.getWorkflowActions(caseId),
  });

  if (!actions || !actions.canAdvanceWorkflow) {
    return <p>No workflow actions available for your role.</p>;
  }

  return (
    <div>
      {actions.validTransitions.map((step) => (
        <Button
          key={step}
          onClick={() => moveCase(caseId, step)}
        >
          Move to {WORKFLOW_LABELS[step]}
        </Button>
      ))}
    </div>
  );
}
```

---

## Testing Workflow Transitions

### Test Case 1: ADMIN Full Control

```bash
# Create case (auto-starts as INTAKE)
POST /api/cases
Body: { ...caseData }
Response: { "caseId": "abc-123", "workflowStep": "INTAKE" }

# Get actions
GET /api/cases/abc-123/workflow-actions
Response: { "validTransitions": ["TRIAGE", "CLOSED"], "role": "ADMIN" }

# Move to TRIAGE
POST /api/cases/abc-123/workflow
Body: { "step": "TRIAGE", "reason": "..." }
Response: { ...case, "workflowStep": "TRIAGE" }

# Move back (only ADMIN can do this)
POST /api/cases/abc-123/workflow
Body: { "step": "INTAKE", "reason": "Need more info" }
Response: { ...case, "workflowStep": "INTAKE" }
```

### Test Case 2: COORDINATOR Limited Scope

```bash
# Get actions on CODING case (COORDINATOR)
GET /api/cases/xyz-789/workflow-actions
Response: {
  "validTransitions": ["REVIEW"],
  "role": "COORDINATOR"
}

# Try to move back to TRIAGE (will fail)
POST /api/cases/xyz-789/workflow
Body: { "step": "TRIAGE", "reason": "..." }
Response: 403 Forbidden - "Cannot move backward"
```

### Test Case 3: FIELD_ASSOCIATE Only Initial Triage

```bash
# Get actions on INTAKE case (FIELD_ASSOCIATE)
GET /api/cases/def-456/workflow-actions
Response: {
  "validTransitions": ["TRIAGE"],
  "role": "FIELD_ASSOCIATE"
}

# Get actions on TRIAGE case (FIELD_ASSOCIATE)
GET /api/cases/ghi-789/workflow-actions
Response: {
  "validTransitions": [],
  "canAdvanceWorkflow": false,
  "role": "FIELD_ASSOCIATE"
}
# Cannot advance beyond TRIAGE
```

---

## Debugging Workflow Issues

### "Cannot transition" Error?

1. Check user's role: `console.log(user.role)`
2. Get valid transitions: `cases.getWorkflowActions(caseId)`
3. Check audit trail for who moved case last: `audit.list({ caseId })`
4. Verify case exists in your organization: `cases.get(caseId)`

### Backend Logs

```python
# Watch backend output for workflow transitions
# Output shows: [timestamp] User {user_id} advanced case {case_id} from {from_state} to {to_state}
```

### Test Endpoint

```bash
# Test workflow endpoint directly
curl -H "Authorization: Bearer {token}" \
  "http://localhost:8000/api/cases/abc-123/workflow-actions"
```

---

## Common Patterns

### Pattern 1: Show "Next" Button Only When Allowed

```typescript
function NextButton({ caseId }: { caseId: string }) {
  const { data: actions } = useQuery({
    queryKey: ["workflow", caseId],
    queryFn: () => cases.getWorkflowActions(caseId),
  });

  if (!actions?.validTransitions.length) {
    return null; // Don't show button
  }

  const nextStep = actions.validTransitions[0];

  return (
    <Button onClick={() => moveCase(caseId, nextStep)}>
      Advance to {WORKFLOW_LABELS[nextStep]}
    </Button>
  );
}
```

### Pattern 2: Gated Tab Access

```typescript
function CaseTabs({ caseId }: { caseId: string }) {
  const canCode = usePermission("coding.review");

  return (
    <Tabs>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="coding" disabled={!canCode}>
          Coding
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">...</TabsContent>
      <TabsContent value="coding">
        {canCode ? <CodingWorkspace /> : <p>Not authorized</p>}
      </TabsContent>
    </Tabs>
  );
}
```

### Pattern 3: Workflow Status Display

```typescript
function WorkflowStatus({ caseId, currentStep }: { caseId: string; currentStep: string }) {
  const { data: actions } = useQuery({
    queryKey: ["workflow", caseId],
    queryFn: () => cases.getWorkflowActions(caseId),
  });

  return (
    <div>
      <p>Current: <Badge>{WORKFLOW_LABELS[currentStep]}</Badge></p>

      {actions?.validTransitions.length ? (
        <div>
          <p>Can advance to:</p>
          <ul>
            {actions.validTransitions.map(step => (
              <li key={step}>{WORKFLOW_LABELS[step]}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No further actions available</p>
      )}
    </div>
  );
}
```

---

## Database Schema (if needed)

```sql
-- Cases table (modified for Phase 2.5)
ALTER TABLE cases ADD COLUMN workflow_step TEXT DEFAULT 'INTAKE';
ALTER TABLE cases ADD COLUMN workflow_state JSONB DEFAULT '{}';
ALTER TABLE cases ADD COLUMN assigned_to TEXT;
ALTER TABLE cases ADD COLUMN due_date DATE;

-- Audit trail (existing, used for workflow tracking)
-- Already captures all workflow transitions via
-- action='WORKFLOW_ADVANCED', from_state, to_state, reason

CREATE INDEX idx_workflow_step ON cases(workflow_step);
CREATE INDEX idx_organization_workflow ON cases(organization_id, workflow_step);
```

---

## Success Indicators

✅ Phase 2.5 is working if:

1. Different roles see different workflow buttons
2. Unauthorized transitions are blocked with 403 error
3. Every transition appears in audit trail
4. Case list filters show correct states for user's role
5. Test script runs without errors
6. Frontend case detail shows available actions
7. "Open" button works for all roles
8. Permission-gated tabs (Coding, Seriousness) disable correctly

---

## Next Phase (2.6): Advanced Workflows

- Automatic SLA management (due dates)
- Workflow rules engine (conditional transitions)
- Signal detection integration
- Batch workflow operations
- Escalation workflows
- Custom workflow templates per organization

**Questions?** Check PHASE_25_IMPLEMENTATION.md for detailed documentation.
