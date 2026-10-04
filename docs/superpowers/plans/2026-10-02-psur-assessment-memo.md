# PSUR Assessment Memo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engine, persistence and renderer for NAFDAC's internal PSUR assessment memo — a covering memo plus an 11-criteria report and an ICH/CIOMS scoring matrix — generated from cited evidence an assessor has accepted.

**Scope honesty:** this plan delivers a **fully tested domain engine, two API methods and a working `.docx` renderer**. It does **not** deliver an assessor-facing screen, so at the end of Task 9 a memo can be generated programmatically and in tests but not yet produced by a user clicking through the app. The paste-and-route UI is the immediately following plan and calls `saveAssessmentSection` from Task 9. This was a deliberate split: the engine carries all the regulatory judgement and benefits from TDD, the screen does not.

**Architecture:** Three pure domain modules under `src/services/psur/` (evidence, CIOMS, memo projection) plus render functions in `src/services/api/psur.ts`. The existing 14 `PsurV4SectionId` sections stay as the working surface; the memo's 11 criteria are **projected** from them. No AI in this plan — evidence arrives through the persistence API; retrieval is a later plan.

**Tech Stack:** TypeScript, vitest, `docx` (already a dependency), Supabase via the existing `readDocument`/`saveDocument` helpers.

**Spec:** `docs/superpowers/specs/2026-10-02-psur-assessment-memo-design.md`

## Global Constraints

- **Citation is mandatory.** An `EvidenceEntry` without a non-empty `citation` must never render. Spec §5.
- **Append-only evidence.** Entries are never edited in place; a correction is a new entry superseding the old. Spec §5.
- **Acceptance gates rendering.** An entry with no `acceptedBy` never renders. Spec §5.
- **CIOMS totals are computed, never entered.** Spec §5.
- **No band label or benefit-risk verdict is ever emitted unconfirmed.** Spec §6.
- **Reference number prefix is exactly `NAFDAC/PV/GCIOMS/`**, configuration not a literal; the number itself is never generated. Spec §5.
- **No AI in this plan.** No calls to `ai.psur.*`, no new prompts.
- **Nothing existing is deleted.** The 16-item screening, the screening directive, `finding-ownership.ts` and the 14 sections all keep working. Spec §4.
- `exactOptionalPropertyTypes` is on — optional properties must be spread conditionally (`...(x ? { k: x } : {})`), not assigned `undefined`.

## Review Focus

Five input classes the spec implies but no task's own happy-path test exercises. Each has its pinning test added to the task that owns the code.

1. **An entry whose citation is whitespace only** (`"   "`) — must be treated as uncited and not render. Pinned in Task 2.
2. **A superseded entry that is still accepted** — the superseding entry renders, the superseded one does not, and neither is deleted. Pinned in Task 2.
3. **A CIOMS column with a negative or non-integer score** — totals must refuse rather than produce a nonsense sum that feeds a benefit-risk verdict. Pinned in Task 3.
4. **A total that falls in no configured band** — must return no label rather than the nearest one. Pinned in Task 4.
5. **A criterion with accepted evidence whose content is empty** — must render as unestablished, not as a blank row that reads as NAFDAC's omission. Pinned in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/pv.ts` (modify) | New types only: `EvidenceEntry`, `AssessmentSection`, `CiomsMatrix`, `CiomsRubric`, `MemoCriterionId`, `AssessmentMemoModel` |
| `src/services/psur/evidence.ts` (create) | Evidence entry rules: citation validity, acceptance, supersession, renderable selection |
| `src/services/psur/cioms.ts` (create) | Scoring arithmetic and the provisional rubric |
| `src/services/psur/assessment-memo.ts` (create) | Projection of sections + matrix into `AssessmentMemoModel` |
| `src/services/api/psur.ts` (modify) | Persistence for sections/matrix, and the two render functions |
| `src/services/psur/evidence.test.ts` (create) | Task 2 tests |
| `src/services/psur/cioms.test.ts` (create) | Tasks 3–4 tests |
| `src/services/psur/assessment-memo.test.ts` (create) | Tasks 5–6 tests |

---

### Task 1: Types

**Files:**
- Modify: `src/types/pv.ts` (append near `PsurSuggestedSource`, around line 1225)

**Interfaces:**
- Consumes: `PsurV4SectionId`, `PsurSuggestedSource` (existing)
- Produces: `EvidenceSourceType`, `EvidenceEntry`, `AssessmentSection`, `CiomsScoreRow`, `CiomsAdrColumn`, `CiomsMatrix`, `CiomsBand`, `CiomsRubric`, `MemoCriterionId`, `MemoCriterion`, `AssessmentMemoModel`

- [ ] **Step 1: Add the types**

```ts
/** Where a piece of assessment evidence came from.
 *
 *  PsurSuggestedSource's union MINUS "REQUEST_FROM_MAH" — that is an
 *  action, not a source an assessor can cite — PLUS "SUBMITTED_PSUR",
 *  for evidence read out of the MAH's own document. */
export type EvidenceSourceType =
  | "VIGIFLOW_NIGERIA"
  | "PUBLISHED_LITERATURE"
  | "REFERENCE_SAFETY_INFORMATION"
  | "WORLDWIDE_REGULATORY_ACTIONS"
  | "PATIENT_HCP_FEEDBACK"
  | "RISK_MANAGEMENT_PLAN"
  | "SUBMITTED_PSUR"
  | "OTHER";

/**
 * One piece of cited evidence behind an assessment.
 *
 * Append-only: an entry is never edited in place. A correction is a NEW
 * entry carrying `supersedes`, so the record of what an assessor actually
 * relied on at sign-off survives.
 *
 * `citation` is required because an assertion nobody can check has no
 * place in a signed regulatory assessment, and `acceptedBy` is what
 * separates a candidate from evidence.
 */
export interface EvidenceEntry {
  id: string;
  section: PsurV4SectionId;
  sourceType: EvidenceSourceType;
  /** URL, DOI or document reference. Required — see above. */
  citation: string;
  content: string;
  origin: "ai" | "assessor";
  addedBy: string;
  addedAt: string;
  /** Unset means a candidate that has not been accepted; it never renders. */
  acceptedBy?: string | undefined;
  acceptedAt?: string | undefined;
  /** The id of an entry this one replaces. The superseded entry is kept. */
  supersedes?: string | undefined;
}

/** One of the 14 working sections, with the evidence gathered under it. */
export interface AssessmentSection {
  section: PsurV4SectionId;
  /** What the MAH's own submission says, as extracted. */
  mahStated?: string | undefined;
  /** The assessor's own words for this section. */
  assessorNarrative?: string | undefined;
  evidence: EvidenceEntry[];
}

/** Seriousness / Duration / Incidence, scored per the CIOMS matrix. */
export interface CiomsScoreRow {
  seriousness: number;
  duration: number;
  incidence: number;
}

/** One adverse reaction scored as its own column. */
export interface CiomsAdrColumn {
  reaction: string;
  scores: CiomsScoreRow;
}

export interface CiomsMatrix {
  epidemiologyOfDisease: CiomsScoreRow;
  effectivenessOfProduct: CiomsScoreRow;
  adrs: CiomsAdrColumn[];
  /** Who last changed a score, and when. Both roles may. */
  lastEditedBy?: string | undefined;
  lastEditedAt?: string | undefined;
}

export interface CiomsBand {
  label: string;
  /** Inclusive. */
  min: number;
  /** Inclusive. Omit for the open-ended top band. */
  max?: number | undefined;
}

/**
 * The scale meaning, band boundaries and verdict rule behind the matrix.
 *
 * Ships `provisional: true`, derived from the single supplied Tramadol
 * memo. While provisional, the memo records that a provisional rubric was
 * used, and the assessor must confirm both the band label and the verdict
 * every time. See the spec, section 6.
 */
export interface CiomsRubric {
  provenance: string;
  provisional: boolean;
  bands: CiomsBand[];
  /** Described for the assessor to read; never silently applied. */
  verdictRule?: string | undefined;
}

/** The 11 rows of the memo's review-criteria table, in the form's order. */
export type MemoCriterionId =
  | "PRODUCT_IDENTITY"
  | "REPORTING_INTERVAL"
  | "THERAPEUTIC_CATEGORY"
  | "DATE_RECEIVED"
  | "INTERNATIONAL_BIRTH_DATE"
  | "NIGERIA_BIRTH_DATE"
  | "RSI_CHANGES"
  | "WORLDWIDE_ACTIONS"
  | "PATIENT_EXPOSURE"
  | "RELEVANT_STUDIES"
  | "OVERALL_SAFETY_EVALUATION";

export interface MemoCriterion {
  id: MemoCriterionId;
  number: number;
  /** The criterion as the form words it. */
  label: string;
  /** The Remarks column. Empty means nothing was established. */
  remarks: string;
  /** Citations backing the remarks, in order. */
  citations: string[];
  /** True when no accepted evidence or fact established this criterion. */
  unestablished: boolean;
}

export interface AssessmentMemoModel {
  /** Full reference, e.g. "NAFDAC/PV/GCIOMS/455/III". */
  referenceNumber: string;
  memoDate: string;
  to: string;
  from: string;
  subject: string;
  productNameAndStrength: string;
  signatory: string;
  criteria: MemoCriterion[];
  matrix: CiomsMatrix;
  totals: { epidemiology: number; effectiveness: number; adrs: number[] };
  /** Assessor-confirmed. Empty until confirmed. */
  bandLabel: string;
  benefitRiskVerdict: string;
  analysisOfMatrix: string;
  conclusion: string;
  /** True when the rubric in force was provisional. Printed on the memo. */
  provisionalRubricUsed: boolean;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/pv.ts
git commit -m "feat: types for the PSUR assessment memo"
```

