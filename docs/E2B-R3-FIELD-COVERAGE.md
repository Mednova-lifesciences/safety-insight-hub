# E2B(R3) source field coverage

What a source column becomes, where it ends up, and — where it ends up
nowhere — why.

This is the inventory §22 of the source-mapping hardening task asks for.
It describes the code as it actually is; every row was checked against
`src/services/e2b-r3/` and against XML that the ICH schema set validates.
If you change the pipeline, change this table in the same commit.

Three things are worth reading before the table:

- **Header spellings are not listed exhaustively, on purpose.** The header
  normalizer (`mapColumnsByKeywords` in `src/services/api/tabular-parse.ts`)
  lowercases, folds diacritics and strips every non-alphanumeric character
  before matching. `Pt. Sex`, `PATIENT_SEX`, `Patient's Sex` and
  `Sex of Patient` are therefore all the substring `sex` by the time the
  keyword table sees them. The "source variants" column names the
  *distinct* spellings that need their own entry, not every way a person
  can type one.
- **A header a rule cannot settle goes to the AI, and an AI that cannot
  settle it returns null.** The resolution order is: explicit source
  profile mapping → deterministic keyword rule → AI semantic mapping above
  the 0.6 confidence floor (`AI_MAPPING_CONFIDENCE_FLOOR`) → unmapped and
  reported. Nothing guesses at the end of that chain.
- **Optional means optional.** A column that is absent produces no model
  field, no XML element, and no warning. Warnings are for uncertainty, not
  for absence.

## Patient and case identity

| Concept | Source variants that need their own rule | Canonical field | Model field | E2B(R3) | Conf. | Method | Serializer |
|---|---|---|---|---|---|---|---|
| Case identifier | Case ID, Case No, Case Number, Case Ref, Report ID, Report No, Other report id | `case_id` | `PVCase.sendersCaseId`, `.caseSafetyReportId` | C.1.1, C.1.8.1 | Required | rule/AI | **Emitted verbatim.** A source-supplied identifier is exported exactly as written — no country, organisation, regulator or configured prefix is added. Only a row with *no* identifier of its own gets the generated `NG-MEDNOVA-…` form. See `case-identifier.ts`. |
| Patient name / initials | Patient Name, Patient Initials, Initials, Name of Patient, Patient | `patient_identifier` | `PVPatient.identity` | D.1 | One of D.1 / D.1.1 | rule/AI | `<name>` — full names are reduced to initials by `deriveInitials`. |
| Patient record number | Hospital Number, Hospital No, MRN, Medical Record Number, Record Number, GP/Specialist Record Number, Folio Number, Card Number, Registration Number | `patient_id` | `PVPatient.recordNumbers[]` | D.1.1.1–D.1.1.4 | Optional | rule/AI + explicit source classification | `<asIdentifiedEntity>` with the OID for the record's source. **Requires** a decided source (GP/specialist/hospital/investigation); an undecided number is held, never defaulted to D.1.1.3. |

Four things are explicitly prevented from becoming a patient record
number, in both the keyword table and the AI prompt: the case/report
number, anything identifying the reporter, a batch/lot number, and a
product code.

## Patient demographics

| Concept | Source variants | Canonical field | Model field | E2B(R3) | Conf. | Method | Serializer |
|---|---|---|---|---|---|---|---|
| Sex | Sex, Gender (plus every spacing/punctuation variant) | `sex` | `PVPatient.sex` | D.5 | Optional | rule/AI | `<administrativeGenderCode>` on ISO 5218 (OID `1.0.5218`): `1` male, `2` female, `0` reported-unknown. Omitted entirely when absent. |
| Sex, unrecognised value | — | `sex` | `PVPatient.sexVerbatim` | — | — | — | **Not emitted.** The source's words are kept and a `E2B-D5-UNRECOGNISED` WARNING is raised. Never guessed, and never inferred from a name, title, initials or age. |
| Age | Age, Patient Age, Age at Onset, Age at Reaction, Age at Event, Age (years) | `age` | `PVPatient.age` | D.2.2a | Optional | rule/AI | `<value xsi:type="PQ" value="…">` |
| Age unit | Age Unit, Age Units, Unit of Age; also a unit written inside the age cell (`18 months`, `3yrs`); also a profile-declared `SourceProfile.ageUnit` | `age_unit` | `PVPatient.ageUnit` | D.2.2b | Conditional | rule/AI + `splitAgeValue` | `unit="…"` as the **ICH-constrained UCUM symbol** (`a`, `mo`, `wk`, `d`, `h`), never the internal E2B code. `PQ/@unit` is typed `cs` and documented as UCUM in `coreschemas/datatypes-base.xsd`. |
| Age unit, not stated | — | — | `PVPatient.ageUnitAssumed` | — | — | deterministic default | Defaults to **years**, flags the assumption, raises a non-blocking `E2B-D2.2B-UNIT-ASSUMED` WARNING, and **does not block** import or export. |
| Date of birth | DOB, Date of Birth, Birth Date, Patient DOB, Date Born | `date_of_birth` | `PVPatient.dateOfBirth` | D.2.1 | Optional | rule/AI | `<birthTime value="YYYYMMDD"/>`. Never computed from an age; an age is never computed from it. |
| Age group | Age Group, Age Band, Age Category, Age Range | `age_group` | `PVPatient.ageGroupVerbatim` | D.2.3 | Optional | rule/AI | **Not emitted — see below.** |

