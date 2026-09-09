# E2B(R3) Field-Level Data Mapping

Source → normalized (`PVCase`) → E2B(R3) element mapping for the
`src/services/e2b-r3/` pipeline, derived from `mapping.ts` and section 5 of
`regulatory-assets/e2b-r3/Ondo_AEFI_E2B_R3_Developer_Spec.docx`. The XML
serializer that would consume the rightmost column does not exist yet (see
`docs/E2B-R3-NAFDAC-VIGIFLOW.md`) — this table documents the mapping
contract it will implement, and what's already enforced in the normalized
model today.

## Case-level

| Source field | Normalized field (`PVCase`) | E2B(R3) element | Required? | Transformation | Validation |
|---|---|---|---|---|---|
| `case_id` | `sendersCaseId` | C.1.1 | Yes | Trimmed; falls back to `${jobId}-${sourceRow}` if blank | `E2B-C1.1-MISSING` if still empty |
| — (derived) | `worldwideUniqueId` | C.1.8.1 | Yes | Equal to `sendersCaseId` at first creation (spec 5.2) — no follow-up source exists yet, so this pipeline only ever creates first transmissions | `E2B-C1.8-MISSING` |
| — (constant) | `firstSenderOfCase` | C.1.8.2 | Yes | Always `"2"` (Other) — MedNova reports on behalf of the facility, not as the regulator | — |
| Mapping config (decision D3) | `reportType` | C.1.3 | Yes | `RequiredValue`; `NASK` until `MappingConfig.reportType` is supplied | `E2B-C1.3-UNRESOLVED` (BLOCKING) while unresolved |
| — (processing time) | `dateOfCreation`, `dateFirstReceived`, `dateMostRecentInfo` | C.1.2 / C.1.4 / C.1.5 | Yes | All set to the pipeline's processing timestamp — no source "date received" column exists (documented limitation) | `E2B-C1.5-MISSING` (should never fire from the mapper) |
| — (constant) | `additionalDocumentsAvailable` | C.1.6.1 | Yes | Always `false` — no document-listing source yet | — |
| — (not inferred) | `fulfilsExpeditedCriteria` | C.1.7 | Yes | `RequiredValue`; always `NASK` — a genuine clinical/regulatory determination, never inferred from seriousness | `E2B-C1.7-UNRESOLVED` (BLOCKING) |
| — (constant) | `otherCaseIdentifiersInPreviousTransmissions` | C.1.9.1 | Yes | Always `{present:false, nullFlavor:"NI"}` — type makes "false" structurally unrepresentable | — |
| — (constant) | `followUp.isFollowUp` | C.1.10.1 | Yes | Always `false` (no follow-up source today) | — |
| `reporter_designation` | `reporter.qualificationVerbatim` | C.2.r.4 (verbatim) | Recommended | Trimmed pass-through | `VIGIFLOW-REPORTER-QUALIFICATION-MISSING` if absent |
| — (not resolved) | `reporter.name` | C.2.r.1 | Recommended | Always `{present:false, nullFlavor:"NASK"}` — source column is a qualification, not a name (decision D2) | Contributes to `E2B-REPORTER-MISSING` only if qualification is also absent |
| Mapping config (decision D4) | `senderOrganisation` | C.3.2 | Yes | `undefined` until `MappingConfig.senderOrganisation` supplied | `E2B-C3.2-UNRESOLVED` (BLOCKING) while unresolved |
| `seriousness` | `aggregateSeriousnessAsReported` | *(not exported directly)* | — | Verbatim pass-through, preserved for audit only | Never itself becomes an E2B seriousness flag |

## Patient (D.1)

| Source field | Normalized field | E2B(R3) element | Required? | Transformation | Validation |
|---|---|---|---|---|---|
| `patient_identifier` | `patient.identity` | D.1 | Yes (≥1 identity element) | `deriveInitials()`: "ADEBOLA ESTHER" → "A.E." (decision D1, option (a)); `{present:false, nullFlavor:"UNK"}` if source is blank | `E2B-PATIENT-MISSING` (BLOCKING) if unresolved |
| `sex` | `patient.sex` | D.5 | No | `M`/`MALE`→`MALE`, `F`/`FEMALE`→`FEMALE`, else `undefined` | — |
| `age` | `patient.age` | D.2.1 | No | Verbatim pass-through | — |
| — (not stated) | `patient.ageUnit` | D.2.2a | No | Always `undefined` — source never states a unit; guessing years vs. months is unsafe for pediatric AEFI data | Flagged `REQUIRES_REVIEW` when `age` present but `ageUnit` absent |

