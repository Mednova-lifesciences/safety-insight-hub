import { describe, expect, it } from "vitest";
import {
  deriveInitials,
  mapOutcome,
  mapSourceRecordToPVCase,
  mapSeriousness,
  mapSex,
  parseSourceDate,
  splitBySourceProfile,
} from "./mapping";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { ondoAefiProfile } from "./source-profiles/ondo-aefi";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";

describe("deriveInitials", () => {
  it("derives initials from a full two-part name", () => {
    expect(deriveInitials("ADEBOLA ESTHER")).toBe("A.E.");
  });
  it("handles a three-part name", () => {
    expect(deriveInitials("John Michael Smith")).toBe("J.M.S.");
  });
  it("passes through an already-single token unchanged (uppercased)", () => {
    expect(deriveInitials("ae")).toBe("AE");
  });
  it("returns empty string for empty input", () => {
    expect(deriveInitials("")).toBe("");
    expect(deriveInitials("   ")).toBe("");
  });
  it("never returns anything containing the original full name for a real name", () => {
    const result = deriveInitials("EGBEOLA TIMILEHIN");
    expect(result).not.toContain("EGBEOLA");
    expect(result).not.toContain("TIMILEHIN");
    expect(result).toBe("E.T.");
  });
});

describe("parseSourceDate", () => {
  it("parses dd/mm/yy", () => {
    expect(parseSourceDate("3/2/26")).toBe("2026-02-03");
  });
  it("parses dd/mm/yyyy", () => {
    expect(parseSourceDate("03/02/2026")).toBe("2026-02-03");
  });
  it("parses yyyy-mm-dd", () => {
    expect(parseSourceDate("2026-02-03")).toBe("2026-02-03");
  });
  it("parses yyyy/mm/dd", () => {
    expect(parseSourceDate("2026/02/03")).toBe("2026-02-03");
  });
  it("returns null for missing input", () => {
    expect(parseSourceDate(undefined)).toBeNull();
    expect(parseSourceDate("")).toBeNull();
  });
  it("returns null (never a guess) for unparseable input", () => {
    expect(parseSourceDate("sometime last week")).toBeNull();
    expect(parseSourceDate("unknown")).toBeNull();
  });
  it("interprets a 2-digit year boundary consistently (< 50 => 20xx)", () => {
    expect(parseSourceDate("1/1/49")).toBe("2049-01-01");
    expect(parseSourceDate("1/1/50")).toBe("1950-01-01");
  });
});

describe("mapSex", () => {
  it("maps MALE/M", () => {
    expect(mapSex("MALE")).toBe("MALE");
    expect(mapSex("M")).toBe("MALE");
    expect(mapSex("male")).toBe("MALE");
  });
  it("maps FEMALE/F", () => {
    expect(mapSex("FEMALE")).toBe("FEMALE");
    expect(mapSex("F")).toBe("FEMALE");
  });
  it("returns undefined (never guesses) for anything else", () => {
    expect(mapSex("unknown")).toBeUndefined();
    expect(mapSex("")).toBeUndefined();
    expect(mapSex(undefined)).toBeUndefined();
    expect(mapSex("1")).toBeUndefined();
  });
});

describe("mapSeriousness (case-level aggregate value only — see PVCase.aggregateSeriousnessAsReported)", () => {
  it("maps known serious words to true", () => {
    expect(mapSeriousness("SERIOUS")).toBe(true);
    expect(mapSeriousness("YES")).toBe(true);
    expect(mapSeriousness("Y")).toBe(true);
  });
  it("maps known non-serious words/spellings to false", () => {
    expect(mapSeriousness("NON SERIOUS")).toBe(false);
    expect(mapSeriousness("NON_SERIOUS")).toBe(false);
    expect(mapSeriousness("NONSERIOUS")).toBe(false);
    expect(mapSeriousness("NO")).toBe(false);
    expect(mapSeriousness("N")).toBe(false);
  });
  it("returns undefined for a raw/undecoded numeric serious_code", () => {
    expect(mapSeriousness("1")).toBeUndefined();
    expect(mapSeriousness("2")).toBeUndefined();
  });
});

