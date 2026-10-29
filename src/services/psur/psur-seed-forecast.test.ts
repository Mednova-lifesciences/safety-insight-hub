import { describe, expect, it } from "vitest";
import type { PsurDocumentSummary } from "@/types/pv";
// The demo PSURs are generated from this same builder (scripts/seed).
import { buildPsurSeed } from "../../../scripts/seed/psur-seed-data.mjs";
import { forecastPsurs } from "./psur-calendar";

describe("the synthetic demo PSURs", () => {
  for (const day of ["2026-10-29", "2026-11-01", "2027-02-15"]) {
    it(`paint the intended picture on ${day}`, () => {
      const today = new Date(`${day}T00:00:00Z`);
      const docs = buildPsurSeed(today) as unknown as PsurDocumentSummary[];
      expect(docs.length).toBeGreaterThanOrEqual(8);
      expect(new Set(docs.map((d) => d.mah)).size).toBe(4);
      const byProduct = Object.fromEntries(forecastPsurs(docs, today).map((f) => [f.product, f]));
      expect(byProduct["TEST Amlodipine 5 mg tablets"]!.status).toBe("OVERDUE");
      expect(byProduct["TEST Metformin 500 mg tablets"]!.status).toBe("DUE_NOW");
      const ceftriaxone = byProduct["TEST Ceftriaxone 1 g injection"]!;
      expect(ceftriaxone.status).toBe("DUE_IN");
      expect(ceftriaxone.nextDlpSource).toBe("RECORDED");
      expect(byProduct["TEST Artemether-Lumefantrine 20/120 mg"]!.status).toBe("CANNOT_FORECAST");
      expect(byProduct["TEST Amlodipine 5 mg tablets"]!.mahHistory).toEqual({
        late: 2,
        assessed: 3,
      });
    });
  }
});
