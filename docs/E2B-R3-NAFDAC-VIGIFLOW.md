# E2B(R3) for NAFDAC / VigiFlow — Architecture, Status, and Open Decisions

This document describes the rebuilt E2B(R3) pipeline in `src/services/e2b-r3/`,
its relationship to the still-live legacy generator (`src/services/api/e2b.ts`),
and exactly what remains blocked and why. It is written against two sources
of truth: the official ICH E2B(R3) ICSR schema package, and
`regulatory-assets/e2b-r3/Ondo_AEFI_E2B_R3_Developer_Spec.docx` (the
project-specific developer spec supplied by the user, referred to below as
"the Ondo spec"). Nothing in this document states or implies that NAFDAC or
VigiFlow has approved, accepted, or certified this pipeline — that has not
happened and cannot be claimed by this codebase.

## What "E2B(R3)" actually is here

- **Standard**: ICH E2B(R3) Implementation Guide, the current international
  format for exchanging Individual Case Safety Reports (ICSRs) with
  regulators and UMC's VigiFlow.
- **Real wire structure**: a nested HL7 v3 message — root
  `<MCCI_IN200100UV01>` transmission-acknowledgement wrapper containing one
  or more `<PORR_IN049016UV>` ICSR messages, namespace `urn:hl7-org:v3` —
  **not** the flat `<ichicsr><safetyreport>...` shape the original live
  generator produces (that shape is closer to E2B(R2)). Confirmed by direct
  inspection of the official ICH reference instance, not assumed.
- **Schema source**: `regulatory-assets/e2b-r3/official-ich/` — the official
  ICH ICSR XML Schema Set (v2.5), Reference Instances (v3.1), and Example
  Instances (v2.0), downloaded from FDA's published E2B(R3) guidance page.
  See `PROVENANCE.md` in that directory for exact source URLs, retrieval
  date, and checksums.

## Two pipelines currently exist in this repo

| | `src/services/api/e2b.ts` | `src/services/e2b-r3/` |
|---|---|---|
| Status | Live, wired to the `/e2b` page's download button | Not wired to any route yet |
| XML shape | Flat, E2B(R2)-like | Domain model only — no XML serializer yet |
| Patient privacy | Fixed this session (was exposing full names) | N/A — model stores only derived initials/nullFlavor |
| Purpose | Keep the shipped feature honest and non-harmful while the real rebuild is in progress | The actual E2B(R3)-conformant replacement, built to spec |

The old generator was not deleted or hidden — it's still what NAFDAC receives
today from this app if someone clicks Export. It was patched (commit
`b58477c`) to stop leaking patient names and to populate every real field
the source data actually supports, but it does not produce genuine E2B(R3)
XML and should not be described to anyone as such.

## New pipeline architecture (`src/services/e2b-r3/`)

```
RawLineListRow  →  mapRowToPVCase()  →  PVCase  →  validateBusinessRules() /
                       (mapping.ts)      (types.ts)   validateVigiFlowPreflight()
                                                            (validation.ts)
                                                                 │
                                                    splitIntoBatches()
                                                       (batching.ts)
                                                                 │
                                              [NOT YET BUILT: HL7 v3 serializer]
```

- **`types.ts`** — `PVCase`, the canonical domain model. Field names follow
  this codebase's convention, not E2B tag names — the XML shape is a
  serialization concern for a later stage, not baked into the model.
  Every field is annotated with the real E2B(R3) element number it will
  eventually serialize to (C.1.1, C.1.8.1, E.i.3.2a-f, G.k.1, H.1, etc.),
  taken from spec section 5 — never invented.
  - `RequiredValue<T>` forces every required-but-possibly-unknown element to
    carry an explicit HL7 nullFlavor (`NI`/`MSK`/`UNK`/`NA`/`ASKU`/`NASK`)
    instead of an empty string or a silent default.
  - `SeriousnessCriteria` (E.i.3.2a-f) lives on each `PVReaction`, not once
    per case — E2B(R3) has no case-level seriousness element, so the
    source's case-level "NON SERIOUS"/"SERIOUS" value cannot be safely
    decomposed into the six specific criteria without guessing which one(s)
    apply. That raw value is preserved on `PVCase.aggregateSeriousnessAsReported`
    for audit purposes but is never itself exported as a seriousness flag.
  - `OtherCaseIdentifiers` (C.1.9.1) is a discriminated union specifically so
    that "false" — which the spec confirms is not a legal E2B value for this
    element — cannot even be constructed by mistake.
- **`coding-provider.ts`** — the MedDRA/WHODrug coding boundary.
  `unlicensedMedDraProvider` / `unlicensedWhoDrugProvider` are the only
  implementations that exist; both mark every term `UNMAPPED` honestly. No
  dictionary is bundled, embedded, or ever will be — both are commercially
  licensed products (MedDRA via MSSO, WHODrug Global via UMC).
- **`mapping.ts`** — `mapRowToPVCase()` turns one already-column-mapped
  line-list row into a `PVCase`. Splits multi-value reaction/product cells
  ("8,19,21", "PENTA,IPV,PCV") into separate reaction/product records
  instead of collapsing them into one field. Fields gated on open decisions
  D1–D4 (see below) are populated with the spec's own documented interim
  option where one exists, or left explicitly unresolved otherwise — never
  defaulted on the mapper's own authority.
