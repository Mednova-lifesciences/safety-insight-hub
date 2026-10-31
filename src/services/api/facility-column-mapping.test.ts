import { describe, expect, it } from "vitest";
import { FIELD_KEYWORDS } from "./linelist";
import { mapColumnsByKeywords } from "./tabular-parse";

const map = (headers: string[]) => mapColumnsByKeywords(headers, FIELD_KEYWORDS);

describe("finding the reporting facility column by header", () => {
  it.each([
    ["Reporting Facility"],
    ["Health Facility"],
    ["Name of Health Facility"],
    ["Facility Name"],
  ])("reads %s as the reporting facility", (header) => {
    expect(map(["Case ID", header, "Vaccine"])[header]).toBe("reporter_organization");
  });

  it("keeps a facility's LGA a location, not the facility name", () => {
    const m = map(["Health Facility", "Health Facility LGA"]);
    expect(m["Health Facility"]).toBe("reporter_organization");
    expect(m["Health Facility LGA"]).not.toBe("reporter_organization");
  });

  it("never takes a facility address for the facility name", () => {
    expect(map(["Address of Health Facility"])["Address of Health Facility"]).not.toBe(
      "reporter_organization",
    );
  });
});
