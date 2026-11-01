import { describe, expect, it } from "vitest";
import type { PsurDocumentSummary, PsurScreeningCheckItem } from "@/types/pv";
import { describeMahHistory, forecastPsurs, submissionRelation } from "./psur-calendar";
import { emptyChecks } from "./screening-checklist";

let n = 0;
function doc(over: {
  product?: string;
  mah?: string;
  dlp?: string;
  interval?: string;
  received?: string;
  nextDue?: string;
  cited?: number[];
  screened?: boolean;
  uploadedAt?: string;
  timeliness?: PsurScreeningCheckItem["status"];
}): PsurDocumentSummary {
  const id = `psur-${++n}`;
  const checks = emptyChecks();
  if (over.timeliness) {
    const item = checks.find((c) => c.id === "RECEIVED_WITHIN_TIMEFRAME")!;
    item.status = over.timeliness;
    item.assistGenerated = false;
  }
  return {
    id,
    filename: `${id}.pdf`,
    product: over.product ?? "Amlodipine 5 mg",
    mah: over.mah ?? "TEST Pharma A",
    uploadedAt: over.uploadedAt ?? "2026-01-10T09:00:00Z",
    administrativeScreening:
      over.screened === false
        ? undefined
        : {
            performedAt: "2026-01-11T09:00:00Z",
            submissionDetails: {
              productName: over.product ?? "Amlodipine 5 mg",
              activeSubstance: "",
              nafdacRegNo: "",
              mah: over.mah ?? "TEST Pharma A",
              qppv: "",
              qppvContact: "",
              ibd: "",
              firstNafdacRegistrationDate: "",
              dlp: over.dlp ?? "31 Dec 2025",
              intervalCovered: over.interval ?? "01 Jan 2025 – 31 Dec 2025",
              dateReceived: over.received ?? "2026-02-15",
            },
            checks,
            assistGenerated: false,
            outcome: {
              decision: "ACCEPTED_FOR_ASSESSMENT",
              citedItems: over.cited ?? [],
              deficiencies: "",
              conclusions: "",
              officerName: "TEST Officer",
              mahResponseDeadline: "",
              nextPsurDueDate: over.nextDue ?? "",
              by: "test.officer",
              at: "2026-01-12T09:00:00Z",
            },
          },
  } as unknown as PsurDocumentSummary;
}

const TODAY = new Date(Date.UTC(2026, 9, 29)); // 29 Oct 2026

/** Uploaded and read at upload (its details, including the DLP), but not
 *  screened yet: no outcome recorded. */
function pending(over: Parameters<typeof doc>[0] & { sha?: string }): PsurDocumentSummary {
  const d = doc(over) as PsurDocumentSummary & { fileSha256?: string };
  const s = d.administrativeScreening!;
  return {
    ...d,
    ...(over.sha ? { fileSha256: over.sha } : {}),
    administrativeScreening: { ...s, outcome: undefined },
  } as PsurDocumentSummary;
}

