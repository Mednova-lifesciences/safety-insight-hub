import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import { findClusterFlags, type ClusterCase } from "./linelist-clusters";
import { buildReferralDocx, referralFromFlag } from "./pms-referrals";

let n = 0;
const c = (over: Partial<ClusterCase>): ClusterCase => ({
  jobId: "job-a",
  filename: "a.csv",
  row: ++n,
  caseId: `C-${n}`,
  product: "MR",
  batch: "MR2231A",
  facility: "PHC Akure",
  vaccinationDate: "2026-03-01",
  serious: true,
  ...over,
});

const flag = () =>
  findClusterFlags([
    c({ reactions: ["Injection site abscess"] }),
    c({ facility: "PHC Owo", vaccinationDate: "2026-03-06", reactions: ["Vaccine failure"] }),
  ])[0]!;

describe("referralFromFlag", () => {
  it("records the batch, product, cases, facilities, dates, signs and note", () => {
    const r = referralFromFlag(
      flag(),
      "  Two sites, abscess and failure — please test.  ",
      {
        name: "TEST Evaluator",
      },
      new Date("2026-10-30T12:00:00Z"),
    );
    expect(r).toMatchObject({
      kind: "BATCH",
      batches: ["MR2231A"],
      products: ["MR"],
      facilities: ["PHC Akure", "PHC Owo"],
      from: "2026-03-01",
      to: "2026-03-06",
      pattern: "PRODUCT_QUALITY",
      reviewerNote: "Two sites, abscess and failure — please test.",
      status: "REFERRED",
      referredBy: "TEST Evaluator",
      referredAt: "2026-10-30T12:00:00.000Z",
    });
    expect(r.reference).toMatch(/^PMS-2026-\d{4}$/);
    expect(r.cases.map((x) => x.caseId)).toHaveLength(2);
    expect(r.warningSigns.map((w) => w.sign)).toEqual(["LACK_OF_EFFECT", "INJECTION_SITE_ABSCESS"]);
    expect(r.patternNote).toMatch(/possible product quality concern/i);
  });

  it("never calls the product fake or counterfeit", () => {
    const r = referralFromFlag(flag(), "Please test this batch.", { name: "X" });
    expect(JSON.stringify(r)).not.toMatch(/fake|counterfeit|falsified confirmed/i);
  });

  it("builds a Word note", async () => {
    const r = referralFromFlag(flag(), "Please test this batch.", { name: "X" });
    const buffer = await Packer.toBuffer(buildReferralDocx(r));
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});
