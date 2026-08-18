# Phase 2 Implementation Plan - Advanced Case Processing

## Overview

Phase 2 builds upon the working Phase 1 architecture to add intelligent case processing capabilities including duplicate detection, consistency checking, intelligent triage, and a unified processing interface.

## Phase 2 Features

### 2.1 - Duplicate Detection ✅ IMPLEMENTED

Identify potentially duplicate cases within an organization based on patient info, product, reactions, and narrative similarity.

**Status:** Complete - Implemented and ready for testing

**Components Implemented:**

1. **Backend Logic (backend/app.py):**
   - `_calculate_similarity_score()` - Levenshtein distance-based string similarity
   - `_find_duplicate_candidates()` - Find and rank potential duplicates by confidence
   - Scoring based on: product match, patient match, reaction match, date of birth
   - Weighted confidence calculation (60% threshold for flagging)
   - Sorted results by confidence descending

2. **Backend Endpoints:**
   - `POST /api/cases/{case_id}/duplicate-check` - Scan a case for duplicates
   - `GET /api/duplicates/summary` - Get organization-wide duplicate statistics
   - `POST /api/duplicates/{match_id}/resolve` - Mark duplicate as reviewed/merged

3. **Frontend API Client (src/services/api/duplicate-detection.ts):**
   - TypeScript types: DuplicateCandidate, MatchedFields, DuplicateEvidence, DuplicatesSummary
   - `checkForDuplicates(caseId)` - Async function to scan case
   - `getDuplicatesSummary()` - Retrieve org-wide duplicate statistics
   - `resolveDuplicateMatch(matchId, action)` - Update resolution status

4. **Frontend UI Component (src/components/pv/duplicate-detection-panel.tsx):**
   - Auto-runs duplicate check when component mounts
   - Displays unresolved duplicates with confidence scores
   - Shows matched field percentages (product, patient, reaction, DOB)
   - Evidence display (actual values compared)
   - Action buttons: Keep Separate, Merge Cases, View Case
   - Confidence color coding (red ≥85%, orange ≥75%, yellow <75%)
   - Resolved duplicates summary

5. **Database Schema:**
   - New `duplicate_matches` table in migration 001_initial_schema.sql
   - Columns: id, organization_id, case_id, duplicate_case_id, confidence, matched_fields, evidence, status, resolution_action, resolved_by, resolved_at
   - Indexes: on case_id, organization_id, status, confidence
   - RLS Policies: Organization-scoped access control

**Similarity Algorithm:**

- Levenshtein distance-based scoring (0-100%)
- Product: 40% weight for confidence calculation
- Patient: 40% weight for confidence calculation
- Reaction: 20% weight for confidence calculation
- Date of birth match: 15% confidence boost
- Minimum threshold: 60% overall confidence to flag

### 2.2 - Consistency/Quality Checks ✅ IMPLEMENTED

Automated validation of case data for completeness, logical consistency, and regulatory requirements.

**Status:** Complete - Implemented and ready for testing

**Components Implemented:**

1. **Backend Endpoints:**
   - `POST /api/cases/{case_id}/consistency-check` - Run checks on a case
   - `GET /api/cases/{case_id}/consistency-check` - Retrieve check results
   - `POST /api/cases/{case_id}/consistency-check/{check_id}/acknowledge` - Acknowledge findings

2. **Backend Logic (backend/app.py):**
   - `_perform_consistency_checks()` function with 7 quality checks:
     - Patient Identification Check
     - Product Identification Check
     - Reaction Information Check
     - Seriousness Justification Check
     - Narrative Completeness Check
     - Reporter Information Check
     - Minimum Information Standard Check

3. **Frontend API Client (src/services/api/consistency-check.ts):**
   - TypeScript types for ConsistencyCheckResult
   - `runConsistencyCheck(caseId)` - Async function to run checks
   - `getConsistencyChecks(caseId)` - Retrieve stored check results
   - `acknowledgeCheck(caseId, checkId)` - Acknowledge a finding

4. **Frontend UI Component (src/components/pv/consistency-check-panel.tsx):**
   - Auto-runs checks when component mounts
   - Displays checks grouped by severity (ERROR, WARNING, INFO)
   - Shows summary statistics (error/warning/info counts)
   - Per-check details with suggested resolutions
   - Acknowledge button for each check
   - Status tracking (OPEN, ACKNOWLEDGED, RESOLVED)
   - Responsive styling with Tailwind CSS

5. **Database Schema:**
   - New `consistency_checks` table in migration 001_initial_schema.sql
   - Columns: id, organization_id, case_id, check_type, severity, message, evidence, suggested_resolution, status
   - Indexes: on case_id, organization_id, status
   - RLS Policies: Organization-scoped access control

**Quality Checks Implemented:**