describe("forecastPsurs", () => {
  it("projects the next DLP from the same interval and adds 70 days for ≤ 12 months", () => {
    const [f] = forecastPsurs(
      [doc({ dlp: "31 Dec 2025", interval: "01 Jan 2025 – 31 Dec 2025" })],
      TODAY,
    );
    expect(f).toMatchObject({
      nextDlp: "2026-12-31",
      deadline: "2027-03-11",
      windowDays: 70,
      status: "DUE_IN",
      nextDlpSource: "SAME_INTERVAL",
    });
  });

  it("uses 90 days for an interval over 12 months", () => {
    const [f] = forecastPsurs(
      [doc({ dlp: "31 Dec 2024", interval: "01 Jan 2023 – 31 Dec 2024" })],
      TODAY,
    );
    expect(f).toMatchObject({ nextDlp: "2026-12-31", windowDays: 90 });
  });

  it("keeps a month-end DLP on the month end for a six-month interval", () => {
    const [f] = forecastPsurs(
      [doc({ dlp: "30 Jun 2026", interval: "01 Jan 2026 – 30 Jun 2026" })],
      TODAY,
    );
    expect(f!.nextDlp).toBe("2026-12-31");
  });

  it("prefers the next-PSUR date the officer recorded", () => {
    const [f] = forecastPsurs([doc({ nextDue: "2026-09-30" })], TODAY);
    expect(f).toMatchObject({
      nextDlp: "2026-09-30",
      nextDlpSource: "RECORDED",
      deadline: "2026-12-09",
      status: "DUE_NOW",
    });
  });

  it("is overdue when the deadline has passed and nothing newer arrived", () => {
    const [f] = forecastPsurs(
      [doc({ dlp: "30 Jun 2025", interval: "01 Jan 2025 – 30 Jun 2025" })],
      TODAY,
    );
    // next DLP 30 Dec 2025, deadline 10 Mar 2026
    expect(f!.status).toBe("OVERDUE");
    expect(f!.daysToDeadline).toBeLessThan(0);
  });

  it("says the next report was received when one with a later DLP is waiting", () => {
    const old = doc({ dlp: "30 Jun 2025", interval: "01 Jan 2025 – 30 Jun 2025" });
    const newer = pending({ dlp: "31 Dec 2025", uploadedAt: "2026-03-01T00:00:00Z" });
    const [f] = forecastPsurs([old, newer], TODAY);
    expect(f!.status).toBe("RECEIVED");
    expect(f!.arrivals.map((a) => a.kind)).toEqual(["NEXT"]);
  });

  it("cannot forecast when the interval is unreadable — never guesses", () => {
    const [f] = forecastPsurs([doc({ interval: "the period since last report" })], TODAY);
    expect(f!.status).toBe("CANNOT_FORECAST");
    expect(f!.deadline).toBeUndefined();
  });

  it("cannot choose the window from a recorded date alone when the interval is unreadable", () => {
    const [f] = forecastPsurs([doc({ interval: "?", nextDue: "2026-12-31" })], TODAY);
    expect(f).toMatchObject({ status: "CANNOT_FORECAST", nextDlp: "2026-12-31" });
  });

  it("builds on the latest screened report of each product and MAH, and ignores unscreened ones", () => {
    const docs = [
      doc({ dlp: "31 Dec 2024", interval: "01 Jan 2024 – 31 Dec 2024" }),
      doc({ dlp: "31 Dec 2025", interval: "01 Jan 2025 – 31 Dec 2025" }),
      doc({ product: "Other", screened: false }),
    ];
    const out = forecastPsurs(docs, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]!.basedOn.dlp).toBe("31 Dec 2025");
  });

  it("puts overdue first", () => {
    const out = forecastPsurs(
      [
        doc({ product: "Later" }),
        doc({ product: "Late", dlp: "30 Jun 2025", interval: "01 Jan 2025 – 30 Jun 2025" }),
      ],
      TODAY,
    );
    expect(out.map((f) => f.status)).toEqual(["OVERDUE", "DUE_IN"]);
  });

  it("counts the MAH's late submissions, preferring the officer's recorded item 8", () => {
    const docs = [
      doc({ product: "P1", received: "2026-02-15" }), // 46 days after DLP: on time
      doc({ product: "P2", received: "2026-04-30" }), // 120 days: late
      doc({ product: "P3", received: "2026-02-15", timeliness: "NO" }), // officer says late
    ];
    const f = forecastPsurs(docs, TODAY)[0]!;
    expect(f.mahHistory).toEqual({ late: 2, assessed: 3 });
    expect(describeMahHistory(f.mahHistory)).toBe("2 of 3 late");
  });

  it("lists the items cited last time to watch for", () => {
    const [f] = forecastPsurs([doc({ cited: [8, 15] })], TODAY);
    expect(f!.watchFor.map((w) => w.number)).toEqual([8, 15]);
  });
});

