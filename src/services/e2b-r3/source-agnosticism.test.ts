import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mapSourceRecordToPVCase } from "./mapping";
import { validateSourceDecoding } from "./validation";
import { splitIntoBatches } from "./batching";
import { serializeBatchToXml } from "./serializer";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { ondoAefiProfile } from "./source-profiles/ondo-aefi";
import { syntheticFacilityBProfile } from "./source-profiles/synthetic-facility-b";
import { UNCONFIRMED_DEFAULT_CONFIG } from "./transmission-config";

/**
 * THE ARCHITECTURAL ACCEPTANCE TEST: proves the E2B(R3) engine
 * (mapping/validation/batching/serializer) is genuinely source-agnostic —
 * not just in intent, but demonstrated by running a second, wholly
 * synthetic source profile (different column names, different
 * multi-value delimiter, different reporter vocabulary, a populated local
 * reaction codebook) through the exact same engine functions used for
 * Ondo, with zero source-specific code paths anywhere in those functions.
 */
describe("source profile agnosticism", () => {
  const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };
  const context = { jobId: "test-job", sourceFile: "facility-b.csv", sourceRow: 1, processedAt: "2026-09-09T00:00:00Z" };

  it("no engine file (mapping/validation/serializer/batching, plus the codebook-discovery pipeline) contains an actual conditional/branch on a specific source — doc-comment prose mentioning \"Ondo\" as an example is fine, a hardcoded condition is not", () => {
    const engineFiles = [
      "mapping.ts",
      "validation.ts",
      "serializer.ts",
      "batching.ts",
      "source-profiles/legend-parser.ts",
      "source-profiles/runtime-profile.ts",
      "source-profiles/discovered-codebook.ts",
    ].map((f) => ({
      name: f,
      content: readFileSync(join(__dirname, f), "utf-8"),
    }));
    for (const { name, content } of engineFiles) {
      // No real code branch keyed on a specific source profile id or a
      // literal Ondo-specific value — a comparison, switch case, or object
      // key equal to one of these would be exactly the kind of hardcoding
      // the architecture forbids.
      expect(content, name).not.toMatch(/===\s*["']ondo/i);
      expect(content, name).not.toMatch(/["']ondo[-\w]*["']\s*===/i);
      expect(content, name).not.toMatch(/case\s*["']ondo/i);
      // "CHEW" and the old Ondo-only raw reaction_code field must never
      // appear as literal code — vaccine_batch is deliberately NOT checked
      // here, since it's this engine's own canonical intermediate field
      // name (see RawLineListRow), not something specific to Ondo; every
      // source profile maps its own column name onto it via columnMap.
      expect(content, name).not.toContain('"CHEW"');
      expect(content, name).not.toContain("row.reaction_code");
    }
  });

  it("Facility B's own, completely different column names map correctly via its own SourceProfile", async () => {
    const facilityBRow = {
      record_id: "FB-0001",
      subject_name: "JANE DOE",
      gender: "F",
      age_years: "7",
      event_category: "C01|C02", // pipe-delimited, NOT Ondo's comma/semicolon/AND
      event_date: "2026-02-10",
      suspect_product: "TestVax A",
      admin_date: "2026-02-08",
      lot_no: "LOT-FB-01",
      dose_given: "0.5",
      result: "RECOVERED",
      severity: "NON SERIOUS",
      reporter_profession: "CLINICIAN", // Facility B's own vocabulary, not "Doctor"/"Medical Officer"
      contact_number: "2348011112222",
    };

    const { pvCase } = await mapSourceRecordToPVCase(
      facilityBRow,
      syntheticFacilityBProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );

    // Column mapping worked despite totally different source column names.
    expect(pvCase.patient.identity).toEqual({ present: true, value: { kind: "INITIALS", initials: "J.D." } });
    expect(pvCase.patient.sex).toBe("FEMALE");
    expect(pvCase.sendersCaseId).toBe("FB-0001");

    // Pipe delimiter split into 2 reactions, each DECODED via Facility B's
    // own populated codebook (proves the DECODED path, not just quarantine).
    expect(pvCase.reactions).toHaveLength(2);
    expect(pvCase.reactions[0]!.sourceDecoding.status).toBe("DECODED");
    expect(pvCase.reactions[0]!.sourceDecoding.sourceTerm).toBe("Fever (synthetic test codebook entry)");
    expect(pvCase.reactions[1]!.sourceDecoding.sourceTerm).toBe("Injection site swelling (synthetic test codebook entry)");

    // Product verbatim carried through untouched (Option A).
    expect(pvCase.products).toHaveLength(1);
    expect(pvCase.products[0]!.product.sourceValue).toBe("TestVax A");
    expect(pvCase.products[0]!.batchNumber).toBe("LOT-FB-01");

    // Facility B's own reporter vocabulary resolves via ITS OWN map — "CLINICIAN"
    // means nothing to Ondo's profile, and vice versa.
    expect(pvCase.reporter.qualificationCode).toBe("1"); // Physician
    expect(pvCase.reporter.qualificationVerbatim).toBe("CLINICIAN");

    expect(pvCase.sourceInformation.sourceProfileId).toBe("synthetic-facility-b");
  });

  it("an unrecognised local code under Facility B's codebook quarantines exactly like an Ondo one would — same engine logic, different data", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { record_id: "FB-0002", event_category: "C99", suspect_product: "TestVax B", subject_name: "X Y" },
      syntheticFacilityBProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions[0]!.sourceDecoding.status).toBe("UNKNOWN_CODE");
    const errors = validateSourceDecoding(pvCase);
    expect(errors.some((e) => e.code === "E2B-REACTION-CODEBOOK-UNRESOLVED")).toBe(true);
  });

  it("comma/semicolon/AND are recognised universally (per the compound-value addendum), regardless of which profile is active", async () => {
    // Comma is NOT one of Facility B's own configured separators
    // (["|"]) — but the compound tokenizer treats comma as a universally
    // supported delimiter for every profile, same as it does for Ondo.
    const { pvCase } = await mapSourceRecordToPVCase(
      { record_id: "FB-0003", event_category: "C01,C02", suspect_product: "TestVax C", subject_name: "X Y" },
      syntheticFacilityBProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions).toHaveLength(2);
    expect(pvCase.reactions.map((r) => r.sourceDecoding.localCode)).toEqual(["C01", "C02"]);
    expect(pvCase.reactions.every((r) => r.sourceDecoding.status === "DECODED")).toBe(true);
  });

  it("a profile's OWN configured delimiter ('|' for Facility B) is genuinely profile-specific — Ondo's profile does not recognise it", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "19|21", product: "MR/MV", patient_identifier: "A B" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    // "|" is not universal and not one of Ondo's configured separators —
    // Ondo's empty codebook also has no entry starting with "19|21", so
    // this resolves as one unrecognised value, not a split.
    expect(pvCase.reactions).toHaveLength(1);
    expect(pvCase.reactions[0]!.sourceDecoding.localCode).toBe("19|21");
  });

  it("the SAME batching + serializer functions handle a mixed batch of Ondo-profile and Facility-B-profile cases together, producing real XSD-shaped output", async () => {
    const { pvCase: ondoCase } = await mapSourceRecordToPVCase(
      { case_id: "MIXED-ONDO-1", reaction: "19", product: "PENTA", patient_identifier: "A B", reporter_designation: "CHEW" },
      ondoAefiProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      { ...context, jobId: "mixed-test" },
      providers,
    );
    const { pvCase: facilityBCase } = await mapSourceRecordToPVCase(
      { record_id: "MIXED-FB-1", event_category: "C01", suspect_product: "TestVax A", subject_name: "C D", reporter_profession: "CLINICIAN" },
      syntheticFacilityBProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      { ...context, jobId: "mixed-test" },
      providers,
    );

    const batches = splitIntoBatches([ondoCase, facilityBCase], "MIXED-SOURCE-TEST");
    expect(batches).toHaveLength(1);
    expect(batches[0]!.cases).toHaveLength(2);

    const xml = serializeBatchToXml(batches[0]!.cases, {
      batchId: "MIXED-SOURCE-TEST-BATCH",
      senderId: "TEST-SENDER",
      receiverId: "TEST-RECEIVER",
      transmissionTimestamp: new Date("2026-09-09T00:00:00Z"),
    });
    expect((xml.match(/<PORR_IN049016UV>/g) ?? []).length).toBe(2);
    expect(xml).toContain("MIXED-ONDO-1");
    expect(xml).toContain("MIXED-FB-1");

    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "test-mixed-source-profiles.xml"), xml, "utf-8");
  });

  it("VigiFlow preflight, batching, and the serializer never branch on sourceProfileId — grep proof", () => {
    const files = ["validation.ts", "batching.ts", "serializer.ts"].map((f) => readFileSync(join(__dirname, f), "utf-8"));
    for (const content of files) {
      expect(content).not.toMatch(/sourceProfileId\s*===/);
      expect(content).not.toMatch(/profile\.id\s*===/);
    }
  });
});
