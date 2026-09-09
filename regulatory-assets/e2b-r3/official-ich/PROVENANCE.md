# Provenance — Official ICH E2B(R3) ICSR Package

These files are the **unmodified, official** ICH E2B(R3) Individual Case Safety
Report (ICSR) implementation package, retrieved directly from FDA's own
guidance-document hosting (which mirrors the ICH-produced files unaltered).
Do not edit these files. Do not regenerate them by hand. If a newer version is
published, download it fresh and update this document — never patch the XML/XSD
content in place.

## Source

Retrieved 2026-09-09 from FDA's guidance document page:
https://www.fda.gov/regulatory-information/search-fda-guidance-documents/e2br3-electronic-transmission-individual-case-safety-reports-implementation-guide-data-elements-and

Cross-referenced against ICH's own database (database.ich.org) search results
listing the same version numbers, as a second, independent confirmation these
are the current official files (not a stale or unofficial mirror).

| File | Direct source URL | Stated size (FDA page) | Downloaded size |
|---|---|---|---|
| `ICH_ICSR_XML_Schema_Set_v2.5.zip` | https://www.fda.gov/media/157992/download | 979 KB | 1,002,482 bytes |
| `ICH_ICSR_Reference_Instances_v3.1.zip` | https://www.fda.gov/media/157991/download | 17 KB | 17,109 bytes |
| `ICH_ICSR_Example_Instances_v2.0.zip` | https://www.fda.gov/media/157990/download | 112 KB | 114,157 bytes |

Stated and downloaded sizes match for all three files. All three ZIPs passed
`unzip -t` integrity verification (no corruption). SHA-256 checksums of the
exact bytes committed to this repo are in `CHECKSUMS.sha256` — re-verify with
`sha256sum -c CHECKSUMS.sha256` before trusting these files in a build.

## What's actually in them (verified by extraction + inspection, not assumed)

- **XML Schema Set v2.5** — the real XSD files. Confirmed HL7 v3 message-type
  schemas (e.g. `PORR_MT049023UV.xsd`), split into `coreschemas/` and
  `multicacheschemas/` — this is the genuine, complex HL7 v3 R-MIM schema set,
  not a simplified custom schema.
- **Reference Instances v3.1** — official example XML instances, including
  `00_ICH_ICSR_Reference_Instance_variation_v3_1.xml`. Inspected directly:
  root element is `<MCCI_IN200100UV01>` (the batch/transmission wrapper, HL7
  namespace `urn:hl7-org:v3`), containing one or more `<PORR_IN049016UV>`
  elements (the actual ICSR message). This is **not** the same shape as the
  old E2B(R2) `<ichicsr>` root — confirms the app's previous generator was
  using the wrong (R2-shaped) structure and calling it R3.
- **Example Instances v2.0** — additional worked examples (e.g. a clinical
  trial case), useful as extra fixtures once the serializer exists.

## Companion documents (not yet retrieved — same FDA page, add if/when needed)

- E2B(R3) Implementation Guide — Data Elements and Message Specification
  (`/media/81904/download`, PDF, April 2022)
- Appendix I(B) — Backwards and Forwards Compatibility (`/media/81913/download`)
- Backwards/Forwards Compatibility Mapping spreadsheet (`/media/157987/download`)
- E2B Conversion Style-sheets (`/media/157988/download`)

## What this does NOT solve

This package defines the **structure** (schema) real E2B(R3) XML must have.
It contains no MedDRA or WHODrug data whatsoever — those remain separately
licensed dictionaries this repository does not and will not bundle. See
`docs/E2B-R3-NAFDAC-VIGIFLOW.md` for the full picture.