- **`validation.ts`** — two-level, fail-closed gate:
  - `validateBusinessRules()` — the required administrative element set
    named explicitly in spec sections 6.3 and 9 (C.1.1, C.1.3, C.1.5, C.1.7,
    C.1.8, C.2.r.3, C.3.2) plus the four minimum-content criteria
    (identifiable patient, identifiable reporter, ≥1 reaction, ≥1
    suspect/interacting product).
  - `validateVigiFlowPreflight()` — the stricter validated-import gate: a
    genuinely MedDRA-coded reaction and a genuinely WHODrug-coded
    suspect/interacting product, plus a captured reporter qualification.
  - `runPreflight()` — aggregates both across a batch of cases into a
    `PreflightSummary` with per-code counts and an overall
    `READY_FOR_VALIDATED_IMPORT` / `BLOCKED` status.
- **`batching.ts`** — splits at the ICSR-object level (never by slicing XML
  text) at the documented VigiFlow limit of 100 ICSRs per transmission file,
  matching the spec's own worked example (231 cases → 100/100/31).

## Honest current status

**Not yet built**: the HL7 v3 XML serializer (`PVCase` → real, schema-valid
E2B(R3) XML) and XSD validation wiring. This is deliberate — the nested
R-MIM structure is easy to get subtly wrong, and rushing it risks producing
something that *looks* like real E2B(R3) but silently fails VigiFlow import
or NAFDAC's own checks, which is worse than the current honest gap. Given
today's data, `runPreflight()` correctly reports every case as `BLOCKED`
regardless — no MedDRA/WHODrug provider is configured, so nothing is
actually ready for validated import yet.

**Tests**: 67 unit tests in `src/services/e2b-r3/` (mapping, validation,
batching) passing; full repo suite (125 tests, 7 files) unaffected.
`npx tsc --noEmit -p .` clean. `npm run build` succeeds.

## Open decisions (D1–D7) — from the Ondo spec, section 3

These require a decision from MedNova's leadership, Ondo State, and/or
NAFDAC/UMC — they are not something this codebase can resolve on its own,
and nothing below has been defaulted silently.

| ID | Decision | Status | Current pipeline behaviour |
|---|---|---|---|
| D1 | How is patient identity represented (initials vs. medical record number vs. nullFlavor)? | Interim: option (a) implemented | `mapRowToPVCase` derives initials ("ADEBOLA ESTHER" → "A.E.") when a patient identifier exists, since the spec itself lists this as a pre-approved option — not because D1 has been formally signed off |
| D2 | Who is the reporter (C.2.r.1 name), and how is `reporter_designation` bound to an Appendix I(F) qualification code? | **Unresolved** | `reporter.name` is always `{present:false, nullFlavor:"NASK"}` — the source column is a qualification ("CHEW"), not a name, so this is unresolved regardless of D2 |
| D3 | Report type (C.1.3) for routine AEFI surveillance — 1/3/4? | **Unresolved** | `reportType` is `{present:false, nullFlavor:"NASK"}` unless supplied via `MappingConfig.reportType`; every case is `BLOCKING` on `E2B-C1.3-UNRESOLVED` until this is set |
| D4 | Sender/receiver identifiers (C.3.2 and transmission-level identifiers), agreed bilaterally with NAFDAC | **Unresolved** | `senderOrganisation` is `undefined` unless supplied via `MappingConfig`; every case is `BLOCKING` on `E2B-C3.2-UNRESOLVED` until this is set |
| D5 | MedDRA subscription/version | **Unresolved** | `unlicensedMedDraProvider` marks every reaction `UNMAPPED` |
| D6 | Is WHODrug coding required by NAFDAC? (contact vigibase@who-umc.org) | **Unresolved** | `unlicensedWhoDrugProvider` marks every product `UNMAPPED` |
| D7 | Validated vs. non-validated VigiFlow import | Recommend validated | `validateVigiFlowPreflight` is built assuming validated import is the target; if non-validated is chosen instead, this gate can be relaxed |

## External dependencies

| Dependency | Status |
|---|---|
| Official ICH E2B(R3) schema package | Obtained — `regulatory-assets/e2b-r3/official-ich/` |
| Ondo AEFI reaction codebook (source category numbers → real terms) | **Not requested** |
| Ondo AEFI outcome codebook (raw source outcome codes) | **Not requested** |
| Batch/lot number data completeness | **Not requested** |
| MedDRA subscription (decision D5) | Not resolved |
| WHODrug Global subscription (decision D6) | Not resolved |
| NAFDAC sender/receiver identifiers (decision D4) | Not resolved |

## Limitations honestly carried into the model

- `dateOfCreation`, `dateFirstReceived`, and `dateMostRecentInfo` are all set
  to the pipeline's processing timestamp — the source line-lists have no
  "date received" column. This is a conservative stand-in, not a fabricated
  historical date, and is flagged here as a known gap to close if Ondo State
  ever supplies a real received-date column.
- `PVPatient.ageUnit` is left unset whenever the source doesn't state a unit
  — guessing years vs. months for pediatric AEFI data would be actively
  dangerous, not merely imprecise.
- `followUp.isFollowUp` is always `false` — this pipeline only handles
  first-time transmissions today; there is no follow-up source yet.
