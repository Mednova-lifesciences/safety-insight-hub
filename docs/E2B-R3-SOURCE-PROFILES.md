# Source Profile Architecture

The E2B(R3) engine (`mapping.ts`, `validation.ts`, `serializer.ts`,
`batching.ts`) never knows which real-world line list produced a case.
Every source-specific assumption — column names, local codebooks,
delimiter conventions, reporter-designation vocabulary, case-id
conventions — lives in a **Source Profile**
(`src/services/e2b-r3/source-profiles/`). This is the architectural
boundary the rest of the pipeline is built against:

```
Line List
    ↓
Source Profile        <- everything source-specific lives here
    ↓
Canonical PV Case      <- mapping.ts, source-agnostic
    ↓
E2B(R3) Validation     <- validation.ts, source-agnostic
    ↓
E2B(R3) XML Serializer <- serializer.ts, source-agnostic
    ↓
VigiFlow / NAFDAC import
```

Proven, not just asserted: `source-agnosticism.test.ts` runs a second,
wholly synthetic source profile (different column names, a different
multi-value delimiter, a different reporter-designation vocabulary, and
its own populated reaction codebook) through the exact same engine
functions used for Ondo — and grep-asserts that `mapping.ts`,
`validation.ts`, `serializer.ts`, and `batching.ts` contain no hardcoded
conditional keyed on a specific source profile.

## 1. How Source Profiles work

A `SourceProfile` (`source-profiles/types.ts`) is a plain, statically
defined object with:

- **Identity**: `id`, `name`, `sourceVersion`, `effectiveDate`, `country`, `timezone`.
- **`columnMap`**: canonical field name -> this source's actual column
  name (e.g. Ondo's `reaction` column vs. a hypothetical Facility B's
  `event_category` column both map to the engine's canonical `reaction`
  field).
- **`reactionDelimiter`**: the exact separators this source uses for
  multi-value fields (e.g. `[",", ";", " AND "]` for Ondo, `["|"]` for a
  pipe-delimited source). Anything not in this list is never guessed —
  see "How quarantine works" below.
- **`reactionCodebook`**: a versioned map from this source's local
  reaction/adverse-event codes to their real terms (see below).
- **`reporterQualificationMap`**: this source's free-text reporter
  designations (e.g. "CHEW", "Doctor") -> one of the five ICH Appendix
  I(F) qualification codes.
- **`outcomeMap` / `seriousnessMap` / `sexMap`** (optional): source-specific
  vocabulary overrides, consulted before the engine's built-in default
  word recognition.
- **`caseIdPrefix`**: used only when a row has no case id of its own.

## 2. How to add a new line-list source

1. Create `source-profiles/<your-source-id>.ts` exporting a `SourceProfile`
   object. Fill in `columnMap` against that source's actual column
   headers — nothing else changes.
2. Register it in `source-profiles/registry.ts`.
3. That's it. `mapping.ts`, `validation.ts`, `serializer.ts`, and
   `batching.ts` require zero changes — if adding your source requires
   touching any of those files, the abstraction boundary has been
   violated and something is wrong.

This applies to future states, facilities, programs, spreadsheets, or
ODK/DHIS2 exports alike.

## 3. How to define a local reaction codebook

A `ReactionCodebook` (`source-profiles/types.ts`) is:

```ts
{
  sourceId: "ondo-aefi",
  field: "reaction",
  version: "2026",
  entries: {
    "19": { localCode: "19", sourceTerm: "<real term from the official codebook document>", effectiveFrom: "2026-01-01" },
    // ...
  },
}
```

**`entries` must only ever be populated from a real, authoritative
codebook document supplied by the source's own data owner** (for Ondo:
the Ondo State AEFI/immunisation focal person or DSNO). This codebook
must never be inferred, guessed, or reverse-engineered from the numeric
values themselves — `19 = fever` is exactly the kind of fabrication this
architecture exists to prevent. `ondoAefiProfile.reactionCodebook.entries`
ships **empty** today because that document has never been supplied; every
real Ondo reaction code therefore quarantines as `UNKNOWN_CODE` until it
is.

