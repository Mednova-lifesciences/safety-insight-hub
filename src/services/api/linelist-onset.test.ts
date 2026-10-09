import { describe, expect, it } from "vitest";
import {
  explainUnreadableInterval,
  readDateInIntervalCell,
  readOnsetInterval,
  resolveOnset,
} from "./linelist-onset";
import { writeCell } from "./linelist-change-log";
import {
  buildFixedCsv,
  ONSET_USED_COLUMN,
  isFixedFileAnnotationColumn,
} from "./linelist-fixed-csv";
import { onsetUsedForRows, runValidation, type ParsedRow } from "./linelist";

// Every value below was written by a real reporter in the onset-interval
// column of the 2026 Ondo AEFI line list.

describe("onset interval — what reporters actually wrote", () => {
  it("reads a date written where the interval belongs as the onset date, no vaccination date needed", () => {
    expect(resolveOnset(undefined, "28/1/2026")?.date).toBe("2026-01-28");
    expect(resolveOnset("02/02/2026", "04/02/2026")?.date).toBe("2026-02-04");
    expect(resolveOnset(undefined, "28/1/2026")?.note).toContain(
      "held the onset date rather than an interval",
    );
  });

  it("reads a date and time, keeping the time in the note", () => {
    expect(readDateInIntervalCell("05/02/2026, 12:00")).toEqual({
      date: "2026-02-05",
      time: "12:00",
    });
    expect(readDateInIntervalCell("06/02/2026, 9:30AM")).toEqual({
      date: "2026-02-06",
      time: "09:30",
    });
    expect(readDateInIntervalCell("13/01/2026: 2:10PM")).toEqual({
      date: "2026-01-13",
      time: "14:10",
    });
    expect(readDateInIntervalCell("13/01/2026: 4;00")).toEqual({
      date: "2026-01-13",
      time: "04:00",
    });
    expect(readDateInIntervalCell("13/01/2026 14;25")).toEqual({
      date: "2026-01-13",
      time: "14:25",
    });
    const r = resolveOnset(undefined, "06/02/2026, 9:30AM")!;
    expect(r.date).toBe("2026-02-06");
    expect(r.note).toContain("2026-02-06 09:30");
    expect(r.note).toContain("the onset date and time");
  });

  it("uses the date and says so when the time part cannot be read", () => {
    const r = resolveOnset(undefined, "05/02/2026, about noon")!;
    expect(r.date).toBe("2026-02-05");
    expect(r.note).toContain('The rest ("about noon") could not be read as a time');
  });

  it("reads misspelled units, including '24 house' as 24 hours", () => {
    expect(readOnsetInterval("10 MINITES")).toEqual({
      ms: 600_000,
      readAs: "10 minutes",
      interpreted: true,
    });
    expect(readOnsetInterval("30MINUT")?.ms).toBe(30 * 60_000);
    expect(readOnsetInterval("24 house")).toEqual({
      ms: 24 * 3_600_000,
      readAs: "24 hours",
      interpreted: true,
    });
    expect(resolveOnset("02/02/2026", "24 house")?.date).toBe("2026-02-03");
    expect(resolveOnset("02/02/2026", "24 house")?.note).toContain("(read as 24 hours)");
  });

  it("reads two-part durations", () => {
    expect(readOnsetInterval("5hrs 30min")).toEqual({
      ms: 5.5 * 3_600_000,
      readAs: "5 hours 30 minutes",
      interpreted: true,
    });
    expect(readOnsetInterval("3hrs 15min")?.ms).toBe(3.25 * 3_600_000);
  });

  it("standard spellings get a plain note, with no 'read as'", () => {
    const r = resolveOnset("02/02/2026", "6HOURS")!;
    expect(r.date).toBe("2026-02-02");
    expect(r.note).toBe(
      'Onset date 2026-02-02 worked out from vaccination date "02/02/2026" + onset interval "6HOURS".',
    );
  });

  it("never guesses: unit only, number only, a time with no date, free text, a broken date", () => {
    for (const v of [
      "days",
      "DAYS",
      "hrs",
      "24",
      "4",
      "10:00am",
      "04:00pm",
      "FEW MINUTES AFTER INTAKE",
      "13/12026",
      "2 days later maybe",
    ]) {
      expect(resolveOnset("02/02/2026", v), v).toBeNull();
    }
  });

  it("explains each unreadable kind in words the officer can take to the reporter", () => {
    expect(explainUnreadableInterval("DAYS")).toContain("has a unit but no number");
    expect(explainUnreadableInterval("24")).toContain("has no unit");
    expect(explainUnreadableInterval("10:00am")).toContain("time of day with no date");
    expect(explainUnreadableInterval("FEW MINUTES AFTER INTAKE")).toContain(
      "could not be read as a duration or a date",
    );
  });

  it("validation stops flagging a date-in-interval row, and gives the specific reason otherwise", () => {
    const mapping = {
      "Date of Last immunisation": "vaccination_date",
      "Onset Time interval": "onset_interval",
    };
    const rows: ParsedRow[] = [
      { vaccination_date: "02/02/2026", onset_interval: "days" },
      { vaccination_date: "02/02/2026", onset_interval: "24" },
    ];
    const issues = runValidation(Object.keys(mapping), mapping as never, rows).filter(
      (i) => i.code === "MISSING_ONSET_DATE",
    );
    expect(issues.map((i) => i.row)).toEqual([1, 2]);
    expect(issues[0]!.message).toContain("unit but no number");
    expect(issues[1]!.message).toContain("has no unit");
  });
});

