import { describe, expect, it } from "vitest";
import {
  DEFAULT_C17_RULE,
  evaluateC17,
  normalizeMedicallyImportantTerms,
  type C17Rule,
} from "./c17-rule";
import type { PVCase, PVReaction, SeriousnessCriteria } from "./types";

function reaction(
  term: string,
  extra: { criteria?: SeriousnessCriteria; outcome?: PVReaction["outcome"] } = {},
): PVReaction {
  return {
    id: "r1",
    reaction: { sourceValue: term, status: "UNMAPPED", mappingMethod: "NONE" },
    sourceDecoding: {
      status: "DECODED",
      localCode: term,
      sourceTerm: term,
      sourceProfileId: "test",
    },
    seriousnessCriteria: extra.criteria ?? {},
    ...(extra.outcome ? { outcome: extra.outcome } : {}),
  } as PVReaction;
}

function pvCase(partial: Partial<PVCase> = {}): PVCase {
  return {
    internalCaseId: "job-1",
    sendersCaseId: "C-1",
    worldwideUniqueId: "C-1",
    firstSenderOfCase: "2",
    reportType: { present: true, value: "4" },
    dateOfCreation: "2026-09-01T00:00:00.000Z",
    dateFirstReceived: "2026-09-01",
    dateMostRecentInfo: "2026-09-01",
    additionalDocumentsAvailable: false,
    fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" },
    otherCaseIdentifiersInPreviousTransmissions: { present: false, nullFlavor: "NI" },
    followUp: { isFollowUp: false },
    patient: { identity: { present: true, value: { kind: "INITIALS", initials: "A.B." } } },
    reporter: { name: { present: false, nullFlavor: "NASK" } },
    reactions: [reaction("Fever")],
    products: [],
    sourceInformation: {
      sourceFile: "t.csv",
      sourceRow: 1,
      jobId: "job-1",
      sourceProfileId: "test",
    },
    ...partial,
  } as PVCase;
}

describe("the agreed C.1.7 rule: serious means expedited", () => {
  it("says YES when the file simply records the case as serious", () => {
    const result = evaluateC17(
      pvCase({ aggregateSeriousnessAsReported: "Serious" }),
      DEFAULT_C17_RULE,
    );
    expect(result.recommendation).toBe("YES");
    expect(result.matched[0]).toMatchObject({ key: "SERIOUS_AS_REPORTED" });
    expect(result.rationale).toContain("v1.0");
  });

  it.each([
    ["resultsInDeath", "DEATH"],
    ["lifeThreatening", "LIFE_THREATENING"],
    ["hospitalization", "HOSPITALIZATION"],
    ["disabling", "DISABILITY"],
    ["congenitalAnomaly", "CONGENITAL_ANOMALY"],
    ["otherMedicallyImportant", "MEDICALLY_IMPORTANT"],
  ])("says YES on the %s criterion", (field, key) => {
    const result = evaluateC17(
      pvCase({ reactions: [reaction("Event", { criteria: { [field]: true } })] }),
      DEFAULT_C17_RULE,
    );
    expect(result.recommendation).toBe("YES");
    expect(result.matched.map((m) => m.key)).toContain(key);
  });

  it("treats a fatal outcome as death even when no criterion is ticked", () => {
    const result = evaluateC17(
      pvCase({ reactions: [reaction("Collapse", { outcome: "FATAL" })] }),
      DEFAULT_C17_RULE,
    );
    expect(result.recommendation).toBe("YES");
    expect(result.matched[0]!.detail).toMatch(/fatal/i);
  });

  it("recognises a medically important reaction by its own words", () => {
    const result = evaluateC17(
      pvCase({ reactions: [reaction("Anaphylaxis after second dose")] }),
      DEFAULT_C17_RULE,
    );
    expect(result.recommendation).toBe("YES");
    expect(result.matched[0]).toMatchObject({ key: "MEDICALLY_IMPORTANT" });
  });

  it("recognises the vaccine triggers WHO and Nigeria add", () => {
    const result = evaluateC17(
      pvCase({ narrative: "Part of a cluster reported in the same ward." }),
      DEFAULT_C17_RULE,
    );
    expect(result.recommendation).toBe("YES");
    expect(result.matched.map((m) => m.key)).toContain("CLUSTER");
  });

  it("says NO when the file records the case as non-serious", () => {
    const result = evaluateC17(
      pvCase({ aggregateSeriousnessAsReported: "Non-serious" }),
      DEFAULT_C17_RULE,
    );
    expect(result.recommendation).toBe("NO");
    expect(result.rationale).toContain("Non-serious");
  });

  it("asks for a person when the case never says whether it is serious", () => {
    const result = evaluateC17(pvCase(), DEFAULT_C17_RULE);
    expect(result.recommendation).toBe("NEEDS_REVIEW");
    expect(result.missingFacts.join(" ")).toMatch(/does not say whether it is serious/i);
  });
});

describe("the rule is editable, and edits take effect", () => {
  it("ignores a criterion the assessors switch off", () => {
    const withoutHospitalisation: C17Rule = {
      ...DEFAULT_C17_RULE,
      criteria: {
        ...DEFAULT_C17_RULE.criteria,
        HOSPITALIZATION: false,
        SERIOUS_AS_REPORTED: false,
      },
    };
    const hospitalised = pvCase({
      reactions: [reaction("Rash", { criteria: { hospitalization: true } })],
      aggregateSeriousnessAsReported: "Serious",
    });
    expect(evaluateC17(hospitalised, DEFAULT_C17_RULE).recommendation).toBe("YES");
    expect(evaluateC17(hospitalised, withoutHospitalisation).recommendation).toBe("NO");
  });

  it("uses the organization's own medically important terms", () => {
    const rule: C17Rule = { ...DEFAULT_C17_RULE, medicallyImportantTerms: ["severe headache"] };
    const result = evaluateC17(pvCase({ reactions: [reaction("Severe headache")] }), rule);
    expect(result.recommendation).toBe("YES");
    expect(evaluateC17(pvCase({ reactions: [reaction("Anaphylaxis")] }), rule).recommendation).toBe(
      "NEEDS_REVIEW",
    );
  });

  it("keeps each medically important term once", () => {
    expect(
      normalizeMedicallyImportantTerms([
        "anaphylaxis",
        " Anaphylaxis ",
        "",
        "  ",
        "convulsion",
        "ANAPHYLAXIS",
      ]),
    ).toEqual(["anaphylaxis", "convulsion"]);
  });

  it("does not change a decision by tidying the list", () => {
    const repeated: C17Rule = {
      ...DEFAULT_C17_RULE,
      medicallyImportantTerms: ["anaphylaxis", "anaphylaxis", "anaphylaxis"],
    };
    const tidied: C17Rule = {
      ...repeated,
      medicallyImportantTerms: normalizeMedicallyImportantTerms(repeated.medicallyImportantTerms),
    };
    const anaphylaxis = pvCase({ reactions: [reaction("Anaphylaxis")] });
    expect(evaluateC17(anaphylaxis, tidied)).toEqual(evaluateC17(anaphylaxis, repeated));
  });

  it("records the rule version that produced the answer", () => {
    const rule: C17Rule = { ...DEFAULT_C17_RULE, version: "2.1", name: "NAFDAC confirmed rule" };
    const result = evaluateC17(pvCase({ aggregateSeriousnessAsReported: "Serious" }), rule);
    expect(result.rationale).toContain("NAFDAC confirmed rule");
    expect(result.rationale).toContain("v2.1");
  });
});
