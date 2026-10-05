import { describe, expect, it } from "vitest";
import { isAccepted, isCited, renderableEvidence, supersede } from "./evidence";
import type { EvidenceEntry } from "@/types/pv";

function entry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: "e1",
    section: "S5_EXPOSURE_ACTIONS",
    sourceType: "VIGIFLOW_NIGERIA",
    citation: "VigiFlow, Nigeria, 2025-09-01..2026-08-31",
    content: "38,400 treatment courses.",
    origin: "assessor",
    addedBy: "Evaluator",
    addedAt: "2026-10-02T09:00:00Z",
    acceptedBy: "Evaluator",
    acceptedAt: "2026-10-02T09:01:00Z",
    ...overrides,
  };
}

describe("citation", () => {
  it("accepts a real citation", () => {
    expect(isCited(entry())).toBe(true);
  });

  it("rejects an empty citation", () => {
    expect(isCited(entry({ citation: "" }))).toBe(false);
  });

  // Review Focus 1.
  it("rejects a whitespace-only citation", () => {
    expect(isCited(entry({ citation: "   " }))).toBe(false);
  });
});

describe("acceptance", () => {
  it("is accepted when a person accepted it", () => {
    expect(isAccepted(entry())).toBe(true);
  });

  it("is not accepted while acceptedBy is unset", () => {
    const candidate = entry();
    delete (candidate as { acceptedBy?: string }).acceptedBy;
    expect(isAccepted(candidate)).toBe(false);
  });

  it("is not accepted when acceptedBy is blank", () => {
    expect(isAccepted(entry({ acceptedBy: "  " }))).toBe(false);
  });
});

describe("what renders", () => {
  it("keeps accepted, cited entries", () => {
    expect(renderableEvidence([entry()])).toHaveLength(1);
  });

  it("drops an uncited entry even when accepted", () => {
    expect(renderableEvidence([entry({ citation: "" })])).toEqual([]);
  });

  it("drops an unaccepted candidate even when cited", () => {
    const candidate = entry({ id: "e2" });
    delete (candidate as { acceptedBy?: string }).acceptedBy;
    expect(renderableEvidence([candidate])).toEqual([]);
  });

  // Review Focus 2.
  it("renders the superseding entry and not the superseded one, deleting neither", () => {
    const old = entry({ id: "old", content: "38,000 courses." });
    const fresh = entry({ id: "new", content: "38,400 courses.", supersedes: "old" });
    const input = [old, fresh];
    const out = renderableEvidence(input);
    expect(out.map((e) => e.id)).toEqual(["new"]);
    // Append-only: the input array is untouched.
    expect(input).toHaveLength(2);
  });

  it("preserves order for entries that supersede nothing", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    expect(renderableEvidence([a, b]).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("supersede", () => {
  it("links the new entry to the old one", () => {
    const old = entry({ id: "old" });
    const next = supersede(old, { ...entry({ id: "new", content: "corrected" }) });
    expect(next.supersedes).toBe("old");
    expect(next.content).toBe("corrected");
  });

  it("does not mutate the entry being superseded", () => {
    const old = entry({ id: "old" });
    supersede(old, { ...entry({ id: "new" }) });
    expect(old.supersedes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Review finding C1: a non-renderable superseder must not delete the
// evidence it claims to replace.
// ---------------------------------------------------------------------------

describe("only renderable evidence may supersede (finding C1)", () => {
  it("keeps accepted evidence when its superseder was never accepted", () => {
    // An unapproved draft correction must not delete the figure the
    // assessor actually accepted — that would make the memo deny
    // NAFDAC's own evidence.
    const accepted = entry({ id: "A", content: "38,400 courses." });
    const draft = entry({ id: "B", content: "oops", supersedes: "A" });
    delete (draft as { acceptedBy?: string }).acceptedBy;
    expect(renderableEvidence([accepted, draft]).map((e) => e.id)).toEqual(["A"]);
  });

  it("keeps accepted evidence when its superseder carries no citation", () => {
    const accepted = entry({ id: "A" });
    const uncited = entry({ id: "B", citation: "  ", supersedes: "A" });
    expect(renderableEvidence([accepted, uncited]).map((e) => e.id)).toEqual(["A"]);
  });

  it("keeps accepted evidence when its superseder was withdrawn", () => {
    const accepted = entry({ id: "A" });
    const withdrawn = entry({ id: "B", supersedes: "A", withdrawnBy: "Evaluator" });
    expect(renderableEvidence([accepted, withdrawn]).map((e) => e.id)).toEqual(["A"]);
  });

  it("renders only the last entry of a supersession chain", () => {
    const a = entry({ id: "A" });
    const b = entry({ id: "B", supersedes: "A" });
    const c = entry({ id: "C", supersedes: "B" });
    expect(renderableEvidence([a, b, c]).map((e) => e.id)).toEqual(["C"]);
  });

  it("does not let an entry supersede itself into nothing", () => {
    const self = entry({ id: "A", supersedes: "A" });
    expect(renderableEvidence([self]).map((e) => e.id)).toEqual(["A"]);
  });
});
