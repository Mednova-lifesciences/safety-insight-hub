import { describe, expect, it } from "vitest";
import { mapAiAdministrativeScreening } from "./psur";
import { SCREENING_CHECKS, screeningCheck } from "@/services/psur/screening-checklist";
import type { AiPsurScreeningResponse } from "./ai";

/**
 * What the application does with whatever the model returns.
 *
 * These cases are not hypothetical. The fixture below is a real response
 * from gpt-4o against a real PSUR, kept verbatim — including the one answer
 * it got wrong, which is the whole point of the first test.
 */

/** Trimmed from an actual /api/ai/psur/screen-pdf response. */
function liveResponse(): AiPsurScreeningResponse {
  return {
    submission_details: {
      product_name: "Amodiaquine hydrochloride 200 mg tablets",
      active_substance: "Amodiaquine hydrochloride",
      nafdac_reg_no: "A4-100234",
      mah: "Zenith Pharma Nigeria Limited",
      qppv: "Dr Ngozi Eze",
      qppv_contact: "+234 803 555 0142, ngozi.eze@zenithpharma.ng",
      ibd: "12 March 2018",
      first_nafdac_registration_date: "04 August 2019",
      dlp: "30 June 2026",
      interval_covered: "01 July 2025 - 30 June 2026",
    },
    checks: [
      // The model answered YES here. It should not have: the prompt allows
      // YES only when the report declares itself a FIRST submission, and
      // this one says it is the third — which says nothing about whether
      // the interval abuts the previous one.
      {
        id: "INTERVAL_CONTIGUOUS",
        status: "YES",
        deficiency: "Report states it is the third PSUR for the product.",
      },
      {
        id: "QPPV_DETAILS_STATED",
        status: "NOT_ASSESSABLE",
        deficiency: "QPPV details stated on title page: Dr Ngozi Eze.",
      },
      {
        id: "LITERATURE_IN_OWN_WORDS",
        status: "NO",
        deficiency: "Literature review section not included in this submission.",
      },
      {
        id: "APPENDIX_RSI_ATTACHED",
        status: "NO",
        deficiency: "Appendix I (RSI/SmPC) is not attached to this submission.",
      },
    ],
    ai_used: true,
    prompt_version: "test",
  };
}

const RECEIVED = "2026-08-13T09:00:00Z";

function byId(result: ReturnType<typeof mapAiAdministrativeScreening>) {
  return new Map(result.checks.map((c) => [c.id, c]));
}

describe("answers the model is not allowed to give", () => {
  it("overrides a confident YES on an item needing a NAFDAC record", () => {
    // The guard that matters. A wrong YES on "the interval is contiguous
    // with the previous PSUR on file" would tell an officer a check had
    // passed that nobody performed, against a record the system has never
    // seen. The prompt asks for NOT_ASSESSABLE; this makes sure asking is
    // not the only thing standing between the model and the record.
    const result = mapAiAdministrativeScreening(liveResponse(), RECEIVED);
    const row = byId(result).get("INTERVAL_CONTIGUOUS")!;
    expect(row.status).toBe("NOT_ASSESSABLE");
  });

  it("keeps the model's observation but appends the record to check", () => {
    // What it saw in the document is useful to whoever does the manual
    // comparison; what it concluded is not.
    const row = byId(mapAiAdministrativeScreening(liveResponse(), RECEIVED)).get(
      "INTERVAL_CONTIGUOUS",
    )!;
    expect(row.deficiency).toContain("third PSUR");
    expect(row.deficiency).toContain("Check against:");
    expect(row.deficiency).toContain("previous PSUR on file");
  });

  it("forces every externally-verified item, not just the one observed failing", () => {
    const result = byId(mapAiAdministrativeScreening(liveResponse(), RECEIVED));
    for (const def of SCREENING_CHECKS.filter((c) => c.requiresExternalRecord)) {
      expect(result.get(def.id)!.status, `item ${def.number}`).toBe("NOT_ASSESSABLE");
      expect(result.get(def.id)!.deficiency).toContain("Check against:");
    }
  });
});

describe("answers the model did give", () => {
  it("keeps a NO on an item it could genuinely judge", () => {
    const result = byId(mapAiAdministrativeScreening(liveResponse(), RECEIVED));
    expect(result.get("LITERATURE_IN_OWN_WORDS")!.status).toBe("NO");
    expect(result.get("APPENDIX_RSI_ATTACHED")!.status).toBe("NO");
  });

  it("extracts section A verbatim", () => {
    const result = mapAiAdministrativeScreening(liveResponse(), RECEIVED);
    expect(result.submissionDetails.nafdacRegNo).toBe("A4-100234");
    expect(result.submissionDetails.dlp).toBe("30 June 2026");
    // Receipt is the system's own fact, not the model's.
    expect(result.submissionDetails.dateReceived).toBe(RECEIVED);
  });
});

describe("gaps in what came back", () => {
  it("renders all 16 rows even when the model answered four", () => {
    // A short response must not become a short form. The officer sees the
    // whole checklist or they cannot complete it.
    const result = mapAiAdministrativeScreening(liveResponse(), RECEIVED);
    expect(result.checks).toHaveLength(16);
    expect(result.checks.map((c) => screeningCheck(c.id).number)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });

  it("marks unanswered rows as unanswered, never as passing", () => {
    const result = byId(mapAiAdministrativeScreening(liveResponse(), RECEIVED));
    expect(result.get("COVER_LETTER_COMPLETE")!.status).toBe("NOT_ASSESSABLE");
    expect(result.get("COVER_LETTER_COMPLETE")!.deficiency).toMatch(/did not return an answer/i);
  });

  it("computes item 8 rather than waiting for the model to send it", () => {
    // 30 Jun 2026 -> 13 Aug 2026 is 44 days, inside the 70-day window for
    // a ~12-month interval.
    const row = byId(mapAiAdministrativeScreening(liveResponse(), RECEIVED)).get(
      "RECEIVED_WITHIN_TIMEFRAME",
    )!;
    expect(row.status).toBe("YES");
    expect(row.deficiency).toContain("44 day(s)");
  });

  it("still fills the form when the model returns nothing at all", () => {
    const empty: AiPsurScreeningResponse = { ...liveResponse(), checks: [] };
    const result = mapAiAdministrativeScreening(empty, RECEIVED);
    expect(result.checks).toHaveLength(16);
    // Item 8 is computed, so it is answered even here; nothing else is.
    const answered = result.checks.filter((c) => c.status !== "NOT_ASSESSABLE");
    expect(answered.map((c) => c.id)).toEqual(["RECEIVED_WITHIN_TIMEFRAME"]);
  });
});