### Why D.2.3 is carried but not emitted

ICH puts the patient age group on its own codelist, OID
`2.16.840.1.113883.3.989.2.1.1.9` — confirmed present in the ICH reference
instance shipped under `regulatory-assets/e2b-r3/official-ich/`. What is
*not* anywhere in this repository is that codelist's values, or the age
boundaries between its groups. They are not in the official ICH package,
not in the XML schema set, and not in the developer spec, which records
only that D.2.3 is Optional.

Emitting D.2.3 would therefore mean inventing both the numeric codes and
the boundaries that assign a patient to one. Deriving a group from an age
would mean inventing the boundaries alone. Either is a clinical claim the
pipeline has no basis for, so neither happens: an age group the source
states is preserved verbatim for review, and nothing goes on the wire.

**To switch it on:** supply the ICH D.2.3 codelist and its boundaries as
configuration, then map `ageGroupVerbatim` (and/or a derivation from
`age` + `ageUnit`) onto it and add the `ageGroup` observation — the
sibling of the existing `age` observation, `code="4"` on code system
`…2.1.1.19`, with a `CE` value on `…2.1.1.9`.

## Clinical and event data

| Concept | Source variants | Canonical field | E2B(R3) | Conf. | Serializer |
|---|---|---|---|---|---|
| Reaction (words) | Reaction, Adverse Event, AE Term, Reported Term, Verbatim Term, Preferred Term, Side Effect, Symptom, Complaint, Adverse Drug Reaction | `reaction` | E.i.1.1a | Required | Verbatim in `<originalText>`; the MedDRA code is `nullFlavor="UNK"` until a licensed provider is configured. A source category number is never treated as a MedDRA code. |
| Reaction (local code) | Reaction Code, AEFI Code, Adverse Event Code | `reaction_code` | E.i.1.1a via the source codebook | Required | Decoded through the profile's codebook first; an unknown code quarantines rather than falling through. |
| Onset date | Date of Onset, Onset Date, Date of Symptom Onset, Event Date, Date Started | `onset_date` | E.i.4 | Optional | `<effectiveTime><low>`; omitted when absent. |
| Onset interval | Onset Time Interval, Time to Onset | `onset_interval` | — | — | Used to derive `onset_date`; a duration is never stored as a date. |
| Outcome | Outcome, Resolution | `outcome` | E.i.7 | Required | Always emitted, on ICH codelist `…2.1.1.11`; an empty cell becomes `0` (Unknown) rather than no element. |
| Seriousness | Seriousness, Serious | `seriousness` | E.i.3.2a–f | Required | Per reaction, never once per case. Unstated criteria carry `nullFlavor="NI"`. |
| Seriousness criterion code | Seriousness Code, AEFI Type, `serious` + `code` compound | `serious_code` | E.i.3.2a–f | Optional | Through the profile's own mapping only; never guessed. |
| Reaction country | Reaction Country, Country of Event, Country of Occurrence | `reaction_country` | E.i.9 | Optional | `<locatedPlace>` on `1.0.3166.1.2.2`; only ever what the source says, with no fallback, and it never influences C.1.1. |

## Product

| Concept | Source variants | Canonical field | E2B(R3) | Conf. | Serializer |
|---|---|---|---|---|---|
| Product / vaccine | Vaccine, Vaccine Name, Drug Name, Suspect Product, Medication, Product | `product` | G.k.2.2 | Required | `<name>`; the WHODrug code is `nullFlavor="UNK"` until a provider is configured. |
| Batch / lot | Batch, Batch No, Batch Number, Lot, Lot No, Lot Number, Vaccine Batch | `vaccine_batch` | G.k.4.r | Optional | `<lotNumberText>`; preserved exactly as the source wrote it. |
| Administration date | Date of Vaccination, Vaccination Date, Immunization/Immunisation Date, Date of Last Immunization | `vaccination_date` | G.k.4.r | Optional | `<effectiveTime><low>` on the substance administration. |
| Dose | Dose, Dose No, Dose Number, Dose Administered, Dosage | `dose` | G.k.4.r | Optional | Carried on the model. |

