import type { SourceProfile } from "./types";

/**
 * A source that writes its reactions, outcomes and products as words rather
 * than as local codes — the common shape for CRO exports, DHIS2/ODK
 * extracts, and any line list typed by a person rather than coded against a
 * facility legend.
 *
 * Exists because the engine previously had exactly one profile, `ondo-aefi`,
 * and every upload was judged against it. A file whose reaction column said
 * "Abscess" was looked up in Ondo's numeric codebook, found nothing, and
 * quarantined — 0 of 3 cases exportable on a real test file, purely for
 * spelling its reactions out.
 *
 * What this profile does NOT do is relax any safety rule:
 *  - It has no reaction codebook, because a verbatim source has no codes to
 *    decode. It does not inherit or borrow another source's codebook.
 *  - Reaction text still goes to MedDRA coding like any other term, and
 *    without a licensed provider the serializer still emits
 *    nullFlavor="UNK" with the words preserved in <originalText>. An
 *    uncoded term is never dressed up as a dictionary code.
 *  - reporterQualificationMap is deliberately EMPTY. C.2.r.4 is a
 *    five-value ICH codelist and no generic mapping from free-text job
 *    titles to it can be correct for an unknown organisation, so every
 *    designation quarantines until someone configures the real mapping.
 *    Being blocked on a decision nobody has made is the right outcome.
 *  - outcomeMap and seriousnessCriterionMap are likewise absent: the engine
 *    falls back to its own ICH concept dictionaries and flags anything it
 *    cannot resolve for human review, rather than guessing.
 *
 * columnMap uses the canonical field names the line-list layer already
 * normalises headers into (see TARGET_FIELDS in services/api/linelist.ts),
 * so this profile does not need to know any particular form's column
 * spelling — that problem is already solved upstream by FIELD_KEYWORDS.
 */
export const genericVerbatimProfile: SourceProfile = {
  id: "generic-verbatim",
  name: "Generic line list (reactions written as text)",
  sourceVersion: "1.0.0",
  effectiveDate: "2026-09-13",
  // No country is asserted. A generic profile cannot know where its source
  // sits, and inventing one would put a fabricated country on every
  // reporter. "NG" is this deployment's own jurisdiction, which is a fact
  // about the installation rather than about the data.
  country: "NG",
  timezone: "Africa/Lagos",
  columnMap: {
    caseId: "case_id",
    patientIdentifier: "patient_identifier",
    sex: "sex",
    age: "age",
    reaction: "reaction",
    onsetDate: "onset_date",
    product: "product",
    vaccinationDate: "vaccination_date",
    batchNumber: "vaccine_batch",
    dose: "dose",
    outcome: "outcome",
    seriousness: "seriousness",
    seriousCode: "serious_code",
    reporterDesignation: "reporter_designation",
    reporterPhone: "reporter_phone",
  },
  reactionEncoding: "VERBATIM",
  // Only separators that cannot plausibly occur inside a reaction term.
  // A bare "." is excluded on purpose — it splits "1.5 cm induration" into
  // nonsense — matching the caution the coded path already applies.
  reactionDelimiter: { separators: [",", ";", "/", "|"] },
  reactionCodebook: {
    sourceId: "generic-verbatim",
    field: "reaction",
    // Not an unsupplied codebook awaiting a document: this source has no
    // codes, so there is nothing to supply. decodeReactionField never
    // consults it while reactionEncoding is "VERBATIM".
    version: "N/A-VERBATIM-SOURCE",
    entries: {},
  },
  reporterQualificationMap: {},
};