describe("mapOutcome", () => {
  it("maps every recognised outcome word", () => {
    expect(mapOutcome("RECOVERED")).toEqual({ outcome: "RECOVERED" });
    expect(mapOutcome("RECOVERING")).toEqual({ outcome: "RECOVERING" });
    expect(mapOutcome("NOT_RECOVERED")).toEqual({ outcome: "NOT_RECOVERED" });
    expect(mapOutcome("NOT RECOVERED")).toEqual({ outcome: "NOT_RECOVERED" });
    expect(mapOutcome("RECOVERED_WITH_SEQUELAE")).toEqual({ outcome: "RECOVERED_WITH_SEQUELAE" });
    expect(mapOutcome("FATAL")).toEqual({ outcome: "FATAL" });
    expect(mapOutcome("UNKNOWN")).toEqual({ outcome: "UNKNOWN" });
  });
  it("returns unmapped (never a silent guess) for a raw source-form code", () => {
    // This is the exact live bug: source outcome column contained "1",
    // which is NOT this app's own normalised vocabulary.
    expect(mapOutcome("1")).toEqual({ unmapped: "1" });
  });
  it("returns unmapped for empty/undefined input, carrying the raw value", () => {
    expect(mapOutcome(undefined)).toEqual({ unmapped: "" });
  });
});

describe("splitBySourceProfile", () => {
  it("splits on the profile's configured comma separator", () => {
    expect(splitBySourceProfile("8,19", ondoAefiProfile)).toEqual({ values: ["8", "19"], quarantined: false, rawValue: "8,19" });
  });
  it("splits on comma with spaces", () => {
    expect(splitBySourceProfile("5,14,23, 19", ondoAefiProfile).values).toEqual(["5", "14", "23", "19"]);
  });
  it("splits on the profile's configured 'AND' separator case-insensitively", () => {
    expect(splitBySourceProfile("12 AND 20", ondoAefiProfile).values).toEqual(["12", "20"]);
  });
  it("splits comma-separated product names", () => {
    expect(splitBySourceProfile("PENTA,IPV,PCV", ondoAefiProfile).values).toEqual(["PENTA", "IPV", "PCV"]);
  });
  it("quarantines a dot-separated list — Ondo's profile does not configure '.' as a delimiter", () => {
    const result = splitBySourceProfile("8.19.21", ondoAefiProfile);
    expect(result.quarantined).toBe(true);
    expect(result.values).toEqual([]);
    expect(result.rawValue).toBe("8.19.21");
  });
  it("does NOT quarantine a plain decimal number", () => {
    expect(splitBySourceProfile("0.5", ondoAefiProfile)).toEqual({ values: ["0.5"], quarantined: false, rawValue: "0.5" });
  });
  it("returns a single value, not quarantined, for a plain single token", () => {
    expect(splitBySourceProfile("19", ondoAefiProfile)).toEqual({ values: ["19"], quarantined: false, rawValue: "19" });
    expect(splitBySourceProfile("MR/MV", ondoAefiProfile)).toEqual({ values: ["MR/MV"], quarantined: false, rawValue: "MR/MV" });
  });
  it("returns empty for missing input", () => {
    expect(splitBySourceProfile(undefined, ondoAefiProfile)).toEqual({ values: [], quarantined: false, rawValue: "" });
    expect(splitBySourceProfile("", ondoAefiProfile)).toEqual({ values: [], quarantined: false, rawValue: "" });
  });
});

const confirmedConfig: E2bTransmissionConfig = {
  environment: "production",
  sender: { organization: "MEDNOVA", identifier: "MEDNOVA-SND-ID" },
  receiver: { identifier: "NAFDAC-RCV-ID" },
  reportType: "1",
};