## 4. How codebook versions work

Every `ReactionCodebook` carries its own `version` string, independent of
the `SourceProfile.sourceVersion`. A `SourceReactionDecoding` (the result
of decoding one local code) records exactly which `sourceProfileId` and
`codebookVersion` produced it — full traceability for audit, and so a
future codebook update doesn't silently reinterpret historical exports.

## 5. How reporter designation mappings work

`SourceProfile.reporterQualificationMap` maps a source's free-text
reporter designation (matched case-insensitively) to one of the ICH
Appendix I(F) codes: `1`=Physician, `2`=Pharmacist, `3`=Other health
professional, `4`=Lawyer, `5`=Consumer or other non-health professional.
Ondo's profile ships with the categories MedNova supplied:

| Designation examples | Code |
|---|---|
| Doctor, Medical Officer, Physician | 1 (Physician) |
| Pharmacist | 2 (Pharmacist) |
| Nurse, Midwife, CHEW, CHO, JCHEW, Vaccinator | 3 (Other health professional) |
| Patient, Parent, Caregiver, Community Informant | 5 (Consumer/non-health professional) |

A designation with no entry (e.g. the real Ondo dataset's "DSNO", "SMO",
"Registered Nurse" — a different string than "Nurse") is **never guessed**
— it's left unresolved and blocks validated export
(`E2B-REPORTER-QUALIFICATION-UNRESOLVED`).

## 6. How product Option A works

MedNova's business decision: WHODrug coding is **not** required to export
a product. `PVProduct.product` (`WhoDrugCodedProduct` in `types.ts`)
always carries the reported/verbatim product name (`sourceValue`)
regardless of coding status; `serializer.ts` always emits it, and
`validateVigiFlowPreflight` treats an uncoded product as `INFO` severity
(`VIGIFLOW-WHODRUG-OPTION-A-INFO`), never `BLOCKING`. No fabricated
WHODrug identifier, MPID, or RID is ever emitted — those fields on
`WhoDrugCodedProduct` stay `undefined` until a real provider populates
them.

## 7. How WHODrug can be added later (Option B)

Implement `WhoDrugCodingProvider.resolveProduct()` (`coding-provider.ts`)
against a real WHODrug Global C3 licence, or supply a table to
`AuthorizedMappingTableWhoDrugProvider`. Nothing else changes — `mapping.ts`,
`validation.ts`, and `serializer.ts` already handle a `MAPPED` product with
`mpid`/`substanceId`/`strength`/`pharmaceuticalForm`/`rid` correctly; they
just haven't had a real provider to receive that data from yet.

## 8. How MedDRA provider integration works

`MedDraCodingProvider` (`coding-provider.ts`): `getVersion()`,
`resolveReaction(verbatimText)`, `resolvePreferredTerm(lltCode)`.
`unavailableMedDraProvider` is the only implementation wired in today —
every reaction reports `PROVIDER_UNAVAILABLE`, honestly. **MedDRA coding
is only ever attempted on a `DECODED` source term** — never on a raw local
code. `AuthorizedMappingTableMedDraProvider` exists for a licensed-table
integration path; no table is populated in this codebase.

## 9. How sender/receiver configuration is supplied

`E2bTransmissionConfig` (`transmission-config.ts`): `environment`
("uat"/"production"), `sender` (`organization`, `type`, `address`, `phone`,
`email`, `personResponsible`, `identifier`), `receiver` (`organization`,
`identifier`), `reportType`. The shipped `UNCONFIRMED_DEFAULT_CONFIG` uses
an explicit sentinel for every identifier — `isTransmissionConfigConfirmed()`
returns `false` until real values (agreed bilaterally with NAFDAC/UMC —
decision D4) replace it. No real NAFDAC/VigiFlow/MedNova ID is hardcoded
anywhere in this codebase.