---

### Task 2: Evidence rules

**Files:**
- Create: `src/services/psur/evidence.ts`
- Test: `src/services/psur/evidence.test.ts`

**Interfaces:**
- Consumes: `EvidenceEntry` (Task 1)
- Produces:
  - `isCited(e: EvidenceEntry): boolean`
  - `isAccepted(e: EvidenceEntry): boolean`
  - `renderableEvidence(entries: EvidenceEntry[]): EvidenceEntry[]`
  - `supersede(previous: EvidenceEntry, next: Omit<EvidenceEntry, "supersedes">): EvidenceEntry`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { isAccepted, isCited, renderableEvidence, supersede } from "./evidence";
import type { EvidenceEntry } from "@/types/pv";

function entry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: "e1",
    section: "S5_EXPOSURE_ACTIONS",
    sourceType: "VIGIFLOW_NIGERIA",
    citation: "VigiFlow, Nigeria, 2025-09-01..2026-08-31",
    content: "38,400 treatment courses.",
    origin: "assessor",
    addedBy: "Evaluator",
    addedAt: "2026-10-02T09:00:00Z",
    acceptedBy: "Evaluator",
    acceptedAt: "2026-10-02T09:01:00Z",
    ...overrides,
  };
}

describe("citation", () => {
  it("accepts a real citation", () => {
    expect(isCited(entry())).toBe(true);
  });

  it("rejects an empty citation", () => {
    expect(isCited(entry({ citation: "" }))).toBe(false);
  });

  // Review Focus 1.
  it("rejects a whitespace-only citation", () => {
    expect(isCited(entry({ citation: "   " }))).toBe(false);
  });
});

describe("acceptance", () => {
  it("is accepted when a person accepted it", () => {
    expect(isAccepted(entry())).toBe(true);
  });

  it("is not accepted while acceptedBy is unset", () => {
    const candidate = entry();
    delete (candidate as { acceptedBy?: string }).acceptedBy;
    expect(isAccepted(candidate)).toBe(false);
  });

  it("is not accepted when acceptedBy is blank", () => {
    expect(isAccepted(entry({ acceptedBy: "  " }))).toBe(false);
  });
});

