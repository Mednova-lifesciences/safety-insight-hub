import { describe, expect, it } from "vitest";
import { discoverAndApplyCodebook } from "./export";
import { mapSourceRecordToPVCase } from "./mapping";
import { validateBusinessRules, validateSourceDecoding } from "./validation";
import { ondoAefiProfile } from "./source-profiles/ondo-aefi";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG } from "./transmission-config";
import { runValidation, type ParsedRow, type TargetField } from "@/services/api/linelist";
import type { LineListCodeList } from "@/types/pv";

const context = {
  jobId: "t",
  sourceFile: "t.xlsx",
  sourceRow: 1,
  processedAt: "2026-10-10T00:00:00Z",
};
const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };

const list = (
  origin: "PERSON" | "FORM",
  entries: LineListCodeList["entries"],
): LineListCodeList => ({
  entries,
  text: "typed by a person",
  origin,
  formKey: "f",
  by: "A. Bello",
  at: "2026-10-10T00:00:00Z",
});

// The file's own legend, as the upload parser preserves it.
const FILE_LEGEND = [
  { row: 250, text: "3) OUTCOME: 1= Recovered, 2=Hospitalized, 3=Disability, 4=Died" },
];

const profileWith = (codeList?: LineListCodeList, legend = [] as { row: number; text: string }[]) =>
  discoverAndApplyCodebook(ondoAefiProfile, legend, { file: "t.xlsx" }, codeList).runtimeProfile;

async function caseFor(
  row: Record<string, string>,
  codeList?: LineListCodeList,
  legend?: { row: number; text: string }[],
) {
  const { pvCase } = await mapSourceRecordToPVCase(
    { product: "MR", patient_identifier: "A B", ...row },
    profileWith(codeList, legend),
    UNCONFIRMED_DEFAULT_CONFIG,
    context,
    providers,
  );
  return pvCase;
}

describe("a code list a person supplied decodes the file", () => {
  it("decodes reaction codes when the file has no legend", async () => {
    const without = await caseFor({ reaction: "19" });
    expect(validateSourceDecoding(without).some((e) => /REACTION/.test(e.code))).toBe(true);
    const withList = await caseFor(
      { reaction: "19" },
      list("PERSON", [{ field: "reaction", sourceCode: "19", meaning: "Fever" }]),
    );
    expect(withList.reactions[0]!.sourceDecoding.sourceTerm).toBe("Fever");
  });

  it("decodes the seriousness criterion code", async () => {
    const pvCase = await caseFor(
      { reaction: "Fever", seriousness: "SERIOUS", serious_code: "1" },
      list("PERSON", [{ field: "seriousness", sourceCode: "1", meaning: "Life threatening" }]),
    );
    expect(pvCase.reactions[0]!.seriousnessCriteria.lifeThreatening).toBe(true);
    expect(
      validateBusinessRules(pvCase).some((e) => e.code === "E2B-SERIOUSNESS-CODE-UNMAPPED"),
    ).toBe(false);
  });

  it("decodes any other coded column — sex here — before mapping", async () => {
    const pvCase = await caseFor(
      { reaction: "Fever", sex: "2" },
      list("PERSON", [
        { field: "sex", sourceCode: "1", meaning: "Male" },
        { field: "sex", sourceCode: "2", meaning: "Female" },
      ]),
    );
    expect(pvCase.patient.sex).toBeDefined();
    expect(pvCase.patient.sexVerbatim).toBeUndefined();
  });

  it("the line-list checks read the decoded value too", () => {
    const mapping = { Sex: "sex" } as Record<string, TargetField>;
    const rows: ParsedRow[] = Array.from({ length: 8 }, (_, i) => ({ sex: i % 2 ? "1" : "2" }));
    const before = runValidation(["Sex"], mapping, rows, profileWith());
    expect(before.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT" && i.column === "Sex")).toBe(true);
    const after = runValidation(
      ["Sex"],
      mapping,
      rows,
      profileWith(
        list("PERSON", [
          { field: "sex", sourceCode: "1", meaning: "Male" },
          { field: "sex", sourceCode: "2", meaning: "Female" },
        ]),
      ),
    );
    expect(after.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT" && i.column === "Sex")).toBe(false);
  });
});

describe("precedence", () => {
  const died = [{ field: "outcome", sourceCode: "1", meaning: "Died" }];

  it("the file's own legend beats the code list saved for the form", async () => {
    const pvCase = await caseFor(
      { reaction: "Fever", outcome: "1" },
      list("FORM", died),
      FILE_LEGEND,
    );
    expect(pvCase.reactions[0]!.outcome).toBe("RECOVERED");
  });

  it("the saved form list still applies to fields the file's legend does not cover", async () => {
    const pvCase = await caseFor(
      { reaction: "Fever", outcome: "1", sex: "1" },
      list("FORM", [...died, { field: "sex", sourceCode: "1", meaning: "Male" }]),
      FILE_LEGEND,
    );
    expect(pvCase.reactions[0]!.outcome).toBe("RECOVERED");
    expect(pvCase.patient.sexVerbatim).toBeUndefined();
    expect(pvCase.patient.sex).toBeDefined();
  });

  it("a list a person confirmed for this file beats the file's own legend", async () => {
    const pvCase = await caseFor(
      { reaction: "Fever", outcome: "1" },
      list("PERSON", died),
      FILE_LEGEND,
    );
    expect(pvCase.reactions[0]!.outcome).toBe("FATAL");
  });

  it("a code the list does not define is left as it is", async () => {
    const pvCase = await caseFor(
      { reaction: "Fever", sex: "9" },
      list("PERSON", [{ field: "sex", sourceCode: "1", meaning: "Male" }]),
    );
    expect(pvCase.patient.sexVerbatim).toBe("9");
  });
});