## Reporter and case administration

| Concept | Source variants | Canonical field | E2B(R3) | Conf. | Serializer |
|---|---|---|---|---|---|
| Reporter name | Reporter Name, Name of Reporter, Reported By, Notified By | `reporter_name` | C.2.r.1 | Required | `<name><family>`; `nullFlavor="NASK"` when absent. |
| Reporter designation | Reporter Designation, Reporter Role, Designation | `reporter_designation` | C.2.r.4 | Required | Verbatim always; the ICH qualification code **only** via the profile's `reporterQualificationMap`. A free-text title is never assigned a code by guessing. |
| Reporter country | Reporter Country, Country of Primary Source, Reporting Country | `reporter_country` | C.2.r.3 | Required | `<locatedPlace>` on `1.0.3166.1.2.2`. Resolution order: the row, then the profile, then the application's NG fallback. |
| Reporter phone | Reporter Phone, Telephone, Contact Number, Mobile Number | `reporter_phone` | C.2.r.2 | Optional | **Model only** — the serializer builds no contact block yet. |
| Report date | Date Reported, Report Date, Date Received, Date of Notification | `report_date` | C.1.4, C.1.5 | Required | `<effectiveTime><low>` and `<availabilityTime>`; falls back to the processing date. |

### A bare "Reporter" column is deliberately left to the AI

Real AEFI line lists head one column `Reporter` and fill it with *roles*
(`Nurse`, `CHEW`, `Doctor`); others fill the identically-headed column
with a person's name. The header alone cannot distinguish them, and
guessing either way causes a specific harm: a job title exported as a
reporter's name, or a real name filed as a qualification. The keyword
table therefore maps a bare `Reporter` to nothing and lets the AI mapper
decide from the sample values. `Reporter Name` and `Reporter Designation`
still map deterministically.

## Concepts with no E2B destination in this implementation

Recorded so that "not implemented" is never mistaken for "lost":

- **Reporter facility, address, email** — no contact block is serialized.
- **Patient address** — not modelled.
- **Medical history, narrative/remarks** — no model field today; the
  narrative element carries a placeholder.
- **Reaction end date, date of death** — `<deceasedTime>` (D.9.1) exists
  in the ICH reference instance but is not built here.
- **Parent-child (D.10)** — out of scope.
- **Reporter identifier** — ICH E2B(R3) defines no such element. UMC
  documentation names a "reporter identifier" but does not map it to an
  E2B element, so nothing is invented for it.

## Anti-fabrication rules, and where they are enforced

Each of these has a test in
`src/services/e2b-r3/patient-demographics.test.ts`,
`source-to-xml-coverage.test.ts` or `case-identity.test.ts`:

| Never | Enforced by |
|---|---|
| Invent a case identifier | `resolveCaseSafetyReportId` returns the source value or a generated one built from the job and row |
| Prefix a source case identifier | `case-identity.test.ts` asserts no `NG-`, `NAFDAC`, `MEDNOVA` fragment survives |
| Infer sex from a name, title, initials or age | `mapSex` consults only the profile's `sexMap` and a fixed word list |
| Invent an age | `splitAgeValue` returns the cell untouched when it is not a number |
| Compute a date of birth from an age, or an age from a date of birth | Each is read from its own column only |
| Derive an age group | Not implemented, for the reason above |
| Generate a hospital number | `recordNumbers` is populated only from `patient_id` |
| Use a reporter's designation as their name | Separate canonical fields, separate keyword tables, separate AI rules |
| Assign a MedDRA/WHODrug code without a provider | `CodingStatus.PROVIDER_UNAVAILABLE` and `nullFlavor="UNK"` |
| Assign an ICH qualification code by guessing | Profile `reporterQualificationMap` only |

## Verification

- `npx vitest run` — 1051 tests, 58 files.
- `npx tsc --noEmit` — clean.
- ICH XSD: every file in `artifacts/e2b-r3/` validates against
  `multicacheschemas/MCCI_IN200100UV01.xsd` from
  `regulatory-assets/e2b-r3/official-ich/ICH_ICSR_XML_Schema_Set_v2.5.zip`,
  including `test-demographics-coverage.xml`, which is written precisely
  so that `<birthTime>` and a non-year age unit are schema-checked.

XSD validity is not regulatory acceptance. No VigiFlow import has been
performed, so nothing here claims VigiFlow accepts these files.
