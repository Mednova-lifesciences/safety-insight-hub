import { describe, expect, it } from "vitest";
import { prefillFromAi } from "./v4-prefill";
import type { AiPsurV4PrefillResponse } from "@/services/api/ai";

const AT = "2026-10-04T12:00:00.000Z";
const empty: AiPsurV4PrefillResponse = {
  fields: {},
  diseases: [],
  exposure: null,
  adrs: [],
  signals: [],
  ai_used: true,
};

describe("prefillFromAi", () => {
  it("maps each AI field to its V4 field and drops what was not found", () => {
    const p = prefillFromAi(
      {
        ...empty,
        fields: { rsi_type_version: " SmPC v7.2 (p. 12) ", studies: null, rsi_changes: "" },
      },
      AT,
    );
    expect(p.fields).toEqual({ S4_TYPE_VERSION: "SmPC v7.2 (p. 12)" });
  });

  it("keeps the evaluator's column empty and drops blank rows", () => {
    const p = prefillFromAi(
      {
        ...empty,
        adrs: [
          { soc: "Skin", interval: "12", cumulative: "140", nigerian: "2" },
          { soc: " ", interval: "", cumulative: "", nigerian: "" },
        ],
        signals: [
          {
            signal: "",
            source: "",
            status: "",
            method: "",
            outcome: "",
            date_closed: "",
            action: "",
          },
        ],
      },
      AT,
    );
    expect(p.tables.adrs).toEqual([
      { soc: "Skin", interval: "12", cumulative: "140", nigerian: "2", assessment: "" },
    ]);
    expect(p.tables.signals).toBeUndefined();
  });

  it("builds the exposure table only when something was stated", () => {
    expect(prefillFromAi(empty, AT).tables.exposure).toBeUndefined();
    const p = prefillFromAi(
      {
        ...empty,
        exposure: {
          global_interval: null,
          global_cumulative: null,
          nigerian_interval: "38,400 treatment courses (p. 9)",
          nigerian_cumulative: null,
          other_region: null,
          other_interval: null,
          other_cumulative: null,
        },
      },
      AT,
    );
    expect(p.tables.exposure!.nigerian.interval).toBe("38,400 treatment courses (p. 9)");
  });

  it("records a failure instead of pre-filling anything", () => {
    const p = prefillFromAi({ ...empty, ai_used: false, error: "AI unavailable" }, AT);
    expect(p).toEqual({ fields: {}, tables: {}, generatedAt: AT, error: "AI unavailable" });
  });
});
