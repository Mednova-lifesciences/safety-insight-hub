/**
 * The SYNTHETIC screened PSURs behind the "PSURs due and overdue" demo —
 * shared by generate-psurs.mjs and psur-seed-forecast.test.ts so the seed
 * and the test cannot drift apart. See generate-psurs.mjs for the picture
 * they paint.
 */
export function buildPsurSeed(today = new Date()) {
  const T = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const DAY = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const show = (ms) => {
    const d = new Date(ms);
    return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  /** The last day of the month `months` before (negative) or after today. */
  const monthEnd = (months) => {
    const d = new Date(T);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0);
  };
  const monthStartAfter = (endMs) => endMs + DAY;
  const addMonthsEnd = (endMs, months) => {
    const d = new Date(endMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0);
  };

  const CHECK_IDS = [
    "COVER_LETTER_COMPLETE",
    "QPPV_DETAILS_STATED",
    "ONE_PSUR_PER_ACTIVE_SUBSTANCE",
    "PDF_OPENS_AND_FOLLOWS_TEMPLATE",
    "IBD_AND_FIRST_REGISTRATION_STATED",
    "DLP_AND_INTERVAL_CONSISTENT",
    "INTERVAL_CONTIGUOUS",
    "RECEIVED_WITHIN_TIMEFRAME",
    "TITLE_PAGE_COMPLETE_AND_SIGNED",
    "EXECUTIVE_SUMMARY_COMPLETE",
    "SECTIONS_PRESENT_OR_JUSTIFIED",
    "LINE_LISTING_OR_NIL_STATEMENT",
    "LITERATURE_IN_OWN_WORDS",
    "INTEGRATED_BENEFIT_RISK_ANALYSIS",
    "APPENDIX_RSI_ATTACHED",
    "PREVIOUS_QUERIES_ADDRESSED",
  ];

  let n = 0;
  function report({
    product,
    substance,
    mah,
    intervalMonths,
    dlp,
    receivedDays,
    interval,
    nextDue,
    cited = [],
    accepted = true,
  }) {
    n += 1;
    const from = intervalMonths ? addMonthsEnd(dlp, -intervalMonths) + DAY : null;
    const intervalCovered = interval ?? `${show(from)} – ${show(dlp)}`;
    const received = dlp + receivedDays * DAY;
    const allowed = intervalMonths && intervalMonths > 12 ? 90 : 70;
    const late = intervalMonths ? receivedDays > allowed : null;
    const checks = CHECK_IDS.map((id, i) => ({
      id,
      status: cited.includes(i + 1)
        ? "NO"
        : id === "RECEIVED_WITHIN_TIMEFRAME" && late === null
          ? "NOT_ASSESSABLE"
          : "YES",
      deficiency:
        id === "RECEIVED_WITHIN_TIMEFRAME"
          ? late
            ? `Received ${receivedDays} day(s) after the DLP — ${receivedDays - allowed} day(s) beyond the ${allowed}-day window.`
            : late === false
              ? `Received ${receivedDays} day(s) after the DLP, within the ${allowed}-day window.`
              : "The reporting interval could not be read."
          : cited.includes(i + 1)
            ? "TEST: deficiency recorded for the synthetic demo."
            : "",
      assistGenerated: false,
    }));
    if (late) checks[7].status = "NO";
    const id = `psur-test-a-seed-${String(n).padStart(2, "0")}`;
    const at = new Date(received + 2 * DAY).toISOString();
    return {
      id,
      filename: `TEST ${product.replace(/^TEST /, "")} PSUR DLP ${iso(dlp)}.pdf`,
      product,
      mah,
      uploadedAt: new Date(received).toISOString(),
      uploadedBy: "TEST Review Officer",
      stage: accepted ? "REVIEWED" : "EXTRACTED",
      pages: 40,
      pagesEstimated: false,
      sourceType: "PDF",
      reportingPeriod: intervalCovered,
      extractedText: `SYNTHETIC TEST DATA — NOT A REAL SUBMISSION. Periodic Safety Update Report for ${product} (${substance}), ${mah}. Reporting interval: ${intervalCovered}. Data Lock Point: ${show(dlp)}.`,
      workflowStage: accepted ? "PEER_REVIEWED" : "RETURNED_TO_MAH",
      ...(accepted
        ? {
            signOff: {
              conclusion: "TEST: synthetic historical review for the due-date demo.",
              references: "",
              evaluatorName: "TEST Evaluator",
              evaluatorSignedAt: new Date(received + 20 * DAY).toISOString(),
              peerReviewerName: "TEST Peer Reviewer",
              peerReviewedAt: new Date(received + 25 * DAY).toISOString(),
              reviewerConfidence: "HIGH",
            },
          }
        : {}),
      administrativeScreening: {
        performedAt: new Date(received + DAY).toISOString(),
        submissionDetails: {
          productName: product,
          activeSubstance: substance,
          nafdacRegNo: `TEST-${String(1000 + n)}`,
          mah,
          qppv: "TEST QPPV",
          qppvContact: "",
          ibd: "",
          firstNafdacRegistrationDate: "",
          dlp: show(dlp),
          intervalCovered,
          dateReceived: iso(received),
        },
        checks,
        assistGenerated: false,
        outcome: {
          decision: accepted ? "ACCEPTED_FOR_ASSESSMENT" : "COMPLIANCE_DIRECTIVE",
          citedItems: cited,
          deficiencies: cited.length ? "TEST: address the cited items in the next submission." : "",
          conclusions: "TEST: synthetic screening record for the due-date demo.",
          officerName: "TEST Review Officer",
          mahResponseDeadline: accepted ? "" : iso(received + 30 * DAY),
          nextPsurDueDate: nextDue ? iso(nextDue) : "",
          by: "test.officer",
          at,
        },
      },
    };
  }

  const docs = [];
  // TEST Alpha Pharma — 3 submissions, 2 late.
  // Amlodipine, 6-month cycle; latest DLP ten months ago → next DLP four
  // months ago, deadline long passed, nothing newer: OVERDUE.
  docs.push(
    report({
      product: "TEST Amlodipine 5 mg tablets",
      substance: "amlodipine",
      mah: "TEST Alpha Pharma",
      intervalMonths: 6,
      dlp: monthEnd(-16),
      receivedDays: 95,
    }),
  );
  docs.push(
    report({
      product: "TEST Amlodipine 5 mg tablets",
      substance: "amlodipine",
      mah: "TEST Alpha Pharma",
      intervalMonths: 6,
      dlp: monthEnd(-10),
      receivedDays: 88,
      cited: [8],
    }),
  );
  docs.push(
    report({
      product: "TEST Losartan 50 mg tablets",
      substance: "losartan",
      mah: "TEST Alpha Pharma",
      intervalMonths: 12,
      dlp: monthEnd(-3),
      receivedDays: 40,
    }),
  );
  // TEST Beta Labs — Metformin, 12-month cycle; next DLP last month: window open, DUE NOW.
  docs.push(
    report({
      product: "TEST Metformin 500 mg tablets",
      substance: "metformin",
      mah: "TEST Beta Labs",
      intervalMonths: 12,
      dlp: monthEnd(-25),
      receivedDays: 60,
    }),
  );
  docs.push(
    report({
      product: "TEST Metformin 500 mg tablets",
      substance: "metformin",
      mah: "TEST Beta Labs",
      intervalMonths: 12,
      dlp: monthEnd(-13),
      receivedDays: 65,
      cited: [15],
    }),
  );
  // TEST Gamma Health — Ceftriaxone; the officer recorded the next DLP (in 3 weeks).
  docs.push(
    report({
      product: "TEST Ceftriaxone 1 g injection",
      substance: "ceftriaxone",
      mah: "TEST Gamma Health",
      intervalMonths: 12,
      dlp: monthEnd(-24),
      receivedDays: 50,
    }),
  );
  docs.push(
    report({
      product: "TEST Ceftriaxone 1 g injection",
      substance: "ceftriaxone",
      mah: "TEST Gamma Health",
      intervalMonths: 12,
      dlp: monthEnd(-12),
      receivedDays: 52,
      nextDue: T + 21 * DAY,
    }),
  );
  // TEST Delta Medicines — interval written so it cannot be read: CANNOT FORECAST.
  docs.push(
    report({
      product: "TEST Artemether-Lumefantrine 20/120 mg",
      substance: "artemether; lumefantrine",
      mah: "TEST Delta Medicines",
      intervalMonths: null,
      interval: "Period since the last PSUR",
      dlp: monthEnd(-5),
      receivedDays: 45,
    }),
  );
  docs.push(
    report({
      product: "TEST Ibuprofen 400 mg tablets",
      substance: "ibuprofen",
      mah: "TEST Delta Medicines",
      intervalMonths: 12,
      dlp: monthEnd(-2),
      receivedDays: 30,
      accepted: false,
      cited: [1, 9],
    }),
  );

  return docs;
}