describe("what renders", () => {
  it("keeps accepted, cited entries", () => {
    expect(renderableEvidence([entry()])).toHaveLength(1);
  });

  it("drops an uncited entry even when accepted", () => {
    expect(renderableEvidence([entry({ citation: "" })])).toEqual([]);
  });

  it("drops an unaccepted candidate even when cited", () => {
    const candidate = entry({ id: "e2" });
    delete (candidate as { acceptedBy?: string }).acceptedBy;
    expect(renderableEvidence([candidate])).toEqual([]);
  });

  // Review Focus 2.
  it("renders the superseding entry and not the superseded one, deleting neither", () => {
    const old = entry({ id: "old", content: "38,000 courses." });
    const fresh = entry({ id: "new", content: "38,400 courses.", supersedes: "old" });
    const input = [old, fresh];
    const out = renderableEvidence(input);
    expect(out.map((e) => e.id)).toEqual(["new"]);
    // Append-only: the input array is untouched.
    expect(input).toHaveLength(2);
  });

  it("preserves order for entries that supersede nothing", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    expect(renderableEvidence([a, b]).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("supersede", () => {
  it("links the new entry to the old one", () => {
    const old = entry({ id: "old" });
    const next = supersede(old, { ...entry({ id: "new", content: "corrected" }) });
    expect(next.supersedes).toBe("old");
    expect(next.content).toBe("corrected");
  });

  it("does not mutate the entry being superseded", () => {
    const old = entry({ id: "old" });
    supersede(old, { ...entry({ id: "new" }) });
    expect(old.supersedes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/psur/evidence.test.ts`
Expected: FAIL — `Failed to resolve import "./evidence"`.

- [ ] **Step 3: Write the implementation**

```ts
import type { EvidenceEntry } from "@/types/pv";

/**
 * Evidence rules for the assessment memo.
 *
 * Three properties the memo depends on, kept here rather than in the
 * renderer so the renderer cannot accidentally relax one:
 *
 *  - an assertion nobody can check never renders (isCited)
 *  - a candidate nobody accepted never renders (isAccepted)
 *  - a corrected figure replaces the old one WITHOUT deleting it, so the
 *    record of what an assessor relied on at sign-off survives
 */

/** True when the entry carries a citation a reader could follow. */
export function isCited(e: EvidenceEntry): boolean {
  return e.citation.trim().length > 0;
}

/** True when a person actually accepted this entry. */
export function isAccepted(e: EvidenceEntry): boolean {
  return (e.acceptedBy ?? "").trim().length > 0;
}

/**
 * The entries that may appear in the memo, in input order.
 *
 * Pure: the input array is never modified, because it is the append-only
 * record. A superseded entry is filtered from the output and kept in the
 * store.
 */
export function renderableEvidence(entries: EvidenceEntry[]): EvidenceEntry[] {
  const superseded = new Set(
    entries.map((e) => e.supersedes).filter((id): id is string => !!id),
  );
  return entries.filter((e) => !superseded.has(e.id) && isCited(e) && isAccepted(e));
}

/**
 * Builds the replacement for an entry whose content was wrong.
 *
 * Returns a new entry pointing at the old one. The old entry is returned
 * untouched by design — the caller appends, never overwrites.
 */
export function supersede(
  previous: EvidenceEntry,
  next: Omit<EvidenceEntry, "supersedes">,
): EvidenceEntry {
  return { ...next, supersedes: previous.id };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/psur/evidence.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/psur/evidence.ts src/services/psur/evidence.test.ts
git commit -m "feat: evidence rules — citation required, acceptance gates rendering, append-only supersession"
```

---

### Task 3: CIOMS totals

**Files:**
- Create: `src/services/psur/cioms.ts`
- Test: `src/services/psur/cioms.test.ts`

**Interfaces:**
- Consumes: `CiomsMatrix`, `CiomsScoreRow` (Task 1)
- Produces:
  - `rowTotal(row: CiomsScoreRow): number | undefined`
  - `matrixTotals(m: CiomsMatrix): { epidemiology: number; effectiveness: number; adrs: number[] } | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { matrixTotals, rowTotal } from "./cioms";
import type { CiomsMatrix } from "@/types/pv";

/** The matrix exactly as the supplied Tramadol memo prints it. */
function tramadolMatrix(): CiomsMatrix {
  return {
    epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
    effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
    adrs: [
      { reaction: "Respiratory depression", scores: { seriousness: 3, duration: 1, incidence: 1 } },
      { reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } },
      { reaction: "Serotonin syndrome", scores: { seriousness: 3, duration: 1, incidence: 1 } },
    ],
  };
}

describe("row totals", () => {
  it("sums the three rows", () => {
    expect(rowTotal({ seriousness: 2, duration: 2, incidence: 2 })).toBe(6);
  });

  it("accepts a legitimate zero", () => {
    // The supplied memo scores Effectiveness -> Incidence as 0.
    expect(rowTotal({ seriousness: 3, duration: 3, incidence: 0 })).toBe(6);
  });

  // Review Focus 3.
  it("refuses a negative score rather than summing it", () => {
    expect(rowTotal({ seriousness: -1, duration: 2, incidence: 2 })).toBeUndefined();
  });

  it("refuses a non-integer score", () => {
    expect(rowTotal({ seriousness: 1.5, duration: 2, incidence: 2 })).toBeUndefined();
  });

  it("refuses a non-finite score", () => {
    expect(rowTotal({ seriousness: Number.NaN, duration: 2, incidence: 2 })).toBeUndefined();
  });
});

describe("matrix totals", () => {
  it("reproduces the supplied memo's figures", () => {
    // The memo prints 6, 6, and "5 & 4 & 5".
    expect(matrixTotals(tramadolMatrix())).toEqual({
      epidemiology: 6,
      effectiveness: 6,
      adrs: [5, 4, 5],
    });
  });

  it("refuses the whole matrix when any score is invalid", () => {
    const bad = tramadolMatrix();
    bad.adrs[1]!.scores.duration = -3;
    expect(matrixTotals(bad)).toBeUndefined();
  });

  it("handles a matrix with no ADRs scored yet", () => {
    const m = tramadolMatrix();
    m.adrs = [];
    expect(matrixTotals(m)).toEqual({ epidemiology: 6, effectiveness: 6, adrs: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/psur/cioms.test.ts`
Expected: FAIL — `Failed to resolve import "./cioms"`.

- [ ] **Step 3: Write the implementation**

```ts
import type { CiomsMatrix, CiomsScoreRow } from "@/types/pv";

/**
 * The ICH/CIOMS scoring matrix.
 *
 * Only the arithmetic lives here. The scale's MEANING, the band
 * boundaries and the verdict rule are not in any NAFDAC document this
 * repository holds — see rubric.ts and the spec's section 6. Summing
 * three integers is the one claim this module is entitled to make.
 */

function isScore(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Seriousness + Duration + Incidence, or nothing when any of the three is
 * not a score.
 *
 * Returns undefined rather than a partial sum on purpose: this total feeds
 * a benefit-risk comparison, and a quietly wrong number there is worse
 * than a visibly absent one.
 */
export function rowTotal(row: CiomsScoreRow): number | undefined {
  const values = [row.seriousness, row.duration, row.incidence];
  if (!values.every(isScore)) return undefined;
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Every column's total, or nothing when any single score in the matrix is
 * invalid. All-or-nothing because the memo prints the three totals side by
 * side and compares them; a matrix with one column missing invites a
 * comparison against a blank.
 */
export function matrixTotals(
  m: CiomsMatrix,
): { epidemiology: number; effectiveness: number; adrs: number[] } | undefined {
  const epidemiology = rowTotal(m.epidemiologyOfDisease);
  const effectiveness = rowTotal(m.effectivenessOfProduct);
  if (epidemiology === undefined || effectiveness === undefined) return undefined;
  const adrs: number[] = [];
  for (const adr of m.adrs) {
    const total = rowTotal(adr.scores);
    if (total === undefined) return undefined;
    adrs.push(total);
  }
  return { epidemiology, effectiveness, adrs };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/psur/cioms.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/psur/cioms.ts src/services/psur/cioms.test.ts
git commit -m "feat: CIOMS matrix totals, refusing invalid scores outright"
```

---

### Task 4: The provisional rubric

**Files:**
- Modify: `src/services/psur/cioms.ts`
- Modify: `src/services/psur/cioms.test.ts`

**Interfaces:**
- Consumes: `CiomsRubric`, `CiomsBand` (Task 1), `matrixTotals` (Task 3)
- Produces:
  - `PROVISIONAL_CIOMS_RUBRIC: CiomsRubric`
  - `bandFor(total: number, rubric?: CiomsRubric): CiomsBand | undefined`
  - `proposeVerdict(totals, rubric?): { verdict: string; reasoning: string } | undefined`

- [ ] **Step 1: Write the failing tests (append to `cioms.test.ts`)**

```ts
import { bandFor, PROVISIONAL_CIOMS_RUBRIC, proposeVerdict } from "./cioms";
import type { CiomsRubric } from "@/types/pv";

describe("the provisional rubric", () => {
  it("is marked provisional and says where it came from", () => {
    expect(PROVISIONAL_CIOMS_RUBRIC.provisional).toBe(true);
    expect(PROVISIONAL_CIOMS_RUBRIC.provenance.toLowerCase()).toContain("provisional");
    expect(PROVISIONAL_CIOMS_RUBRIC.provenance).toContain("Tramadol");
  });

  it("labels the supplied memo's total of 6 as medium", () => {
    // The memo reads "a medium efficacy score of 6".
    expect(bandFor(6)?.label.toLowerCase()).toBe("medium");
  });

  // Review Focus 4.
  it("returns no label for a total in no band, rather than the nearest", () => {
    const narrow: CiomsRubric = {
      provenance: "test",
      provisional: true,
      bands: [{ label: "Low", min: 0, max: 2 }],
    };
    expect(bandFor(9, narrow)).toBeUndefined();
  });

  it("returns no label when no rubric is configured at all", () => {
    const none: CiomsRubric = { provenance: "test", provisional: true, bands: [] };
    expect(bandFor(6, none)).toBeUndefined();
  });

  it("treats band bounds as inclusive", () => {
    const r: CiomsRubric = {
      provenance: "test",
      provisional: true,
      bands: [
        { label: "Low", min: 0, max: 3 },
        { label: "High", min: 4 },
      ],
    };
    expect(bandFor(3, r)?.label).toBe("Low");
    expect(bandFor(4, r)?.label).toBe("High");
  });
});

describe("proposing a verdict", () => {
  it("proposes positive when every ADR total is below the epidemiology total", () => {
    // The memo's own reasoning: 5 & 4 & 5 against 6.
    const out = proposeVerdict({ epidemiology: 6, effectiveness: 6, adrs: [5, 4, 5] });
    expect(out?.verdict).toBe("Positive Benefit-Risk Balance");
    expect(out?.reasoning).toContain("6");
  });

  it("does not propose positive when an ADR total reaches the epidemiology total", () => {
    const out = proposeVerdict({ epidemiology: 6, effectiveness: 6, adrs: [5, 6] });
    expect(out?.verdict).not.toBe("Positive Benefit-Risk Balance");
  });

  it("proposes nothing when no ADR has been scored", () => {
    expect(proposeVerdict({ epidemiology: 6, effectiveness: 6, adrs: [] })).toBeUndefined();
  });

  it("proposes nothing when the rubric carries no verdict rule", () => {
    const noRule: CiomsRubric = { provenance: "test", provisional: true, bands: [] };
    expect(proposeVerdict({ epidemiology: 6, effectiveness: 6, adrs: [5] }, noRule)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/psur/cioms.test.ts`
Expected: FAIL — `bandFor is not a function` / no export named `PROVISIONAL_CIOMS_RUBRIC`.

- [ ] **Step 3: Write the implementation (append to `cioms.ts`)**

```ts
/**
 * The band boundaries and verdict rule — PROVISIONAL.
 *
 * Derived from ONE example: the supplied Tramadol-50 memo, which reads
 * "The product has a medium efficacy score of 6" and concludes "Positive
 * Benefit-Risk Balance" because "the critical adverse drug reaction risk
 * profile is less than the epidemiology of the disease itself; a score of
 * 5 & 4 & 5, respectively, vs. a score of 6".
 *
 * NAFDAC has supplied no rubric document. The 0-3 scale's meaning, the
 * band boundaries and the verdict rule are therefore inferred, and one
 * example does not establish any of them. So:
 *
 *   - this object is marked `provisional`
 *   - the memo prints that a provisional rubric was used
 *   - the assessor must CONFIRM both the band label and the verdict every
 *     time; neither is ever auto-accepted
 *
 * Replacing this with a real rubric is a configuration change. Anchoring
 * the one observation we have: total 6 falls in the band labelled
 * "Medium".
 */
export const PROVISIONAL_CIOMS_RUBRIC: CiomsRubric = {
  provenance:
    "PROVISIONAL — inferred from a single example (the Tramadol-50 assessment memo, " +
    "ref NAFDAC/PV/GCIOMS/455/III). No NAFDAC rubric document has been supplied. " +
    "Band boundaries and the verdict rule are unverified.",
  provisional: true,
  bands: [
    { label: "Low", min: 0, max: 3 },
    { label: "Medium", min: 4, max: 6 },
    { label: "High", min: 7 },
  ],
  verdictRule:
    "Where every adverse-reaction column total is lower than the epidemiology-of-disease " +
    "total, the example concluded a Positive Benefit-Risk Balance. Unverified.",
};

/** The band a total falls in, or nothing when no band covers it. */
export function bandFor(
  total: number,
  rubric: CiomsRubric = PROVISIONAL_CIOMS_RUBRIC,
): CiomsBand | undefined {
  return rubric.bands.find((b) => total >= b.min && (b.max === undefined || total <= b.max));
}

/**
 * A verdict the assessor may accept or override — never a decision.
 *
 * Returns nothing when there is no rule to apply or nothing to compare,
 * because a benefit-risk conclusion drawn from an absent comparison would
 * be the single worst output this product could produce.
 */
export function proposeVerdict(
  totals: { epidemiology: number; effectiveness: number; adrs: number[] },
  rubric: CiomsRubric = PROVISIONAL_CIOMS_RUBRIC,
): { verdict: string; reasoning: string } | undefined {
  if (!rubric.verdictRule) return undefined;
  if (totals.adrs.length === 0) return undefined;
  const worst = Math.max(...totals.adrs);
  const positive = worst < totals.epidemiology;
  return {
    verdict: positive ? "Positive Benefit-Risk Balance" : "Requires assessor determination",
    reasoning: positive
      ? `Every adverse-reaction total (${totals.adrs.join(" & ")}) is lower than the ` +
        `epidemiology-of-disease total (${totals.epidemiology}).`
      : `At least one adverse-reaction total (${totals.adrs.join(" & ")}) reaches or exceeds ` +
        `the epidemiology-of-disease total (${totals.epidemiology}); the balance is the ` +
        `assessor's to determine.`,
  };
}
```

Add `CiomsBand` and `CiomsRubric` to the existing type import at the top of `cioms.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/psur/cioms.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/psur/cioms.ts src/services/psur/cioms.test.ts
git commit -m "feat: provisional CIOMS rubric, proposing a band and verdict the assessor must confirm"
```

---

### Task 5: Criterion projection — the six factual criteria

**Files:**
- Create: `src/services/psur/assessment-memo.ts`
- Test: `src/services/psur/assessment-memo.test.ts`

**Interfaces:**
- Consumes: `PsurSubmissionDetails` (existing), `MemoCriterion`, `MemoCriterionId` (Task 1)
- Produces:
  - `MEMO_CRITERIA: { id: MemoCriterionId; number: number; label: string }[]`
  - `MEMO_REFERENCE_PREFIX: string`
  - `factualCriteria(details: PsurSubmissionDetails, therapeuticCategory: string): MemoCriterion[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { factualCriteria, MEMO_CRITERIA, MEMO_REFERENCE_PREFIX } from "./assessment-memo";
import type { PsurSubmissionDetails } from "@/types/pv";

function details(overrides: Partial<PsurSubmissionDetails> = {}): PsurSubmissionDetails {
  return {
    productName: "Tramadol-50 (Tramadol 50mg) Capsule",
    activeSubstance: "Tramadol",
    nafdacRegNo: "A4-100123",
    mah: "Justeen Pharm",
    qppv: "",
    qppvContact: "",
    ibd: "1977",
    firstNafdacRegistrationDate: "",
    dlp: "2024-11-12",
    intervalCovered: "12 November 2021 to 12 November 2024",
    dateReceived: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

describe("the criteria table", () => {
  it("has the form's eleven rows, numbered 1 to 11", () => {
    expect(MEMO_CRITERIA).toHaveLength(11);
    expect(MEMO_CRITERIA.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("starts with Product Identity and ends with the overall safety evaluation", () => {
    expect(MEMO_CRITERIA[0]!.id).toBe("PRODUCT_IDENTITY");
    expect(MEMO_CRITERIA[10]!.id).toBe("OVERALL_SAFETY_EVALUATION");
  });
});

describe("the reference prefix", () => {
  it("is the fixed NAFDAC PV prefix, so the assessor types only the number", () => {
    expect(MEMO_REFERENCE_PREFIX).toBe("NAFDAC/PV/GCIOMS/");
  });
});

describe("the six factual criteria", () => {
  it("fills them from the submission details", () => {
    const out = factualCriteria(details(), "Narcotic Analgesic");
    const by = (id: string) => out.find((c) => c.id === id)!;
    expect(by("PRODUCT_IDENTITY").remarks).toContain("Tramadol");
    expect(by("REPORTING_INTERVAL").remarks).toBe("12 November 2021 to 12 November 2024");
    expect(by("THERAPEUTIC_CATEGORY").remarks).toBe("Narcotic Analgesic");
    expect(by("DATE_RECEIVED").remarks).toBe("2026-09-03");
    expect(by("INTERNATIONAL_BIRTH_DATE").remarks).toBe("1977");
  });

  it("marks a blank Nigeria Birth Date unestablished rather than printing nothing", () => {
    // The form says "(if available)", and the supplied memo leaves it
    // blank — but a blank cell reads as NAFDAC's omission.
    const out = factualCriteria(details(), "Narcotic Analgesic");
    const nbd = out.find((c) => c.id === "NIGERIA_BIRTH_DATE")!;
    expect(nbd.unestablished).toBe(true);
    expect(nbd.remarks).not.toBe("");
  });

  it("marks a missing therapeutic category unestablished", () => {
    const out = factualCriteria(details(), "");
    expect(out.find((c) => c.id === "THERAPEUTIC_CATEGORY")!.unestablished).toBe(true);
  });

  it("returns only the six factual criteria", () => {
    expect(factualCriteria(details(), "x").map((c) => c.id)).toEqual([
      "PRODUCT_IDENTITY",
      "REPORTING_INTERVAL",
      "THERAPEUTIC_CATEGORY",
      "DATE_RECEIVED",
      "INTERNATIONAL_BIRTH_DATE",
      "NIGERIA_BIRTH_DATE",
    ]);
  });

  it("carries no citations — these are facts off the submission, not research", () => {
    for (const c of factualCriteria(details(), "x")) expect(c.citations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/psur/assessment-memo.test.ts`
Expected: FAIL — `Failed to resolve import "./assessment-memo"`.

- [ ] **Step 3: Write the implementation**

```ts
import type { MemoCriterion, MemoCriterionId, PsurSubmissionDetails } from "@/types/pv";

/**
 * The memo's review-criteria table.
 *
 * Eleven rows, worded as the supplied NAFDAC memo words them. Criteria 1-6
 * are facts read off the submission; 7-10 are researched evidence (Task 6);
 * 11 is the assessor's own enumeration.
 */
export const MEMO_CRITERIA: { id: MemoCriterionId; number: number; label: string }[] = [
  { id: "PRODUCT_IDENTITY", number: 1, label: "Product Identity" },
  { id: "REPORTING_INTERVAL", number: 2, label: "Reporting Interval" },
  { id: "THERAPEUTIC_CATEGORY", number: 3, label: "Therapeutic Category" },
  { id: "DATE_RECEIVED", number: 4, label: "Date Received by NAFDAC" },
  { id: "INTERNATIONAL_BIRTH_DATE", number: 5, label: "International Birth Date" },
  { id: "NIGERIA_BIRTH_DATE", number: 6, label: "Nigeria Birth Date (if available)" },
  {
    id: "RSI_CHANGES",
    number: 7,
    label:
      "Changes to reference safety information: (Yes/No), if yes give a brief highlight of changes made",
  },
  {
    id: "WORLDWIDE_ACTIONS",
    number: 8,
    label:
      "Worldwide regulatory authority or MAH actions taken for safety reasons: (Yes/No). If yes, outline.",
  },
  {
    id: "PATIENT_EXPOSURE",
    number: 9,
    label:
      "Data on patient exposure: Is there an African component? (Yes/No) Is there a Nigerian component? (Yes/No)",
  },
  {
    id: "RELEVANT_STUDIES",
    number: 10,
    label:
      "Studies containing relevant safety information (company-sponsored and published studies)",
  },
  {
    id: "OVERALL_SAFETY_EVALUATION",
    number: 11,
    label: "Overall safety evaluation (enumerate in order of seriousness)",
  },
];

/**
 * The fixed part of the memo reference, pre-filled so the assessor types
 * only the number. The number itself is NEVER generated: it belongs to
 * NAFDAC's registry sequence, and a system-invented reference on a signed
 * memo would be worse than an unfilled one.
 */
export const MEMO_REFERENCE_PREFIX = "NAFDAC/PV/GCIOMS/";

/** What a criterion reads when nothing established it. Never a blank
 *  cell: a blank reads as NAFDAC's omission rather than a finding. Same
 *  reasoning as orNotStated() in screening-directive.ts. */
const NOT_ESTABLISHED = "Not stated in the submission";

function criterion(id: MemoCriterionId, value: string): MemoCriterion {
  const def = MEMO_CRITERIA.find((c) => c.id === id)!;
  const trimmed = value.trim();
  return {
    id,
    number: def.number,
    label: def.label,
    remarks: trimmed || NOT_ESTABLISHED,
    citations: [],
    unestablished: !trimmed,
  };
}

/**
 * Criteria 1-6 — the facts.
 *
 * Read off the submission details the screening step already extracted.
 * No citations: these are not research, and attaching one would imply the
 * assessor went looking for something they read off page one.
 */
export function factualCriteria(
  details: PsurSubmissionDetails,
  therapeuticCategory: string,
): MemoCriterion[] {
  return [
    criterion("PRODUCT_IDENTITY", details.activeSubstance || details.productName),
    criterion("REPORTING_INTERVAL", details.intervalCovered),
    criterion("THERAPEUTIC_CATEGORY", therapeuticCategory),
    criterion("DATE_RECEIVED", details.dateReceived.slice(0, 10)),
    criterion("INTERNATIONAL_BIRTH_DATE", details.ibd),
    criterion("NIGERIA_BIRTH_DATE", details.firstNafdacRegistrationDate),
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/psur/assessment-memo.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/psur/assessment-memo.ts src/services/psur/assessment-memo.test.ts
git commit -m "feat: memo criteria table and the six factual criteria"
```

---

### Task 6: Criterion projection — the evidence criteria

**Files:**
- Modify: `src/services/psur/assessment-memo.ts`
- Modify: `src/services/psur/assessment-memo.test.ts`

**Interfaces:**
- Consumes: `renderableEvidence` (Task 2), `AssessmentSection`, `EvidenceEntry` (Task 1), `MEMO_CRITERIA` (Task 5)
- Produces:
  - `CRITERION_SECTIONS: Record<MemoCriterionId, PsurV4SectionId[]>`
  - `evidenceCriteria(sections: AssessmentSection[]): MemoCriterion[]`

- [ ] **Step 1: Write the failing tests (append)**

```ts
import { CRITERION_SECTIONS, evidenceCriteria } from "./assessment-memo";
import type { AssessmentSection, EvidenceEntry } from "@/types/pv";

function ev(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: "e1",
    section: "S4_RSI",
    sourceType: "REFERENCE_SAFETY_INFORMATION",
    citation: "https://dailymed.nlm.nih.gov/example",
    content: "RSI updated to emphasise the warfarin interaction.",
    origin: "assessor",
    addedBy: "Evaluator",
    addedAt: "2026-10-02T09:00:00Z",
    acceptedBy: "Evaluator",
    acceptedAt: "2026-10-02T09:01:00Z",
    ...overrides,
  };
}

function section(id: AssessmentSection["section"], evidence: EvidenceEntry[]): AssessmentSection {
  return { section: id, evidence };
}

describe("which working section feeds which criterion", () => {
  it("maps each evidence criterion to at least one section", () => {
    for (const id of ["RSI_CHANGES", "WORLDWIDE_ACTIONS", "PATIENT_EXPOSURE", "RELEVANT_STUDIES"] as const) {
      expect(CRITERION_SECTIONS[id].length).toBeGreaterThan(0);
    }
  });

  it("feeds criterion 7 from the RSI section", () => {
    expect(CRITERION_SECTIONS.RSI_CHANGES).toContain("S4_RSI");
  });

  it("feeds criterion 9 from the exposure section", () => {
    expect(CRITERION_SECTIONS.PATIENT_EXPOSURE).toContain("S5_EXPOSURE_ACTIONS");
  });
});

describe("the evidence criteria", () => {
  it("renders accepted, cited evidence with its citation", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev()])]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.remarks).toContain("warfarin");
    expect(rsi.citations).toEqual(["https://dailymed.nlm.nih.gov/example"]);
    expect(rsi.unestablished).toBe(false);
  });

  it("marks a criterion with no evidence unestablished", () => {
    const out = evidenceCriteria([section("S4_RSI", [])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  it("ignores an unaccepted candidate", () => {
    const candidate = ev();
    delete (candidate as { acceptedBy?: string }).acceptedBy;
    const out = evidenceCriteria([section("S4_RSI", [candidate])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  it("ignores an uncited entry", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev({ citation: "" })])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  // Review Focus 5.
  it("marks a criterion unestablished when its accepted evidence has no content", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev({ content: "   " })])]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.unestablished).toBe(true);
    expect(rsi.remarks).not.toBe("");
  });

  it("joins several entries and keeps every citation", () => {
    const out = evidenceCriteria([
      section("S4_RSI", [
        ev({ id: "a", content: "First change.", citation: "https://example.test/a" }),
        ev({ id: "b", content: "Second change.", citation: "https://example.test/b" }),
      ]),
    ]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.remarks).toContain("First change.");
    expect(rsi.remarks).toContain("Second change.");
    expect(rsi.citations).toEqual(["https://example.test/a", "https://example.test/b"]);
  });

  it("returns the five non-factual criteria", () => {
    expect(evidenceCriteria([]).map((c) => c.id)).toEqual([
      "RSI_CHANGES",
      "WORLDWIDE_ACTIONS",
      "PATIENT_EXPOSURE",
      "RELEVANT_STUDIES",
      "OVERALL_SAFETY_EVALUATION",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/psur/assessment-memo.test.ts`
Expected: FAIL — no export named `evidenceCriteria`.

- [ ] **Step 3: Write the implementation (append)**

```ts
/**
 * Which working sections feed which memo criterion.
 *
 * This mapping IS the projection the spec's section 4 describes: the 14
 * sections remain the surface where evidence is gathered, and the memo's
 * narrower table is rendered from them. A criterion may draw on more than
 * one section.
 */
export const CRITERION_SECTIONS: Record<MemoCriterionId, PsurV4SectionId[]> = {
  PRODUCT_IDENTITY: [],
  REPORTING_INTERVAL: [],
  THERAPEUTIC_CATEGORY: [],
  DATE_RECEIVED: [],
  INTERNATIONAL_BIRTH_DATE: [],
  NIGERIA_BIRTH_DATE: [],
  RSI_CHANGES: ["S4_RSI"],
  WORLDWIDE_ACTIONS: ["S2_WORLDWIDE_STATUS", "S5_EXPOSURE_ACTIONS"],
  PATIENT_EXPOSURE: ["S5_EXPOSURE_ACTIONS", "S7_AGGREGATE_SAFETY_DATA"],
  RELEVANT_STUDIES: ["S6_LITERATURE", "S3_THERAPEUTIC_CONTEXT"],
  OVERALL_SAFETY_EVALUATION: ["S8_SIGNAL_EVALUATION", "S10_BENEFIT_RISK", "S11_UNCERTAINTIES"],
};

const EVIDENCE_CRITERIA: MemoCriterionId[] = [
  "RSI_CHANGES",
  "WORLDWIDE_ACTIONS",
  "PATIENT_EXPOSURE",
  "RELEVANT_STUDIES",
  "OVERALL_SAFETY_EVALUATION",
];

/**
 * Criteria 7-11, projected from the evidence accepted under their
 * sections.
 *
 * Only accepted, cited entries contribute (renderableEvidence). An entry
 * that passes those gates but carries no actual text contributes nothing
 * either — a row reading as established while saying nothing is worse
 * than one that admits it is empty.
 */
export function evidenceCriteria(sections: AssessmentSection[]): MemoCriterion[] {
  const byId = new Map(sections.map((s) => [s.section, s]));
  return EVIDENCE_CRITERIA.map((id) => {
    const entries = CRITERION_SECTIONS[id]
      .flatMap((sectionId) => renderableEvidence(byId.get(sectionId)?.evidence ?? []))
      .filter((e) => e.content.trim().length > 0);
    const remarks = entries.map((e) => e.content.trim()).join("\n\n");
    const def = MEMO_CRITERIA.find((c) => c.id === id)!;
    return {
      id,
      number: def.number,
      label: def.label,
      remarks: remarks || NOT_ESTABLISHED,
      citations: entries.map((e) => e.citation.trim()),
      unestablished: entries.length === 0,
    };
  });
}
```

Add to the imports at the top of `assessment-memo.ts`:

```ts
import type { AssessmentSection, PsurV4SectionId } from "@/types/pv";
import { renderableEvidence } from "./evidence";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/psur/assessment-memo.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/psur/assessment-memo.ts src/services/psur/assessment-memo.test.ts
git commit -m "feat: project memo criteria 7-11 from accepted section evidence"
```

---

### Task 7: Assemble the memo model

**Files:**
- Modify: `src/services/psur/assessment-memo.ts`
- Modify: `src/services/psur/assessment-memo.test.ts`

**Interfaces:**
- Consumes: `factualCriteria`, `evidenceCriteria` (Tasks 5–6), `matrixTotals`, `bandFor`, `proposeVerdict`, `PROVISIONAL_CIOMS_RUBRIC` (Tasks 3–4)
- Produces: `buildAssessmentMemoModel(input): AssessmentMemoModel | null`

- [ ] **Step 1: Write the failing tests (append)**

```ts
import { buildAssessmentMemoModel } from "./assessment-memo";
import type { CiomsMatrix } from "@/types/pv";

function matrix(): CiomsMatrix {
  return {
    epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
    effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
    adrs: [{ reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } }],
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    referenceNumber: "NAFDAC/PV/GCIOMS/455/III",
    memoDate: "2026-09-17",
    to: "D (Drug R&R)",
    from: "D (PV)",
    signatory: "Director (PV)",
    productNameAndStrength: "Tramadol-50 (Tramadol 50mg) Capsule",
    therapeuticCategory: "Narcotic Analgesic",
    details: details(),
    sections: [] as AssessmentSection[],
    matrix: matrix(),
    confirmedBandLabel: "",
    confirmedVerdict: "",
    analysisOfMatrix: "",
    conclusion: "",
    ...overrides,
  };
}

describe("the assembled memo", () => {
  it("carries all eleven criteria in form order", () => {
    const m = buildAssessmentMemoModel(input())!;
    expect(m.criteria).toHaveLength(11);
    expect(m.criteria.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("computes the totals rather than taking them", () => {
    const m = buildAssessmentMemoModel(input())!;
    expect(m.totals).toEqual({ epidemiology: 6, effectiveness: 6, adrs: [4] });
  });

  it("records that a provisional rubric was used", () => {
    expect(buildAssessmentMemoModel(input())!.provisionalRubricUsed).toBe(true);
  });

  it("leaves band and verdict EMPTY until the assessor confirms them", () => {
    const m = buildAssessmentMemoModel(input())!;
    expect(m.bandLabel).toBe("");
    expect(m.benefitRiskVerdict).toBe("");
  });

  it("uses the assessor's confirmed band and verdict when given", () => {
    const m = buildAssessmentMemoModel(
      input({ confirmedBandLabel: "Medium", confirmedVerdict: "Positive Benefit-Risk Balance" }),
    )!;
    expect(m.bandLabel).toBe("Medium");
    expect(m.benefitRiskVerdict).toBe("Positive Benefit-Risk Balance");
  });

  it("refuses to build when a score is invalid", () => {
    const bad = matrix();
    bad.adrs[0]!.scores.seriousness = -1;
    expect(buildAssessmentMemoModel(input({ matrix: bad }))).toBeNull();
  });

  it("keeps the reference number exactly as the assessor completed it", () => {
    const m = buildAssessmentMemoModel(input())!;
    expect(m.referenceNumber).toBe("NAFDAC/PV/GCIOMS/455/III");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/psur/assessment-memo.test.ts`
Expected: FAIL — no export named `buildAssessmentMemoModel`.

- [ ] **Step 3: Write the implementation (append)**

```ts
export interface AssessmentMemoInput {
  referenceNumber: string;
  memoDate: string;
  to: string;
  from: string;
  signatory: string;
  productNameAndStrength: string;
  therapeuticCategory: string;
  details: PsurSubmissionDetails;
  sections: AssessmentSection[];
  matrix: CiomsMatrix;
  /** The band the assessor confirmed. Empty until they do. */
  confirmedBandLabel: string;
  /** The verdict the assessor confirmed. Empty until they do. */
  confirmedVerdict: string;
  analysisOfMatrix: string;
  conclusion: string;
  rubric?: CiomsRubric | undefined;
}

/**
 * The whole memo, ready to render.
 *
 * Returns null when the matrix cannot be totalled: the memo compares the
 * three totals to reach a benefit-risk conclusion, so a document missing
 * one of them invites a comparison against a blank.
 *
 * `bandLabel` and `benefitRiskVerdict` are the assessor's CONFIRMED
 * values and nothing else. The rubric's proposals are offered in the UI;
 * they never reach the document on their own. See the spec's section 6.
 */
export function buildAssessmentMemoModel(
  input: AssessmentMemoInput,
): AssessmentMemoModel | null {
  const totals = matrixTotals(input.matrix);
  if (!totals) return null;
  const rubric = input.rubric ?? PROVISIONAL_CIOMS_RUBRIC;
  return {
    referenceNumber: input.referenceNumber,
    memoDate: input.memoDate,
    to: input.to,
    from: input.from,
    subject: `Submission of Periodic Safety Update Report (PSUR) for ${input.productNameAndStrength}`,
    productNameAndStrength: input.productNameAndStrength,
    signatory: input.signatory,
    criteria: [
      ...factualCriteria(input.details, input.therapeuticCategory),
      ...evidenceCriteria(input.sections),
    ],
    matrix: input.matrix,
    totals,
    bandLabel: input.confirmedBandLabel.trim(),
    benefitRiskVerdict: input.confirmedVerdict.trim(),
    analysisOfMatrix: input.analysisOfMatrix,
    conclusion: input.conclusion,
    provisionalRubricUsed: rubric.provisional,
  };
}
```

Add to imports: `AssessmentMemoModel`, `CiomsMatrix`, `CiomsRubric` from `@/types/pv`; `matrixTotals`, `PROVISIONAL_CIOMS_RUBRIC` from `./cioms`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/psur/assessment-memo.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/psur/assessment-memo.ts src/services/psur/assessment-memo.test.ts
git commit -m "feat: assemble the assessment memo model"
```

---

### Task 8: Render the memo as text and docx

**Files:**
- Modify: `src/services/api/psur.ts` (add next to `renderScreeningDirectiveText`, around line 1085, and `buildScreeningDirectiveDocx`, around line 1205)
- Test: `src/services/psur/assessment-memo-render.test.ts` (create)

**Interfaces:**
- Consumes: `AssessmentMemoModel` (Task 1), `buildAssessmentMemoModel` (Task 7)
- Produces:
  - `renderAssessmentMemoText(m: AssessmentMemoModel): string`
  - `buildAssessmentMemoDocx(m: AssessmentMemoModel): Document`

Both exported from `src/services/api/psur.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { renderAssessmentMemoText } from "../api/psur";
import type { AssessmentMemoModel } from "@/types/pv";

function model(overrides: Partial<AssessmentMemoModel> = {}): AssessmentMemoModel {
  return {
    referenceNumber: "NAFDAC/PV/GCIOMS/455/III",
    memoDate: "2026-09-17",
    to: "D (Drug R&R)",
    from: "D (PV)",
    subject: "Submission of Periodic Safety Update Report (PSUR) for Tramadol-50",
    productNameAndStrength: "Tramadol-50 (Tramadol 50mg) Capsule",
    signatory: "Director (PV)",
    criteria: [
      {
        id: "PRODUCT_IDENTITY",
        number: 1,
        label: "Product Identity",
        remarks: "Tramadol",
        citations: [],
        unestablished: false,
      },
      {
        id: "RSI_CHANGES",
        number: 7,
        label: "Changes to reference safety information",
        remarks: "RSI updated for the warfarin interaction.",
        citations: ["https://example.test/dsu"],
        unestablished: false,
      },
      {
        id: "RELEVANT_STUDIES",
        number: 10,
        label: "Studies containing relevant safety information",
        remarks: "Not stated in the submission",
        citations: [],
        unestablished: true,
      },
    ],
    matrix: {
      epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
      effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
      adrs: [{ reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } }],
    },
    totals: { epidemiology: 6, effectiveness: 6, adrs: [4] },
    bandLabel: "Medium",
    benefitRiskVerdict: "Positive Benefit-Risk Balance",
    analysisOfMatrix: "The product has a medium efficacy score of 6.",
    conclusion: "The product possesses a Positive Benefit-Risk Balance.",
    provisionalRubricUsed: true,
    ...overrides,
  };
}

describe("the rendered memo", () => {
  it("opens with the memo header and the reference", () => {
    const out = renderAssessmentMemoText(model());
    expect(out).toContain("INTERNAL MEMO");
    expect(out).toContain("NAFDAC/PV/GCIOMS/455/III");
    expect(out).toContain("To:");
    expect(out).toContain("D (Drug R&R)");
  });

  it("separates the memo from the report", () => {
    // One document, two parts — the supplied example uses a page break.
    expect(renderAssessmentMemoText(model())).toContain("THE REPORT OF THE REVIEW");
  });

  it("prints each criterion with its number and remarks", () => {
    const out = renderAssessmentMemoText(model());
    expect(out).toContain("1");
    expect(out).toContain("Tramadol");
    expect(out).toContain("RSI updated for the warfarin interaction.");
  });

  it("prints the citation behind a researched criterion", () => {
    expect(renderAssessmentMemoText(model())).toContain("https://example.test/dsu");
  });

  it("prints the matrix totals", () => {
    const out = renderAssessmentMemoText(model());
    expect(out).toContain("6");
    expect(out).toContain("4");
  });

  it("says a provisional rubric was used", () => {
    expect(renderAssessmentMemoText(model()).toLowerCase()).toContain("provisional");
  });

  it("does not claim a band or verdict the assessor never confirmed", () => {
    const out = renderAssessmentMemoText(
      model({ bandLabel: "", benefitRiskVerdict: "", analysisOfMatrix: "", conclusion: "" }),
    );
    expect(out).not.toContain("Positive Benefit-Risk Balance");
    expect(out).not.toContain("Medium");
  });

  it("shows an unestablished criterion as not stated, never as a blank", () => {
    const out = renderAssessmentMemoText(model());
    expect(out).toContain("Not stated in the submission");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/psur/assessment-memo-render.test.ts`
Expected: FAIL — no export named `renderAssessmentMemoText`.

- [ ] **Step 3: Write the text renderer in `src/services/api/psur.ts`**

Place it immediately after `renderScreeningDirectiveText`. The existing
`indent` helper in that file is reused.

```ts
/**
 * NAFDAC's internal assessment memo.
 *
 * One document, two parts, exactly as the supplied example is laid out: a
 * covering memo, then the report it refers to as its attachment. The
 * screening directive (above) goes to the MAH and demands a response;
 * this goes to another directorate and does not.
 */
export function renderAssessmentMemoText(m: AssessmentMemoModel): string {
  const rule = "=".repeat(72);
  const lines: string[] = [];

  lines.push("National Agency for Food and Drug Administration and Control");
  lines.push("Pharmacovigilance Directorate");
  lines.push("INTERNAL MEMO");
  lines.push(rule);
  lines.push(`${m.referenceNumber}${" ".repeat(8)}${m.memoDate}`);
  lines.push("");
  lines.push(`To:     ${m.to}`);
  lines.push(`From:   ${m.from}`);
  lines.push("");
  lines.push(`SUBJECT: ${m.subject}`);
  lines.push("");
  lines.push("The above subject matter refers, please.");
  lines.push("");
  lines.push(
    "I hereby forward, as an attachment to this memo, the report of the review of the",
  );
  lines.push("PSUR for the above-mentioned medicinal product for your attention.");
  lines.push("");
  lines.push("Thank you,");
  lines.push("");
  lines.push(m.signatory);
  lines.push("");
  lines.push("");

  lines.push("THE REPORT OF THE REVIEW");
  lines.push(rule);
  lines.push(`Product name and strength: ${m.productNameAndStrength}`);
  lines.push("");

  lines.push("REVIEW CRITERIA");
  lines.push("-".repeat(72));
  for (const c of m.criteria) {
    lines.push(`${c.number}. ${c.label}`);
    lines.push(indent(c.remarks, 4));
    for (const citation of c.citations) {
      lines.push(indent(`Source: ${citation}`, 4));
    }
    lines.push("");
  }

  lines.push("SUMMARY TABLE 1: ICH AND CIOMS PRINCIPLE");
  lines.push("-".repeat(72));
  lines.push(`Epidemiology of Disease     total ${m.totals.epidemiology}`);
  lines.push(`Effectiveness of Product    total ${m.totals.effectiveness}`);
  m.matrix.adrs.forEach((adr, i) => {
    lines.push(`${adr.reaction.padEnd(27)} total ${m.totals.adrs[i]}`);
  });
  if (m.provisionalRubricUsed) {
    lines.push("");
    lines.push(
      "NOTE: a PROVISIONAL scoring rubric was in force for this assessment. The band",
    );
    lines.push(
      "label and benefit-risk conclusion below were confirmed by the assessor, not",
    );
    lines.push("derived from an authoritative NAFDAC rubric.");
  }
  lines.push("");

  if (m.analysisOfMatrix) {
    lines.push("ANALYSIS OF MATRIX");
    lines.push("-".repeat(72));
    if (m.bandLabel) lines.push(`Efficacy band: ${m.bandLabel}`);
    lines.push(m.analysisOfMatrix);
    lines.push("");
  }

  if (m.conclusion) {
    lines.push("CONCLUSION");
    lines.push("-".repeat(72));
    if (m.benefitRiskVerdict) lines.push(m.benefitRiskVerdict);
    lines.push(m.conclusion);
    lines.push("");
  }

  return lines.join("\n");
}
```

Add `AssessmentMemoModel` to the type imports at the top of `psur.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/psur/assessment-memo-render.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the docx renderer**

Place it after `buildScreeningDirectiveDocx`, reusing that file's existing
`docxHeading`, `docxLabelValue`, `cell` and `headerCell` helpers.

```ts
/**
 * The same memo as a Word file.
 *
 * A real page break between the memo and the report, because the supplied
 * example has one and the two parts are read as separate pages.
 */
function buildAssessmentMemoDocx(m: AssessmentMemoModel): Document {
  const criteriaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [headerCell("S/N"), headerCell("Review Criteria"), headerCell("Remarks")],
      }),
      ...m.criteria.map(
        (c) =>
          new TableRow({
            children: [
              cell(String(c.number)),
              cell(c.label),
              cell(
                c.citations.length > 0
                  ? `${c.remarks}\n\nSource(s): ${c.citations.join("; ")}`
                  : c.remarks,
              ),
            ],
          }),
      ),
    ],
  });

  const matrixTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [headerCell("Column"), headerCell("Total")],
      }),
      new TableRow({
        children: [cell("Epidemiology of Disease"), cell(String(m.totals.epidemiology))],
      }),
      new TableRow({
        children: [cell("Effectiveness of Product"), cell(String(m.totals.effectiveness))],
      }),
      ...m.matrix.adrs.map(
        (adr, i) =>
          new TableRow({ children: [cell(adr.reaction), cell(String(m.totals.adrs[i]))] }),
      ),
    ],
  });

  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: "National Agency for Food and Drug Administration and Control",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({ text: "Pharmacovigilance Directorate" }),
          docxHeading("Internal Memo"),
          docxLabelValue("Ref", m.referenceNumber),
          docxLabelValue("Date", m.memoDate),
          docxLabelValue("To", m.to),
          docxLabelValue("From", m.from),
          docxLabelValue("Subject", m.subject),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "The above subject matter refers, please." }),
          new Paragraph({
            text:
              "I hereby forward, as an attachment to this memo, the report of the review " +
              "of the PSUR for the above-mentioned medicinal product for your attention.",
          }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "Thank you," }),
          new Paragraph({ text: m.signatory }),
          new Paragraph({ children: [new PageBreak()] }),

          docxHeading("The report of the review"),
          docxLabelValue("Product name and strength", m.productNameAndStrength),
          new Paragraph({ text: "" }),
          criteriaTable,
          new Paragraph({ text: "" }),
          docxHeading("Summary Table 1: ICH and CIOMS Principle", HeadingLevel.HEADING_2),
          matrixTable,
          ...(m.provisionalRubricUsed
            ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text:
                        "Note: a provisional scoring rubric was in force for this " +
                        "assessment. The band label and benefit-risk conclusion were " +
                        "confirmed by the assessor, not derived from an authoritative " +
                        "NAFDAC rubric.",
                      italics: true,
                    }),
                  ],
                }),
              ]
            : []),
          ...(m.analysisOfMatrix
            ? [
                docxHeading("Analysis of Matrix", HeadingLevel.HEADING_2),
                ...(m.bandLabel ? [docxLabelValue("Efficacy band", m.bandLabel)] : []),
                new Paragraph({ text: m.analysisOfMatrix }),
              ]
            : []),
          ...(m.conclusion
            ? [
                docxHeading("Conclusion", HeadingLevel.HEADING_2),
                ...(m.benefitRiskVerdict
                  ? [new Paragraph({ text: m.benefitRiskVerdict })]
                  : []),
                new Paragraph({ text: m.conclusion }),
              ]
            : []),
        ],
      },
    ],
  });
}
```

Add `PageBreak` to the existing `docx` import in `psur.ts`.

- [ ] **Step 6: Verify the whole suite and the typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx vitest run`
Expected: all tests pass, including the pre-existing suite.

- [ ] **Step 7: Commit**

```bash
git add src/services/api/psur.ts src/services/psur/assessment-memo-render.test.ts
git commit -m "feat: render the assessment memo as text and docx"
```

---

### Task 9: Persist sections and the matrix, with Peer Reviewer edit rights

**Files:**
- Modify: `src/types/pv.ts` (add two fields to `PsurDocument`)
- Modify: `src/services/api/psur.ts` (two API methods)
- Test: `src/services/psur/assessment-persistence.test.ts` (create)

**Interfaces:**
- Consumes: `AssessmentSection`, `CiomsMatrix` (Task 1)
- Produces:
  - `canEditCiomsMatrix(role: Role): boolean` in `src/services/psur/workflow.ts`
  - `psur.saveAssessmentSection(documentId, section)` and `psur.saveCiomsMatrix(documentId, matrix, editedBy)` on the existing `psur` API object

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { canEditCiomsMatrix } from "./workflow";

describe("who may change a CIOMS score", () => {
  it("lets the Evaluator, who authors the assessment", () => {
    expect(canEditCiomsMatrix("EVALUATOR")).toBe(true);
  });

  it("lets the Peer Reviewer, who may change it on review", () => {
    // Confirmed with NAFDAC: the Evaluator enters the scores and the Peer
    // Reviewer may also change them. This is a widening of the Peer
    // Reviewer's role, which was previously check-and-countersign only.
    expect(canEditCiomsMatrix("PEER_REVIEWER")).toBe(true);
  });

  it("does not let the Review Officer, whose step ended at screening", () => {
    expect(canEditCiomsMatrix("REVIEW_OFFICER")).toBe(false);
  });

  it("does not let MAH-side staff anywhere near it", () => {
    for (const role of ["FIELD_ASSOCIATE", "PV_COORDINATOR", "PV_MANAGER"] as const) {
      expect(canEditCiomsMatrix(role)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/psur/assessment-persistence.test.ts`
Expected: FAIL — no export named `canEditCiomsMatrix`.

- [ ] **Step 3: Add the permission rule to `src/services/psur/workflow.ts`**

```ts
import type { Role } from "@/lib/auth";

/**
 * Who may change a CIOMS score.
 *
 * The Evaluator authors the assessment, and NAFDAC confirmed the Peer
 * Reviewer may change a score on review — a widening of that role, which
 * until now checked and countersigned without editing. Every change is
 * audited with who and when, because a changed benefit-risk input is
 * exactly what someone will later ask about.
 *
 * The Review Officer is excluded: their step ended at screening. MAH-side
 * staff are excluded entirely.
 */
export function canEditCiomsMatrix(role: Role): boolean {
  return role === "EVALUATOR" || role === "PEER_REVIEWER";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/psur/assessment-persistence.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the two document fields in `src/types/pv.ts`**

Inside `PsurDocument`:

```ts
  /** The assessment's working sections and the evidence under them. */
  assessmentSections?: AssessmentSection[] | undefined;
  /** The ICH/CIOMS scoring matrix for this assessment. */
  ciomsMatrix?: CiomsMatrix | undefined;
```

- [ ] **Step 6: Add the two API methods in `src/services/api/psur.ts`**

Add to the exported `psur` object, following the existing `saveFinding`
pattern and re-checking the caller's role server-side:

```ts
  /** Appends or replaces one working section's record. */
  saveAssessmentSection: async (
    documentId: string,
    section: AssessmentSection,
  ): Promise<PsurDocument> => {
    const doc = await readDocument(documentId);
    const existing = doc.assessmentSections ?? [];
    const next = [
      ...existing.filter((s) => s.section !== section.section),
      section,
    ];
    return saveDocument({ ...doc, assessmentSections: next });
  },

  /** Records a CIOMS matrix, stamping who changed it and when. */
  saveCiomsMatrix: async (
    documentId: string,
    matrix: CiomsMatrix,
    editedBy: string,
  ): Promise<PsurDocument> => {
    const doc = await readDocument(documentId);
    return saveDocument({
      ...doc,
      ciomsMatrix: { ...matrix, lastEditedBy: editedBy, lastEditedAt: new Date().toISOString() },
    });
  },
```

- [ ] **Step 7: Verify the whole suite, the typecheck and the build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx vitest run`
Expected: all tests pass.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/types/pv.ts src/services/api/psur.ts src/services/psur/workflow.ts src/services/psur/assessment-persistence.test.ts
git commit -m "feat: persist assessment sections and the CIOMS matrix, with audited Peer Reviewer edit rights"
```

---

## Out of scope for this plan

Deliberately excluded, each with its own later plan:

- **AI research retrieval** — the `/api/ai/psur/research` endpoint, candidate entries, accept/reject UI. Additive on `EvidenceEntry`; nothing here needs changing to accommodate it.
- **Paste-and-route UI** — the assessor-facing screen and the AI section classifier. Task 9's `saveAssessmentSection` is the API it will call. **This is the next plan, not an optional extra:** without it there is no way for a person to add evidence, so the memo is reachable only from tests until it exists.
- **MAH feedback letter** and the `psur.ts:1455` inversion.
- **VigiFlow retrieval** for criterion 9 — blocked on data access.