## 10. How report type / configuration is supplied

`E2bTransmissionConfig.reportType` (decision D3). Bundled with the same
confirmation gate as sender/receiver, since both come from the same
NAFDAC/Ondo/MedNova sign-off — `PVCase.reportType` stays `{present:false}`
until the whole transmission config is confirmed, never defaulted.

## 11. What blocks validated VigiFlow export

Two independent gates, both required:

1. **`runPreflight()` status is `READY_FOR_VALIDATED_IMPORT`** — every case
   passes `validateSourceDecoding` + `validateBusinessRules` +
   `validateVigiFlowPreflight` (MedDRA-coded reaction required; WHODrug is
   informational only, per Option A).
2. **`isTransmissionConfigConfirmed()` is `true`** — real sender/receiver
   identifiers are configured.

The UI shows `READY_FOR_VALIDATED_IMPORT` only when BOTH hold — never for
"XSD-valid" alone (see `docs/E2B-R3-NAFDAC-VIGIFLOW.md`'s repeated
distinction between technical validity and VigiFlow acceptance).

## 12. Three distinct concepts — never conflated

| Concept | Example | Where it lives |
|---|---|---|
| Local source code | Ondo's `"19"` | `PVReaction.sourceDecoding.localCode` |
| Source decoded term | The real term `"19"` maps to, once a codebook entry exists | `PVReaction.sourceDecoding.sourceTerm` |
| MedDRA code | A licensed dictionary's LLT code for that decoded term | `PVReaction.reaction.code` (only when `status === "MAPPED"`) |
| WHODrug code | A licensed WHODrug Global C3 identifier for a product | `PVProduct.product.mpid`/`.code` (only when `status === "MAPPED"`) |

A local code is **never** written directly into a MedDRA/WHODrug coded
field, at any layer.

## 13. How quarantine works

`decodeReactionField()` (`mapping.ts`) produces one
`SourceReactionDecoding` per value, with `status`:

- `DECODED` — the profile's codebook has a real entry.
- `UNKNOWN_CODE` — the codebook was consulted, no entry exists. Blocks
  validated export (`E2B-REACTION-CODEBOOK-UNRESOLVED`, `BUSINESS_RULE`
  layer) — MedDRA coding is never attempted on it.
- `BLANK` — the reaction field was empty (surfaces as
  `E2B-REACTION-MISSING` since the case then has zero reactions).
- `DELIMITER_QUARANTINED` — the raw field couldn't be confidently split
  using the profile's configured separators (e.g. a bare `.` in Ondo's
  data, which has no configured `.` delimiter) and wasn't a plain decimal
  either. The **whole raw field** is quarantined as one unresolved value —
  never guessed at. Blocks validated export
  (`E2B-REACTION-DELIMITER-QUARANTINED`).

## 14. How to run the tests

```
npm run test                          # full suite
npx vitest run src/services/e2b-r3/   # just the E2B(R3) engine + profiles
```

Key files: `source-agnosticism.test.ts` (the architectural acceptance
test), `mapping.test.ts` (codebook decode/quarantine, reporter mapping),
`validation.test.ts` (WHODrug Option A non-blocking, business rules),
`ondo-real-data.test.ts` (the real 231-row dataset, exact diagnostic
report), `legacy-isolation.test.ts` (production export never calls the
legacy generator), `transmission-config.test.ts`.

XSD validation of generated artifacts is run separately via `lxml`
(Python) against the official ICH schema in
`regulatory-assets/e2b-r3/official-ich/` — see
`docs/E2B-R3-NAFDAC-VIGIFLOW.md` for the exact commands and results.

**This application does not infer local safety codes.** An unrecognised
local reaction code, an unmapped reporter designation, or an ambiguous
multi-value field always quarantines/blocks rather than guessing — this
is true by construction, not by convention, and is exercised by the tests
listed above.
