# PSUR assessment memo — design

Date: 2026-10-02
Status: design approved in conversation; implementation not started.

## 1. Why this exists

The scientific-review stage currently produces a **Compliance Directive to
the MAH**, built from the review's findings, with
`finding-ownership.ts` deciding which findings the MAH must act on.

That is the wrong document. Confirmed with NAFDAC (via the product owner,
2026-09-30):

> Only the **Review Officer** returns a report to the MAH, at screening,
> with a compliance directive. Once a report passes into **scientific
> review it never goes back to the MAH.** Evaluators research the gaps and
> resolve them themselves, and those resolutions become content of
> NAFDAC's own assessment. The MAH receives only advisory feedback for the
> next cycle.

## 2. The target document

A real example was supplied: an internal NAFDAC memo for Tramadol-50
(ref `NAFDAC/PV/GCIOMS/455/III`, 17 September 2026, Pharmacovigilance
Directorate to D (Drug R&R), signed for the Director (PV)).

**It is a single `.docx` containing two parts separated by a hard page
break** — verified by inspecting the document XML, not inferred from
reading it:

```
Page 1   INTERNAL MEMO  (the covering message)
         letterhead · ref · date · To: D (Drug R&R) · From: D (PV)
         SUBJECT · "The above subject matter refers, please."
         "I hereby forward, as an attachment to this memo, the report
          of the review of the PSUR … submitted by XXXX …"
         "Thank you," · For: <Director (PV)>
         ──────────────────── PAGE BREAK ────────────────────
Page 2+  THE REPORT OF THE REVIEW
         Product name and strength
         Table 1 — S/N | Review Criteria | Remarks   (11 criteria)
         Table 2 — "Summary Table 1: ICH and CIOMS PRINCIPLE"
         Analysis of Matrix
         Conclusion
```

The "attachment" the memo refers to is the content printed below it. There
is **no separate 14-section attachment**, so our existing
`PsurV4SectionId` (`ADMIN_SCREENING`, `S1`–`S13`) is **not** this document.

The example file holds a real submission and a named official. It is **not
in this repository and must not be committed.**

### The 11 review criteria

| # | Criterion | Nature |
|---|---|---|
| 1 | Product Identity | fact |
| 2 | Reporting Interval | fact |
| 3 | Therapeutic Category | fact |
| 4 | Date Received by NAFDAC | fact (system knows) |
| 5 | International Birth Date | fact |
| 6 | Nigeria Birth Date (if available) | fact, may be blank |
| 7 | Changes to reference safety information (Yes/No + highlight) | **researched evidence** |
| 8 | Worldwide regulatory authority or MAH actions taken for safety reasons (Yes/No + outline) | **researched evidence** |
| 9 | Data on patient exposure — African component? Nigerian component? | **researched evidence (VigiFlow)** |
| 10 | Studies containing relevant safety information | **researched evidence** |
| 11 | Overall safety evaluation, enumerated in order of seriousness | assessor judgement |

In the example, criteria 7, 8 and 10 carry external sources inline —
DailyMed, NCBI Bookshelf, a gov.uk Drug Safety Update, the British Pain
Society, WADA, a DOI with named authors. Criterion 9's remark reads
*"3 ADR reports on Vigiflow … during the reporting interval"* — an
assessor looked that up by hand.

## 3. Decisions taken

Each was put to the product owner and answered.

1. **Deliverable** — NAFDAC's own assessment memo. The MAH's PSUR is
   evidence, not the document being edited.
2. **AI authority** — retrieve and summarise real sources **with
   citations** only. The AI may never assert a fact it cannot cite, and
   nothing enters the document until an assessor accepts it.
3. **Feedback scope** — a gap NAFDAC filled by its own research is
   **still** reported to the MAH for the next cycle.
4. **Shape** — projection, not replacement (see §4).
5. **CIOMS rubric** — provisional, always confirmed (see §6).
6. **Scores** — the Evaluator enters them; the Peer Reviewer may change
   them.