| Check                     | Severity | Condition                            | Resolution                              |
| ------------------------- | -------- | ------------------------------------ | --------------------------------------- |
| Patient Identification    | WARNING  | No patient identifier or "P-UNKNOWN" | Obtain valid patient identifier         |
| Product Identification    | ERROR    | Missing product name or "Unknown"    | Enter suspect product name              |
| Reaction Information      | ERROR    | Missing reaction term or "Unknown"   | Describe reported adverse event         |
| Seriousness Justification | WARNING  | Marked serious but no narrative      | Add narrative supporting classification |
| Narrative Missing         | INFO     | No narrative provided                | Consider adding context for reviewers   |
| Reporter Information      | INFO     | Reporter name not documented         | Record reporter info for follow-up      |
| Minimum Info Standard     | ERROR    | Missing required fields              | Complete all minimum required fields    |

### 2.3 - Intelligent Triage ✅ IMPLEMENTED

Case prioritization and workflow routing based on seriousness, completeness, and business rules.

**Status:** Complete - Implemented and ready for testing

**Components Implemented:**

1. **Backend Logic (backend/app.py):**
   - `_calculate_triage_score()` - Multi-factor scoring algorithm
   - Factors analyzed:
     - Seriousness (0-30 points): Serious vs non-serious classification
     - Data Completeness (0-20 points): Essential field population check
     - Urgency (0-25 points): Keyword detection for medical emergencies
     - Reporter Quality (0-15 points): Healthcare professional vs lay reporter
     - Assignment Status (0-10 points): Already assigned cases
   - Score range: 0-100 points
   - Priority determination: NORMAL, HIGH, CRITICAL
   - Workflow step recommendations

2. **Backend Endpoints:**
   - `POST /api/cases/{case_id}/triage` - Calculate triage score for a case
   - `GET /api/triage/dashboard` - Get organization-wide triage metrics

3. **Frontend API Client (src/services/api/triage.ts):**
   - TypeScript types: TriageFactor, TriageScore, TriageDashboard
   - `calculateTriageScore(caseId)` - Async function to calculate case priority
   - `getTriageDashboard()` - Retrieve org-wide metrics and trends

4. **Frontend UI Components:**
   - **TriageCard** (src/components/pv/triage-card.tsx):
     - Displays triage score and priority level
     - Shows all scoring factors with point breakdown
     - Recommended next workflow step
     - Recalculate button for score updates
     - Color-coded priority badges (red=CRITICAL, orange=HIGH, yellow=NORMAL)
   - **TriageDashboard** (src/components/pv/triage-dashboard.tsx):
     - KPI cards: Total cases, critical, high priority, average score
     - Serious case statistics and percentage
     - Bar chart: Cases by workflow step distribution
     - Pie chart: Priority distribution across organization
     - Performance metrics: Case completion rate
     - Alerts for urgent and high-priority cases

**Triage Scoring Algorithm:**

| Factor           | Points | Condition                                   |
| ---------------- | ------ | ------------------------------------------- |
| Seriousness      | 5-30   | Serious cases +30, non-serious +5           |
| Completeness     | 0-20   | 5 points per required field (4 fields)      |
| Urgency          | 0-25   | Keywords (death, hospitalization, critical) |
| Reporter Quality | 5-15   | Healthcare professional vs lay              |
| Assignment       | 0-10   | Already assigned to reviewer                |

**Priority Levels:**

- **CRITICAL**: Cases with urgent medical events (death, hospitalization, ICU admission)
- **HIGH**: Serious cases or with urgency indicators
- **NORMAL**: Standard cases requiring standard workflow

**Workflow Routing:**

- CRITICAL → REVIEW (immediate escalation)
- HIGH + Complete → CODING
- Standard → TRIAGE (standard workflow)

### 2.4 - Unified Case Processing Screen

Central interface for reviewers to assess, code, review, and decide on cases.

### 2.5 - Role-Based Workflow UI

Different interfaces and available actions based on user role (FIELD_ASSOCIATE, PV_COORDINATOR, PV_MANAGER, ADMIN).

## Implementation Status

Ready to begin Phase 2.3. Waiting for Supabase credentials to proceed with end-to-end testing.

---

## Proposed Phase 2 Architecture

```
ICSR Intake
    ↓
Validation (completeness check)
    ↓
┌─────────────────────────────────────┐
│ Parallel Processing                  │
│                                      │
├─→ Duplicate Detection ──────────────┤
├─→ Seriousness Assessment ───────────┤
├─→ Coding Suggestions ───────────────┤
└─→ Consistency Checks ───────────────┘
    ↓
Combined Case View
    ↓
Human Review
    ↓
Decision/Approval
    ↓
QC Check
    ↓
Regulatory Ready
    ↓
Closed/Reporting
```

---

## Next Steps

1. **Phase 2.4** - Unified Case Processing Screen (In Progress)
   - Unified view combining assessment, coding, review, and decision
   - Side-by-side panels for all case information
   - Integrated workflow controls

2. **Phase 2.5** - Role-Based Workflow UI (Planned)
   - Role-specific UI variations
   - Action availability based on role and permissions
   - Custom views per role type

3. **Testing & Deployment**
   - End-to-end testing with Supabase credentials
   - Performance testing and optimization
   - Production deployment and monitoring
