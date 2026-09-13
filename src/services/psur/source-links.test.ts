import { describe, expect, it } from "vitest";
import { buildSourceLink, sourceIsInherentlyLocal } from "./source-links";
import type { PsurFinding, PsurSuggestedSource } from "@/types/pv";

function finding(type: PsurSuggestedSource["type"] | undefined): PsurFinding {
  return {
    id: "f1",
    category: "BENEFIT_RISK",
    severity: "MEDIUM",
    section: "s",
    description: "d",
    evidence: "e",
    ...(type ? { suggestedSource: { type, note: "n" } } : {}),
    assistGenerated: true,
    humanAssessment: null,
    source: "ai",
  };
}

describe("suggested sources link to a real search, not just instructions", () => {
  it("sends a literature finding to a PubMed search for the substance", () => {
    const link = buildSourceLink(
      finding("PUBLISHED_LITERATURE"),
      "Amlodipine besilate 10 mg tablets",
    );
    expect(link!.url).toBe("https://pubmed.ncbi.nlm.nih.gov/?term=Amlodipine%20besilate");
    expect(link!.what).toContain("Amlodipine besilate");
  });

  it("strips strength and dose form so the search is about the substance", () => {
    const link = buildSourceLink(
      finding("PUBLISHED_LITERATURE"),
      "Zeraline (ceftriaxone sodium) 1 g powder for injection",
    );
    expect(link!.url).not.toMatch(/1\s*g|powder|injection/i);
    expect(decodeURIComponent(link!.url)).toContain("ceftriaxone sodium");
  });

  it("never invents a citation — only ever a query against a fixed host", () => {
    const ALLOWED = [
      "pubmed.ncbi.nlm.nih.gov",
      "www.vigiaccess.org",
      "www.who.int",
      "www.ema.europa.eu",
    ];
    for (const t of [
      "PUBLISHED_LITERATURE",
      "VIGIFLOW_NIGERIA",
      "WORLDWIDE_REGULATORY_ACTIONS",
      "RISK_MANAGEMENT_PLAN",
    ] as const) {
      const link = buildSourceLink(finding(t), "Amlodipine");
      expect(link).not.toBeNull();
      expect(ALLOWED).toContain(new URL(link!.url).hostname);
      // A citation would name a paper, volume or page; a search never does.
      expect(link!.what).not.toMatch(/\bet al\b|\b\d{4};\d+/);
    }
  });

  it("does not claim to link into VigiFlow itself, which is authenticated", () => {
    const link = buildSourceLink(finding("VIGIFLOW_NIGERIA"), "Amlodipine");
    expect(link!.site).toMatch(/vigiaccess/i);
    expect(new URL(link!.url).hostname).not.toMatch(/vigiflow/i);
  });

  it("gives no link where no public endpoint can answer the question", () => {
    // Asking the MAH, reading the product's own RSI, or patient/HCP feedback
    // are not things an external site can settle.
    for (const t of [
      "REQUEST_FROM_MAH",
      "REFERENCE_SAFETY_INFORMATION",
      "PATIENT_HCP_FEEDBACK",
      "OTHER",
    ] as const) {
      expect(buildSourceLink(finding(t), "Amlodipine")).toBeNull();
      expect(sourceIsInherentlyLocal(t)).toBe(true);
    }
  });

  it("falls back to the site root rather than opening an empty search", () => {
    const link = buildSourceLink(finding("PUBLISHED_LITERATURE"), "Not yet extracted");
    expect(link!.url).toBe("https://pubmed.ncbi.nlm.nih.gov/");
    expect(link!.what).not.toContain("Not yet extracted");
  });

  it("returns nothing for a finding with no suggested source at all", () => {
    expect(buildSourceLink(finding(undefined), "Amlodipine")).toBeNull();
  });
});