On (2): the only comparable deployed system is FDA's Elsa, which drafts
freely and
[hallucinates entire studies](https://www.engadget.com/ai/fda-employees-say-the-agencys-elsa-generative-ai-hallucinates-entire-studies-203547157.html);
reviewers report the checking costs more than the tool saves, and Elsa 4.0
still does it. Meanwhile citation traceability is the headline
differentiator of the MAH-side authoring tools (Certara CoAuthor, Yseop).
The constraint is the industry's own, not an unusual precaution.

## 4. Projection, not replacement

Our 16-item screening checklist and 14 working sections are **richer than
the memo**. The product owner's instruction: anything of ours that is not
in theirs **still executes**.

So the working surface stays, and the memo is a **render over it**:

| Layer | Role | Visible in memo? |
|---|---|---|
| 16-item screening | Review Officer's gate | No — separate directive |
| Working sections | where evidence accumulates | No — internal |
| Evidence entries | cited research | Yes — criteria 7–10 |
| CIOMS matrix | scoring | Yes — Table 2 |
| Findings | what is wrong | Indirectly (criterion 11, feedback) |
| **Assessment memo** | the output | **Yes — this is it** |

Nothing already built is discarded. The 14 sections stop being a document
and become the structure the 11 criteria are projected from.

## 5. New objects

### `AssessmentSection`
One per existing working section — **keyed by `PsurV4SectionId`**, the 14
sections we already have. "Working section" throughout this document means
one of those, not a memo criterion; the memo's 11 criteria are projected
from them (§4). Holds: the MAH-stated content extracted from the
submission, the assessor's narrative, and an append-only list of
`EvidenceEntry`.

### `EvidenceEntry`
```
sourceType   VIGIFLOW_NIGERIA | PUBLISHED_LITERATURE |
             REFERENCE_SAFETY_INFORMATION | WORLDWIDE_REGULATORY_ACTIONS |
             PATIENT_HCP_FEEDBACK | RISK_MANAGEMENT_PLAN |
             SUBMITTED_PSUR | OTHER
citation     the URL, DOI or document reference — REQUIRED
content      what it says, in the assessor's or the AI's words
origin       'ai' | 'assessor'
addedBy/At   who put it there
acceptedBy/At  who accepted it — unset means it is a candidate only
```
The source list is `PsurSuggestedSource`'s union **minus
`REQUEST_FROM_MAH`** — which is an action, not a source an assessor can
cite — **plus `SUBMITTED_PSUR`**, for evidence read out of the MAH's own
document (its Appendix I RSI, for instance). The remaining six carry over
unchanged, so the two type lists should share a base rather than drift.

**Append-only**: an entry is never edited in place;
a correction is a new entry superseding the old, so the record of what an
assessor relied on at sign-off survives.

An entry with no `acceptedBy` never renders.

### `CiomsMatrix`
```
columns:  epidemiologyOfDisease | effectivenessOfProduct
          | adrs: [{ reaction, scores }]
rows:     seriousness | duration | incidence      (integers)
totals:   computed per column — sum of the three rows
```
Totals are **computed, never entered**. The example's totals (6, 6, and
5 & 4 & 5) are reproducible as sums of its rows, which is the only part of
the matrix this code is entitled to assert.

### `AssessmentMemo`
The render. Carries the memo header fields (reference number, date, To,
From, signatory) plus the projected criteria, matrix, analysis and
conclusion.

**Reference number.** Pre-filled with the fixed prefix `NAFDAC/PV/GCIOMS/`
and completed by the assessor at generation time — in the supplied example
they would type `455/III`. The number itself is **never generated**: it
belongs to NAFDAC's own registry sequence, and a system-invented reference
on a signed memo would be worse than an unfilled one. The prefix is
configuration, not a literal, so a directorate with a different prefix
changes a setting rather than the code.

## 6. The CIOMS rubric — provisional by design

Two statements in the example depend on a rubric nobody has supplied:

- *"The product has a **medium** efficacy score of 6"* — a band label over
  a total, with unknown boundaries.
- *"The critical adverse drug reaction risk profile is less than the
  epidemiology of the disease itself; a score of 5 & 4 & 5 … vs. a score of
  6"* → *"**Positive Benefit-Risk Balance**"* — reads like a general rule,
  but one example does not establish one.

Nor is the 0–3 scale documented. In the example
`Effectiveness → Incidence = 0` while its neighbours are 2–3, which cannot
be interpreted without the rubric.

**Design:**

```ts
interface CiomsRubric {
  provenance: string;       // where these values came from
  provisional: boolean;     // true until a NAFDAC document supplies them
  bands: { label: string; min: number; max?: number }[];
  verdictRule?: string;     // described, never silently applied
}
```

- Ships **provisional**, derived from the single Tramadol example, with
  `provenance` saying exactly that.
- The system **proposes** a band label and a verdict; the assessor must
  **confirm or override every time**. Neither is ever auto-accepted.
- While `provisional` is true, the memo records that a provisional rubric
  was used.
- Supplying a real rubric is a configuration change, not a code change.

This mirrors `AGE_GROUP_CODELIST` in `age-group.ts`, which ships
unconfigured for the same reason: a regulatory value whose provenance
cannot be stated should not be asserted.

**The difference from D.2.3:** that element is optional and can simply be
omitted. The CIOMS matrix cannot — it is the memo's conclusion. Hence
"provisional and always confirmed" rather than "absent".

