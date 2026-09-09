import { describe, expect, it } from "vitest";
import {
  deriveInitials,
  mapOutcome,
  mapRowToPVCase,
  mapSeriousness,
  mapSex,
  parseSourceDate,
  splitMultiValue,
} from "./mapping";
import { unlicensedMedDraProvider, unlicensedWhoDrugProvider } from "./coding-provider";

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

describe("splitMultiValue", () => {
  it("splits on comma", () => {
    expect(splitMultiValue("8,19")).toEqual({ values: ["8", "19"], ambiguous: false });
  });
  it("splits on comma with spaces", () => {
    expect(splitMultiValue("5,14,23, 19")).toEqual({
      values: ["5", "14", "23", "19"],
      ambiguous: false,
    });
  });
  it("splits on 'AND' case-insensitively", () => {
    expect(splitMultiValue("12 AND 20")).toEqual({ values: ["12", "20"], ambiguous: false });
  });
  it("splits comma-separated product names", () => {
    expect(splitMultiValue("PENTA,IPV,PCV")).toEqual({
      values: ["PENTA", "IPV", "PCV"],
      ambiguous: false,
    });
  });
  it("splits a dot-separated list but flags it ambiguous", () => {
    const result = splitMultiValue("8.19.21");
    expect(result.values).toEqual(["8", "19", "21"]);
    expect(result.ambiguous).toBe(true);
  });
  it("does NOT split a plain decimal number", () => {
    expect(splitMultiValue("0.5")).toEqual({ values: ["0.5"], ambiguous: false });
  });
  it("returns a single value, not ambiguous, for a plain single token", () => {
    expect(splitMultiValue("19")).toEqual({ values: ["19"], ambiguous: false });
    expect(splitMultiValue("MR/MV")).toEqual({ values: ["MR/MV"], ambiguous: false });
  });
  it("returns empty for missing input", () => {
    expect(splitMultiValue(undefined)).toEqual({ values: [], ambiguous: false });
    expect(splitMultiValue("")).toEqual({ values: [], ambiguous: false });
  });
});

describe("mapRowToPVCase — integration of the mappers above", () => {
  const providers = { meddra: unlicensedMedDraProvider, whodrug: unlicensedWhoDrugProvider };
  const context = { jobId: "ll-test", sourceFile: "test.xlsx", sourceRow: 1, processedAt: "2026-09-09T00:00:00Z" };

  it("maps a real Ondo-shaped row correctly end to end", async () => {
    const { pvCase, warnings } = await mapRowToPVCase(
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
    expect(pvCase.reactions[0]!.reaction.status).toBe("UNMAPPED");
    expect(pvCase.reactions[0]!.reaction.sourceValue).toBe("19");
    expect(pvCase.reactions[0]!.outcomeUnmapped).toBe("1");
    expect(pvCase.reactions[0]!.outcome).toBeUndefined();
    // Event-level seriousness criteria never inferred from the aggregate.
    expect(pvCase.reactions[0]!.seriousnessCriteria).toEqual({});

    expect(pvCase.products).toHaveLength(1);
    expect(pvCase.products[0]!.characterization).toBe("SUSPECT");
    expect(pvCase.products[0]!.product.status).toBe("UNMAPPED");
    expect(pvCase.products[0]!.batchNumber).toBe("0125N084A");
    expect(pvCase.products[0]!.startDate).toBe("2026-02-03");

    // Decision-gated fields stay honestly unresolved.
    expect(pvCase.reportType.present).toBe(false);
    expect(pvCase.senderOrganisation).toBeUndefined();
    expect(pvCase.fulfilsExpeditedCriteria.present).toBe(false);

    // C.1.1 === C.1.8.1 on first creation, per spec 5.2.
    expect(pvCase.worldwideUniqueId).toBe(pvCase.sendersCaseId);

    expect(warnings).toEqual([]);
  });

  it("respects supplied MappingConfig for decision D3/D4 once resolved", async () => {
    const { pvCase } = await mapRowToPVCase(
      { reaction: "19", product: "MR/MV", patient_identifier: "A B" },
      context,
      providers,
      { reportType: "1", senderOrganisation: "MEDNOVA" },
    );
    expect(pvCase.reportType).toEqual({ present: true, value: "1" });
    expect(pvCase.senderOrganisation).toBe("MEDNOVA");
  });

  it("splits a multi-reaction row into separate PVReaction entries", async () => {
    const { pvCase } = await mapRowToPVCase(
      { reaction: "8,19,21", product: "MR/MV", patient_identifier: "A B" },
      context,
      providers,
    );
    expect(pvCase.reactions).toHaveLength(3);
    expect(pvCase.reactions.map((r) => r.reaction.sourceValue)).toEqual(["8", "19", "21"]);
    expect(new Set(pvCase.reactions.map((r) => r.id)).size).toBe(3);
  });

  it("splits a multi-product row into separate PVProduct entries", async () => {
    const { pvCase } = await mapRowToPVCase(
      { reaction: "19", product: "PENTA,IPV,PCV", patient_identifier: "A B" },
      context,
      providers,
    );
    expect(pvCase.products).toHaveLength(3);
    expect(pvCase.products.map((p) => p.product.sourceValue)).toEqual(["PENTA", "IPV", "PCV"]);
  });

  it("flags an ambiguous dot-separated split in warnings", async () => {
    const { warnings } = await mapRowToPVCase(
      { reaction: "8.19.21", product: "MR/MV", patient_identifier: "A B" },
      context,
      providers,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.field).toBe("reaction");
  });

  it("produces zero reactions/products for a row with no data (never fabricates one)", async () => {
    const { pvCase } = await mapRowToPVCase({ patient_identifier: "A B" }, context, providers);
    expect(pvCase.reactions).toHaveLength(0);
    expect(pvCase.products).toHaveLength(0);
  });

  it("falls back to a synthesized case id when case_id is absent, never leaving it empty", async () => {
    const { pvCase } = await mapRowToPVCase({ patient_identifier: "A B" }, context, providers);
    expect(pvCase.sendersCaseId).toBe("ll-test-1");
  });

  it("marks patient identity unresolved (nullFlavor UNK) when no identifier exists at all", async () => {
    const { pvCase } = await mapRowToPVCase({ reaction: "19" }, context, providers);
    expect(pvCase.patient.identity).toEqual({ present: false, nullFlavor: "UNK" });
  });

  it("leaves patient.ageUnit undefined even when age is present (never guesses years vs months)", async () => {
    const { pvCase } = await mapRowToPVCase(
      { age: "8", patient_identifier: "A B" },
      context,
      providers,
    );
    expect(pvCase.patient.age).toBe("8");
    expect(pvCase.patient.ageUnit).toBeUndefined();
  });

  it("never records reporter name as present (only qualification is available from this source)", async () => {
    const { pvCase } = await mapRowToPVCase(
      { reporter_designation: "CHEW", patient_identifier: "A B" },
      context,
      providers,
    );
    expect(pvCase.reporter.name.present).toBe(false);
    expect(pvCase.reporter.qualificationVerbatim).toBe("CHEW");
  });
});