describe("a dismissed reminder", () => {
  const overdue = () => doc({ dlp: "30 Jun 2025", interval: "01 Jan 2025 – 30 Jun 2025" });
  const dismissal = (deadline: string | null, status = "OVERDUE") => ({
    deadline,
    status,
    by: "TEST Officer",
    role: "REVIEW_OFFICER",
    at: "2026-10-20T09:00:00Z",
  });

  it("stays dismissed for the deadline it was dismissed against", () => {
    const d = overdue();
    const [first] = forecastPsurs([d], TODAY);
    const [f] = forecastPsurs([{ ...d, forecastDismissal: dismissal(first!.deadline!) }], TODAY);
    expect(f!.dismissal?.by).toBe("TEST Officer");
  });

  it("comes back when the deadline changes", () => {
    const d = { ...overdue(), forecastDismissal: dismissal("2025-01-01") };
    expect(forecastPsurs([d], TODAY)[0]!.dismissal).toBeUndefined();
  });

  it("comes back when a newer report is screened, which becomes the basis", () => {
    const old = overdue();
    const [first] = forecastPsurs([old], TODAY);
    const dismissedOld = { ...old, forecastDismissal: dismissal(first!.deadline!) };
    const newer = doc({ dlp: "31 Dec 2025", interval: "01 Jul 2025 – 31 Dec 2025" });
    const [f] = forecastPsurs([dismissedOld, newer], TODAY);
    expect(f!.basedOn.documentId).toBe(newer.id);
    expect(f!.dismissal).toBeUndefined();
  });

  it("without a deadline, holds only while the status is the same", () => {
    const d = doc({ interval: "unreadable" });
    expect(
      forecastPsurs([{ ...d, forecastDismissal: dismissal(null, "CANNOT_FORECAST") }], TODAY)[0]!
        .dismissal,
    ).toBeDefined();
    expect(
      forecastPsurs([{ ...d, forecastDismissal: dismissal(null, "OVERDUE") }], TODAY)[0]!.dismissal,
    ).toBeUndefined();
  });
});

describe("what a report uploaded after the screened one is", () => {
  // Screened: DLP 30 Jun 2025, so the next is due (overdue by now).
  const screened = () => ({
    ...doc({ dlp: "30 Jun 2025", interval: "01 Jan 2025 – 30 Jun 2025" }),
    fileSha256: "aaa",
  });
  const later = "2026-03-01T00:00:00Z";

  it("a corrected copy of the same period is a resubmission, and the next PSUR stays due", () => {
    const [f] = forecastPsurs(
      [screened(), pending({ dlp: "30 Jun 2025", uploadedAt: later, sha: "bbb" })],
      TODAY,
    );
    expect(f!.status).toBe("OVERDUE");
    expect(f!.arrivals.map((a) => a.kind)).toEqual(["RESUBMISSION"]);
  });

  it("the same date written differently is still the same period", () => {
    const [f] = forecastPsurs(
      [screened(), pending({ dlp: "2025-06-30", uploadedAt: later })],
      TODAY,
    );
    expect(f!.arrivals[0]!.kind).toBe("RESUBMISSION");
  });

  it("the exact same file uploaded again is recognised, whatever it is called", () => {
    const again = {
      ...pending({ dlp: "30 Jun 2025", uploadedAt: later, sha: "aaa" }),
      filename: "renamed.pdf",
    };
    const [f] = forecastPsurs([screened(), again], TODAY);
    expect(f!.status).toBe("OVERDUE");
    expect(f!.arrivals[0]).toMatchObject({ kind: "SAME_FILE", filename: "renamed.pdf" });
  });

  it("a report whose DLP could not be read is never assumed to be the next one", () => {
    const unread = pending({ dlp: "", uploadedAt: later });
    const [f] = forecastPsurs([screened(), unread], TODAY);
    expect(f!.status).toBe("OVERDUE");
    expect(f!.arrivals[0]!.kind).toBe("PERIOD_UNCONFIRMED");
  });

  it("an older period is not the next report", () => {
    const [f] = forecastPsurs(
      [screened(), pending({ dlp: "31 Dec 2024", uploadedAt: later })],
      TODAY,
    );
    expect(f!.status).toBe("OVERDUE");
    expect(f!.arrivals[0]!.kind).toBe("EARLIER_PERIOD");
  });
});