## 7. Research flow

Two routes into an `EvidenceEntry`, both ending at an assessor:

**Retrieve.** For a criterion, the AI returns candidate entries each
carrying a citation. Shown as candidates. Accept / edit / reject. Nothing
unaccepted renders.

**Paste.** The assessor pastes their own text; the AI proposes which
criterion it belongs to with a confidence and a reason; the assessor
confirms or moves it. Same shape as the line-list column mapper
(`AI_MAPPING_CONFIDENCE_FLOOR`, provenance recorded per decision) — reuse
that pattern rather than inventing a second one.

**Criterion 9 is the special case.** It needs NAFDAC's own VigiFlow count
for the product and interval. Until programmatic access exists it is a
paste field that *names* VigiFlow as the expected source and records that
the figure was entered by hand. When access exists, it becomes a retrieval
with the national database as the cited source — and that is the one piece
of evidence in this document no MAH-side tool could ever produce.

## 8. Render

One `.docx`, reusing the existing `docx` builders:

- Page 1: memo header, forwarding sentence, signature block
- Hard page break
- Page 2+: product line, criteria table, CIOMS table, Analysis, Conclusion

Every rendered criterion cites its evidence. A criterion with no accepted
evidence renders as explicitly unestablished — never blank, for the same
reason `orNotStated()` exists in `screening-directive.ts`: a blank field
reads as NAFDAC's omission rather than a finding.

## 9. MAH feedback letter

Separate, advisory, no response deadline — distinct from the Review
Officer's screening directive, which does demand one.

Projected over findings where the MAH should have supplied something,
**including those NAFDAC resolved itself**. `externalise()` already
converts internal assessor wording into MAH-safe language.

`MAH_ONLY_DEFICIENCY_TYPES` in `finding-ownership.ts` survives: missing
section, missing information, incomplete, inconsistency, ambiguity,
unsupported claim is precisely "things only the MAH could have supplied".
Its **meaning shifts** from "who must act" to "mention in next-cycle
feedback".

## 10. Roles

| | Evaluator | Peer Reviewer |
|---|---|---|
| Add/accept evidence | Yes | Yes |
| Enter CIOMS scores | Yes | **Yes — may change** |
| Confirm band and verdict | Yes | Yes |
| Countersign | No | Yes |

The Peer Reviewer gaining edit rights is a **change to the role model** —
`workflow.ts` currently describes them as checking and signing off. Every
score change is audited with who and when, because a changed benefit-risk
input is exactly what someone will later ask about.

## 11. Behaviour this reverses

`psur.ts:1455` prints *"already resolved … are not restated in this
directive"*. Under decision (3) resolved findings **must** be restated in
MAH feedback. That line inverts.

## 12. Non-goals

- PSUR **authoring** for MAHs
- Replacing the screening checklist or the screening directive
- AI-drafted assessment prose (decision 2)
- Asserting a band label or benefit-risk verdict without confirmation
- A general multi-jurisdiction template engine

## 13. Open questions

1. The real CIOMS rubric — scale meaning, band boundaries, verdict rule.
   Until then §6 applies.
2. Programmatic VigiFlow access (§7).
3. Timeliness calibration. The example's interval ends 12 Nov 2024 and it
   was received 3 Sep 2026 — about 660 days after the data lock point, so
   screening item 8 computes NO against the 70/90-day rule. Either the rule
   is applied differently on this route, or that submission was very late;
   NAFDAC has not said which.

   **This does not block anything**, and an earlier draft of this document
   wrongly implied it might. Item 8 is one of the sixteen screening checks:
   a NO makes it one of the "N of 16 failing", and the screening outcome
   remains the Review Officer's explicit decision, never defaulted from the
   count (see `PsurAdministrativeScreening.outcome` — "Undefined until the
   officer actually decides"). So a late submission shows as a failing item
   and the officer still chooses whether it proceeds. Nothing needs
   changing unless NAFDAC says the window differs for this route.

## 14. Testing

- Criteria projection: each of the 11 renders from its source, and renders
  as unestablished when it has no accepted evidence.
- Evidence: an unaccepted candidate never renders; append-only is enforced;
  every rendered entry has a citation.
- CIOMS: totals are sums of their rows; the example's figures reproduce;
  no band or verdict is emitted unconfirmed; a provisional rubric is
  recorded as provisional.
- Feedback: a resolved finding still appears; `externalise()` leaves no
  internal wording.
- Roles: a Peer Reviewer score change is audited; an Evaluator cannot
  countersign.
- Render: one file, page break between memo and report, layout matching the
  supplied example.