describe("mapSourceRecordToPVCase — integration, Ondo source profile", () => {
  const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };
  const context = { jobId: "ll-test", sourceFile: "test.xlsx", sourceRow: 1, processedAt: "2026-09-09T00:00:00Z" };

  it("maps a real Ondo-shaped row correctly end to end", async () => {
    const { pvCase, warnings } = await mapSourceRecordToPVCase(
      {
        age: "1",
        sex: "FEMALE",
        dose: "0.5",
        outcome: "1", // raw source code, not this app's vocabulary
        product: "MR/MV",
        reaction: "19",
        seriousness: "NON SERIOUS",
        vaccine_batch: "0125N084A",
        reporter_phone: "2348054535217",
        vaccination_date: "3/2/26",
        patient_identifier: "ADEBOLA ESTHER",
        reporter_designation: "CHEW",
      },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );

    // Privacy: never a full name in the domain model either.
    expect(pvCase.patient.identity).toEqual({
      present: true,
      value: { kind: "INITIALS", initials: "A.E." },
    });
    expect(pvCase.patient.sex).toBe("FEMALE");
    // Case-level aggregate preserved as source info, not exported directly.
    expect(pvCase.aggregateSeriousnessAsReported).toBe("NON SERIOUS");

    expect(pvCase.reactions).toHaveLength(1);
    // Ondo's shipped reaction codebook is empty (never supplied) — "19"
    // never resolves to a real term, so MedDRA coding is never even
    // attempted. The source-decoding layer, not the coding-provider
    // layer, is what's actually blocking this reaction.
    expect(pvCase.reactions[0]!.sourceDecoding.status).toBe("UNKNOWN_CODE");
    expect(pvCase.reactions[0]!.sourceDecoding.localCode).toBe("19");
    expect(pvCase.reactions[0]!.reaction.status).toBe("INVALID");
    expect(pvCase.reactions[0]!.reaction.sourceValue).toBe("19");
    expect(pvCase.reactions[0]!.outcomeUnmapped).toBe("1");
    expect(pvCase.reactions[0]!.outcome).toBeUndefined();
    // Event-level seriousness criteria never inferred from the aggregate.
    expect(pvCase.reactions[0]!.seriousnessCriteria).toEqual({});

    expect(pvCase.products).toHaveLength(1);
    expect(pvCase.products[0]!.characterization).toBe("SUSPECT");
    // WHODrug Option A: verbatim name is always populated, coding status
    // is honestly PROVIDER_UNAVAILABLE (no provider configured) — this
    // never blocks Option A export (see validation.test.ts).
    expect(pvCase.products[0]!.product.status).toBe("PROVIDER_UNAVAILABLE");
    expect(pvCase.products[0]!.product.sourceValue).toBe("MR/MV");
    expect(pvCase.products[0]!.batchNumber).toBe("0125N084A");
    expect(pvCase.products[0]!.startDate).toBe("2026-02-03");

    // Decision-gated fields stay honestly unresolved under the shipped
    // unconfirmed transmission config.
    expect(pvCase.reportType.present).toBe(false);
    expect(pvCase.senderOrganisation).toBeUndefined();
    expect(pvCase.fulfilsExpeditedCriteria.present).toBe(false);

    // C.1.1 === C.1.8.1 on first creation, per spec.
    expect(pvCase.worldwideUniqueId).toBe(pvCase.sendersCaseId);

    // Source provenance is recorded, not inferred by the engine elsewhere.
    expect(pvCase.sourceInformation.sourceProfileId).toBe("ondo-aefi");

    expect(warnings).toEqual([]);
  });

  it("resolves report type and sender organisation once transmission config is confirmed (decisions D3/D4)", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "19", product: "MR/MV", patient_identifier: "A B" },
      ondoAefiProfile,
      confirmedConfig,
      context,
      providers,
    );
    expect(pvCase.reportType).toEqual({ present: true, value: "1" });
    expect(pvCase.senderOrganisation).toBe("MEDNOVA");
  });

  it("splits a multi-reaction row into separate PVReaction entries, each independently decoded", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "8,19,21", product: "MR/MV", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions).toHaveLength(3);
    expect(pvCase.reactions.map((r) => r.sourceDecoding.localCode)).toEqual(["8", "19", "21"]);
    expect(pvCase.reactions.every((r) => r.sourceDecoding.status === "UNKNOWN_CODE")).toBe(true);
    expect(new Set(pvCase.reactions.map((r) => r.id)).size).toBe(3);
  });

  it("splits a multi-product row into separate PVProduct entries", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "19", product: "PENTA,IPV,PCV", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.products).toHaveLength(3);
    expect(pvCase.products.map((p) => p.product.sourceValue)).toEqual(["PENTA", "IPV", "PCV"]);
  });

  it("quarantines a dot-separated reaction field instead of guessing a split, and warns", async () => {
    const { pvCase, warnings } = await mapSourceRecordToPVCase(
      { reaction: "8.19.21", product: "MR/MV", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions).toHaveLength(1);
    expect(pvCase.reactions[0]!.sourceDecoding.status).toBe("DELIMITER_QUARANTINED");
    expect(pvCase.reactions[0]!.sourceDecoding.localCode).toBe("8.19.21");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.field).toBe("reaction");
  });

  it("decodes a known local reaction code via a populated codebook (proves the DECODED path, not just quarantine)", async () => {
    const profileWithCodebook = {
      ...ondoAefiProfile,
      reactionCodebook: {
        sourceId: "ondo-aefi",
        field: "reaction",
        version: "test-1",
        entries: { "19": { localCode: "19", sourceTerm: "Pyrexia (test entry)", effectiveFrom: "2026-01-01" } },
      },
    };
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "19", product: "MR/MV", patient_identifier: "A B" },
      profileWithCodebook,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions[0]!.sourceDecoding.status).toBe("DECODED");
    expect(pvCase.reactions[0]!.sourceDecoding.sourceTerm).toBe("Pyrexia (test entry)");
    // MedDRA coding was attempted (with no provider configured, honestly
    // PROVIDER_UNAVAILABLE) on the DECODED term, not the raw "19".
    expect(pvCase.reactions[0]!.reaction.sourceValue).toBe("Pyrexia (test entry)");
    expect(pvCase.reactions[0]!.reaction.status).toBe("PROVIDER_UNAVAILABLE");
  });

  it("produces zero reactions/products for a row with no data (never fabricates one)", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions).toHaveLength(0);
    expect(pvCase.products).toHaveLength(0);
  });

  it("falls back to the profile's configured case-id prefix when case_id is absent, never leaving it empty", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.sendersCaseId).toBe("NG-MEDNOVA-1");
  });

  it("marks patient identity unresolved (nullFlavor UNK) when no identifier exists at all", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "19" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.patient.identity).toEqual({ present: false, nullFlavor: "UNK" });
  });

  it("leaves patient.ageUnit undefined even when age is present (never guesses years vs months)", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { age: "8", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.patient.age).toBe("8");
    expect(pvCase.patient.ageUnit).toBeUndefined();
  });

  it("never records reporter name as present (only qualification is available from this source)", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reporter_designation: "CHEW", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reporter.name.present).toBe(false);
    expect(pvCase.reporter.qualificationVerbatim).toBe("CHEW");
  });

  it("resolves reporter qualification code via the source profile's MedNova-supplied mapping (CHEW -> Other health professional)", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reporter_designation: "CHEW", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reporter.qualificationCode).toBe("3");
  });

  it("resolves Doctor/Medical Officer -> Physician (1) and Pharmacist -> Pharmacist (2) per the source profile's map", async () => {
    const { pvCase: doctor } = await mapSourceRecordToPVCase(
      { reporter_designation: "DOCTOR", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(doctor.reporter.qualificationCode).toBe("1");
    const { pvCase: pharmacist } = await mapSourceRecordToPVCase(
      { reporter_designation: "PHARMACIST", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pharmacist.reporter.qualificationCode).toBe("2");
  });

  it("resolves Patient/Parent/Caregiver -> Consumer or other non-health professional (5)", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reporter_designation: "PARENT", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reporter.qualificationCode).toBe("5");
  });

  it("leaves reporter qualification code unresolved for a designation the profile doesn't recognise", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reporter_designation: "SOMETHING UNRECOGNISED", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reporter.qualificationCode).toBeUndefined();
    expect(pvCase.reporter.qualificationVerbatim).toBe("SOMETHING UNRECOGNISED");
  });
});