describe("submissionRelation — the link shown on a report's page", () => {
  const returned = () => {
    const d = doc({ dlp: "30 Jun 2025", interval: "01 Jan 2025 – 30 Jun 2025", cited: [3, 7] });
    d.administrativeScreening!.outcome!.decision = "NOT_ACCEPTED_RESUBMIT";
    return { ...d, fileSha256: "aaa" };
  };

  it("names the earlier report a resubmission corrects, with its decision and cited items", () => {
    const first = returned();
    const fixed = pending({ dlp: "30 Jun 2025", uploadedAt: "2026-03-01T00:00:00Z", sha: "bbb" });
    const rel = submissionRelation(fixed, [first, fixed]);
    expect(rel).toMatchObject({ kind: "RESUBMISSION", earlier: { id: first.id } });
    expect(rel!.screened!.decision).toBe("NOT_ACCEPTED_RESUBMIT");
    expect(rel!.screened!.citedItems.map((c) => c.number)).toEqual([3, 7]);
  });

  it("says when it is the same file as an earlier upload", () => {
    const first = returned();
    const again = pending({ dlp: "30 Jun 2025", uploadedAt: "2026-03-01T00:00:00Z", sha: "aaa" });
    expect(submissionRelation(again, [first, again])!.kind).toBe("SAME_FILE");
  });

  it("finds nothing for a different period or a different product", () => {
    const first = returned();
    const next = pending({ dlp: "31 Dec 2025", uploadedAt: "2026-03-01T00:00:00Z" });
    const other = pending({
      product: "Metformin 500 mg",
      dlp: "30 Jun 2025",
      uploadedAt: "2026-03-01T00:00:00Z",
    });
    expect(submissionRelation(next, [first, next])).toBeNull();
    expect(submissionRelation(other, [first, other])).toBeNull();
  });

  it("is never the report itself, nor a later one", () => {
    const first = returned();
    const fixed = pending({ dlp: "30 Jun 2025", uploadedAt: "2026-03-01T00:00:00Z" });
    expect(submissionRelation(first, [first, fixed])).toBeNull();
  });
});

describe("a report returned to the MAH", () => {
  const returnedDoc = (over: { resubmitBy?: string } = {}) => {
    const d = doc({
      dlp: "30 Jun 2026",
      interval: "01 Jan 2026 – 30 Jun 2026",
      nextDue: over.resubmitBy ?? "",
    });
    d.administrativeScreening!.outcome!.decision = "NOT_ACCEPTED_RESUBMIT";
    return { ...d, fileSha256: "aaa" };
  };

  it("never uses the resubmission date as the next periodic report's date", () => {
    const [f] = forecastPsurs([returnedDoc({ resubmitBy: "2026-11-15" })], TODAY);
    // Next DLP from the DLP plus the same six-month interval, not 15 Nov.
    expect(f).toMatchObject({ nextDlp: "2026-12-31", nextDlpSource: "SAME_INTERVAL" });
  });

  it("shows the resubmission as due, then overdue", () => {
    expect(
      forecastPsurs([returnedDoc({ resubmitBy: "2026-11-15" })], TODAY)[0]!.resubmission,
    ).toMatchObject({ due: "2026-11-15", daysToDue: 17, received: false });
    expect(
      forecastPsurs([returnedDoc({ resubmitBy: "2026-10-20" })], TODAY)[0]!.resubmission!.daysToDue,
    ).toBe(-9);
  });

  it("an accepted report has no resubmission", () => {
    expect(forecastPsurs([doc({})], TODAY)[0]!.resubmission).toBeUndefined();
  });

  it("is received once a corrected version arrives", () => {
    const first = returnedDoc({ resubmitBy: "2026-10-20" });
    const fixed = pending({ dlp: "30 Jun 2026", uploadedAt: "2026-02-01T00:00:00Z", sha: "bbb" });
    const [f] = forecastPsurs([first, fixed], TODAY);
    expect(f!.resubmission!.received).toBe(true);
    expect(f!.status).not.toBe("RECEIVED");
  });

  it("a version uploaded with 'Upload corrected version' counts even when the original was never read", () => {
    // The original's screening could not read the product or DLP; the
    // corrected version was read properly. Only the officer's link ties them.
    const first = returnedDoc({ resubmitBy: "2026-11-15" });
    first.administrativeScreening!.submissionDetails.dlp = "";
    const fixed = {
      ...pending({
        product: "Amoxicillin/Clavulanate 500/125",
        dlp: "31 Aug 2026",
        uploadedAt: "2026-02-01T00:00:00Z",
        sha: "bbb",
      }),
      resubmissionOf: first.id,
    };
    const [f] = forecastPsurs([first, fixed], TODAY).filter(
      (x) => x.basedOn.documentId === first.id,
    );
    expect(f!.arrivals.map((a) => a.kind)).toEqual(["RESUBMISSION"]);
    expect(f!.resubmission!.received).toBe(true);
    const rel = submissionRelation(fixed, [first, fixed]);
    expect(rel).toMatchObject({ kind: "RESUBMISSION", linked: true, earlier: { id: first.id } });
  });
});
