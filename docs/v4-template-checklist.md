# V4 evaluation form — coverage checklist

Every item of the NAFDAC PSUR/PBRER Evaluation Form (V4)
(`docs/NAFDAC_PSUR_Template_V4_Proposed.docx`) and where it is answered in the
system. The V4 report (**Generate V4 Evaluation Report (Word)**, top of the
review and after Section 13) prints all of them in the template's layout.

The automated test `src/services/psur/v4-report.test.ts` › "the V4 template
checklist" checks that the report prints every one of the template's 172
headings, prompts, tick boxes and table labels (extracted from the template
file into `src/services/psur/v4-template-items.ts`).

Key:

- **AI pre-fill**: read from the PSUR by the AI and printed marked *not yet
  reviewed* until the evaluator reviews that section.
- **Research**: public-registry search, research added by hand, pasted
  research, or "Resolve with research" on a finding. Printed in the field with a
  numbered citation and listed under Section 13 References.
- **Panel**: where on the review page it is filled.

| Template item | Panel | AI pre-fill | Research |
|---|---|---|---|
| Page header (Annexure, SOP Ref No., Title) and footer | V4 evaluation report › Edit the page header and footer | — | — |
| **Administrative Completeness Check** (4 checks: Yes / No / N/A, Comment) | Administrative screening (Review Officer) | AI screening | — |
| **1.** Date of Review | Sections 1-8 › 1 table (automatic from the sign-off date unless entered) | — | — |
| **1.** Product / Strength / Dosage Form, MAH, NAFDAC Reg. No., Reporting Period, IBD, NBD | Sections 1-8 › 1 table (pre-filled from the administrative screening; the evaluator can correct any row) | AI screening | — |
| **1.** Therapeutic Indication(s) | Sections 1-8 › 1 table | — | — |
| **2.** Summarise regulatory actions … worldwide | Sections 1-8 › 2 | Yes | Yes (FDA labels, MHRA DSU) |
| **2.** ☐ Any action inconsistent with NAFDAC's current position? / If yes, explain | Sections 1-8 › 2 | — | Optional |
| **3.** Incidence and prevalence; Disease duration; Mortality and severity; Current treatment options; Quality-of-life impact | Sections 1-8 › 3 | Yes | Optional |
| **3.** Disease / Mortality / Severity table | Sections 1-8 › 3 (add rows) | Yes | — |
| **4.** RSI type and version; Changes made to the RSI; Rationale for the changes | Sections 1-8 › 4 | Yes | Yes (FDA labels, MHRA DSU) |
| **5.** Exposure table: Global / Nigerian / another region × interval / cumulative | Sections 1-8 › 5 | Yes | — |
| **5.** Patient years, patients, prescriptions, units, DDDs; Actions taken for safety reasons | Sections 1-8 › 5 | Yes | Optional |
| **6.** Briefly highlight studies with relevant safety information | Sections 1-8 › 6 | Yes | Yes (PubMed) |
| **7.** ☐ Attach or reproduce the MAH's summary tabulation of ADRs | Sections 1-8 › 7 | — | — |
| **7.** SOC / Event table (interval, cumulative, Nigerian cases, reviewer assessment) | Sections 1-8 › 7 (add rows) | Yes, except the reviewer assessment column | — |
| **7.** Differences between Nigeria-specific and global data | Sections 1-8 › 7 | Yes | Optional |
| **7.** ☐ Check VigiFlow … / VigiFlow findings | Sections 1-8 › 7 | No (VigiFlow is NAFDAC's own; entered by hand) | By hand, cited to VigiFlow |
| **8.** Signal Evaluation Log (7 columns), or "No signals under evaluation this interval" | Sections 1-8 › 8 (add rows) | Yes | — |
| **9.** Special populations table (8 areas × adequacy, comments) | 9. Special Populations (table) | AI review | — |
| **10.1** Key benefits table | 10. Benefit-Risk Assessment (table) | AI review | — |
| **10.2** Important identified / potential risks tables; Missing information table | 10. Benefit-Risk Assessment (three tables) | AI review | — (the Frequency cell names its data source) |
| **10.3** Integrated Benefit-Risk Effects Table (5 dimensions) | 10. Benefit-Risk Assessment (table) | AI review | — |
| **10.4** Patient / HCP perspective | 10. Benefit-Risk Assessment | AI review (never invented) | — |
| **10.5** Risk-minimisation effectiveness (5 ticks) and comment | 10. Benefit-Risk Assessment | AI review | — |
| **11.** Uncertainty ticks (7 categories, impact level, Other (specify)) | 11. Uncertainties | AI review | — |
| **11.** Addressed by the MAH? (Yes / Partially / No); Rationale; Evaluator's comments | 11. Uncertainties | AI review (comments: evaluator only) | — |
| **12.** Risk-minimisation considerations (10 ticks); Overall outcome (4 ticks) | 12. Regulatory Decision | AI suggestion shown separately; never pre-ticked | — |
| **12.** Regulatory action and basis; Specific finding; Next PSUR due date; Follow-up information / deadline | 12. Regulatory Decision | — | — |
| **13.** Conclusion; Reviewer confidence (3 ticks); References | 13. Conclusion & Sign-off | — | References also list every cited source |
| **13.** Evaluator's name, signature, date; Peer reviewer's name, signature, date | 13. Conclusion & Sign-off | — | — |

Every section 1-8 also carries the reviewer's assessment of the section (AI
draft until reviewed) and the section's accepted findings, marked resolved
by NAFDAC where they were.

## Review findings

An accepted finding is resolved where its section is answered:

- **Sections 2, 3, 4, 6 and 7** (answered from outside the submission):
  **Resolve with research**. The answer goes into the template prompt chosen
  for it, with its citation.
- **Every other section** (the administrative check, Section 1, exposure,
  signals, Sections 9-13): **Fix on the form**. The evaluator corrects the
  section on the form and records what was corrected.

Either way the finding stays listed, shows as resolved by NAFDAC under its
section in the V4 report, and appears on the MAH feedback letter as
resolved by NAFDAC.

## Not printed in the V4 report, by design

- The AI's Section 12 suggestion: advice to the evaluator, never part of
  the decision.
- The assessment memo's own inputs (memo details, criteria 1-6, Yes/No
  answers, criterion 11's risks and research, the CIOMS matrix). They print
  in the memo.
- The administrative screening's directive fields. They print in the
  Compliance Directive.