## Reaction/event (E.i) — one `PVReaction` per split value

| Source field | Normalized field | E2B(R3) element | Required? | Transformation | Validation |
|---|---|---|---|---|---|
| `reaction` | `reactions[].reaction` (`CodedTerm`) | E.i.1.1a (verbatim) / E.i.2.1b (coded) | Yes (≥1) | `splitMultiValue()` splits "8,19,21" into 3 reactions, each coded independently via `MedDraCodingProvider` — today always `UNMAPPED` | `E2B-REACTION-MISSING` if none; `VIGIFLOW-MEDDRA-MISSING` (BLOCKING) if uncoded |
| `onset_date` | `reactions[].onsetDate` | E.i.4 | No | `parseSourceDate()` → ISO 8601, or omitted (never guessed) | `E2B-REACTION-DATE-UNPARSEABLE` (WARNING) if unparseable |
| `outcome` | `reactions[].outcome` / `.outcomeUnmapped` | E.i.7 | Recommended | Matches this app's normalized outcome vocabulary only; a raw Ondo source code is recorded as `outcomeUnmapped`, never reinterpreted | `E2B-OUTCOME-UNMAPPED` (BLOCKING) when unmapped |
| — (not decomposable) | `reactions[].seriousnessCriteria` | E.i.3.2a-f | Yes (per reaction) | Always `{}` — the source's case-level aggregate value cannot be safely decomposed into the six specific criteria without guessing which apply | Left empty deliberately; not currently validated as a gap (see NAFDAC-VIGIFLOW doc) |

## Product (G.k) — one `PVProduct` per split value

| Source field | Normalized field | E2B(R3) element | Required? | Transformation | Validation |
|---|---|---|---|---|---|
| `product` | `products[].product` (`CodedTerm`) | G.k.2.2 (verbatim) / G.k.2.1.1b (coded) | Yes (≥1 suspect/interacting) | `splitMultiValue()` splits "PENTA,IPV,PCV" into 3 products, each coded independently via `WhoDrugCodingProvider` — today always `UNMAPPED` | `E2B-PRODUCT-MISSING` if none suspect/interacting; `VIGIFLOW-WHODRUG-MISSING` (BLOCKING) if uncoded |
| — (constant) | `products[].characterization` | G.k.1 | Yes | Always `"SUSPECT"` — this AEFI/vaccine dataset has no concomitant/interacting concept | — |
| `vaccine_batch` | `products[].batchNumber` | G.k.4.r.7 | No | Verbatim pass-through | — |
| `dose` | `products[].dose` | G.k.4.r.10.2 | No | Verbatim pass-through | — |
| `vaccination_date` | `products[].startDate` | G.k.4.r.4 | No | `parseSourceDate()` → ISO 8601, or omitted | — |

## Multi-value splitting rule (`splitMultiValue`)

Applies identically to `reaction` and `product`: splits on comma, semicolon,
or the word "and" (case-insensitive) with no ambiguity flag. A dot-separated
list (e.g. `"8.19.21"`) is also split, but flagged `ambiguous: true` and
surfaced as a `MappingWarning`, since a lone decimal point could equally be
part of a single value (e.g. a `0.5` dose) — this is never silently trusted.

## What "coded" means today

Every `CodedTerm` produced by this pipeline currently has `status: "UNMAPPED"`
and `mappingMethod: "NONE"` — there is no licensed MedDRA or WHODrug provider
wired in (decisions D5/D6, see `docs/E2B-R3-NAFDAC-VIGIFLOW.md`). The
`sourceValue` (the raw Ondo code or vaccine name) is always preserved
verbatim regardless of coding status, per spec 5.6 — normalization must never
overwrite it.