describe("the onset date follows corrections", () => {
  it("recomputes a worked-out onset date when the vaccination date is corrected", () => {
    const rows = {
      parsedRows: [
        { vaccination_date: "2/3/26", onset_interval: "2 days", onset_date: "2026-03-04" },
      ],
      mapping: { Vac: "vaccination_date", Interval: "onset_interval" },
    };
    writeCell(rows, 1, "Vac", "02/02/2026");
    expect(rows.parsedRows[0]!["onset_date"]).toBe("2026-02-04");
    writeCell(rows, 1, "Interval", "days");
    expect(rows.parsedRows[0]!["onset_date"]).toBeUndefined();
  });

  it("leaves a source-stated onset date alone", () => {
    const rows = {
      parsedRows: [{ vaccination_date: "2/3/26", onset_date: "05/03/2026" }],
      mapping: { Vac: "vaccination_date", Onset: "onset_date" },
    };
    writeCell(rows, 1, "Vac", "02/02/2026");
    expect(rows.parsedRows[0]!["onset_date"]).toBe("05/03/2026");
  });
});

describe("fixed file: the onset date used, and how", () => {
  const mapping = { Vac: "vaccination_date", Interval: "onset_interval" };
  const parsed: ParsedRow[] = [
    { vaccination_date: "02/02/2026", onset_interval: "2 days" },
    { onset_interval: "05/02/2026, 12:00" },
    { vaccination_date: "02/02/2026", onset_interval: "DAYS" },
  ];

  it("adds the column before Changes made and puts the note in Changes made", () => {
    const csv = buildFixedCsv({
      columns: ["Vac", "Interval"],
      rows: [
        { Vac: "02/02/2026", Interval: "2 days" },
        { Vac: "", Interval: "05/02/2026, 12:00" },
        { Vac: "02/02/2026", Interval: "DAYS" },
      ],
      changeLog: [],
      decisions: [],
      issues: [],
      unresolved: [],
      preservedSourceText: [],
      onsetUsed: onsetUsedForRows(parsed, mapping),
    });
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      `Vac,Interval,${ONSET_USED_COLUMN},Changes made,Decision,Still needs review`,
    );
    expect(lines[1]).toContain(",2026-02-04,");
    expect(lines[1]).toContain(
      'worked out from vaccination date ""02/02/2026"" + onset interval ""2 days""',
    );
    expect(lines[2]).toContain(",2026-02-05,");
    expect(lines[2]).toContain("2026-02-05 12:00");
    expect(lines[3]).toBe("02/02/2026,DAYS,,,,");
  });

  it("is a note column on re-upload, never mapped as data", () => {
    expect(isFixedFileAnnotationColumn(ONSET_USED_COLUMN)).toBe(true);
  });

  it("shows nothing for a file with neither an onset date nor an interval", () => {
    expect(onsetUsedForRows([{}], { Sex: "sex" })).toBeUndefined();
  });
});
