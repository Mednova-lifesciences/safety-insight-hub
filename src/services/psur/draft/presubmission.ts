import type { PsurDraft } from "./drafts";
import { draftReadiness } from "./status";
import { INPUTS, SECTIONS, type InputKey } from "./template";
import { SCREENING_CHECKS } from "@/services/psur/screening-checklist";
import { windowDaysFor, addMonthsIso } from "@/services/psur/own-brand-calendar";
import { addDaysIso, daysBetween, todayIso } from "@/services/api/regulatory-clock";

/**
 * The draft checked the way NAFDAC's Review Officer will screen it: the 16
 * items of the PSUR Administrative Screening Checklist (same wording, same
 * numbers, taken from screening-checklist.ts) plus the Nigerian requirements
 * of the V4 evaluation form. Deterministic — no AI. Each item is
 *
 *   PASS    the draft satisfies it
 *   ACTION  something in the draft must be completed first
 *   MANUAL  only a person can confirm it (a signature, NAFDAC's own record,
 *           the PDF actually submitted)
 */

export type CheckResult = "PASS" | "ACTION" | "MANUAL";

export interface PresubmissionItem {
  key: string;
  number?: number | undefined;
  label: string;
  result: CheckResult;
  detail: string;
}

const filled = (d: PsurDraft, k: InputKey) => !!d.inputs[k]?.trim();
const missing = (d: PsurDraft, keys: InputKey[]) => keys.filter((k) => !filled(d, k));
const names = (keys: InputKey[]) => keys.map((k) => INPUTS[k].label).join(", ");

function fromInputs(
  d: PsurDraft,
  keys: InputKey[],
  ok: string,
  manual?: string,
): Omit<PresubmissionItem, "key" | "label" | "number"> {
  const m = missing(d, keys);
  if (m.length) return { result: "ACTION", detail: `Complete: ${names(m)}.` };
  return manual ? { result: "MANUAL", detail: `${ok} ${manual}` } : { result: "PASS", detail: ok };
}

export function presubmissionCheck(draft: PsurDraft, today = todayIso()): PresubmissionItem[] {
  const readiness = draftReadiness(draft);
  const st = readiness.statuses;
  const regNo = draft.inputs.nafdacRegNo?.trim() || draft.facts?.registration?.registrationNumber;
  const deadline = addDaysIso(draft.dlp, windowDaysFor(draft.intervalMonths))!;
  const daysLeft = daysBetween(today, deadline) ?? 0;

  const byId: Record<string, Omit<PresubmissionItem, "key" | "label" | "number">> = {
    COVER_LETTER_COMPLETE: (() => {
      const m = missing(draft, ["mahName", "mahAddress", "strengthsAndForms", "qppvName"]);
      if (!regNo)
        return {
          result: "ACTION",
          detail: `Complete: NAFDAC registration number${m.length ? `, ${names(m)}` : ""}.`,
        };
      if (m.length) return { result: "ACTION", detail: `Complete: ${names(m)}.` };
      return {
        result: "MANUAL",
        detail:
          "Product, strengths, Reg. No. and interval are stated. Print on letterhead and have the QPPV sign it.",
      };
    })(),
    QPPV_DETAILS_STATED: fromInputs(
      draft,
      [
        "qppvName",
        "qppvPhone",
        "qppvEmail",
        "deputyQppvName",
        "deputyQppvPhone",
        "deputyQppvEmail",
      ],
      "QPPV and deputy details are on the cover letter and title page.",
      "Confirm they match NAFDAC's QPPV record.",
    ),
    ONE_PSUR_PER_ACTIVE_SUBSTANCE: fromInputs(
      draft,
      ["activeSubstance", "strengthsAndForms"],
      "One active substance and its strengths are stated.",
      "Confirm name and strength match the NAFDAC certificate exactly.",
    ),
    PDF_OPENS_AND_FOLLOWS_TEMPLATE: {
      result: "MANUAL",
      detail:
        "The draft follows the NAFDAC template (title page, executive summary, Sections 1–21, appendices). Save the clean draft as a single PDF and check it opens fully.",
    },
    IBD_AND_FIRST_REGISTRATION_STATED: (() => {
      if (!draft.ibd)
        return {
          result: "ACTION",
          detail: "Set the international birth date on the PSUR calendar schedule.",
        };
      if (!filled(draft, "firstNigerianRegistration"))
        return { result: "ACTION", detail: "Complete: Date of first NAFDAC registration." };
      for (let k = 1; k <= 400; k++) {
        const anniversary = addMonthsIso(draft.ibd, k * draft.intervalMonths);
        if (!anniversary || anniversary > draft.dlp) break;
        if (anniversary === draft.dlp)
          return {
            result: "PASS",
            detail:
              "Both dates are on the title page, and the DLP falls on an IBD-based anniversary.",
          };
      }
      return {
        result: "ACTION",
        detail: `The DLP (${draft.dlp}) is not an IBD-based anniversary of ${draft.ibd} at a ${draft.intervalMonths}-month interval — check the schedule.`,
      };
    })(),
    DLP_AND_INTERVAL_CONSISTENT: {
      result: "PASS",
      detail:
        "The DLP and interval are printed from one setting on the cover letter, title page and executive summary.",
    },
    INTERVAL_CONTIGUOUS: filled(draft, "previousQueries")
      ? {
          result: "MANUAL",
          detail: `This interval starts the day after ${draft.periodStart}. Confirm that was the DLP of the last PSUR NAFDAC holds, or that Section 20 states this is a first submission.`,
        }
      : {
          result: "ACTION",
          detail:
            "Complete Section 20: respond to the previous assessment, or state this is the first submission.",
        },
    RECEIVED_WITHIN_TIMEFRAME:
      daysLeft < 0
        ? {
            result: "ACTION",
            detail: `The submission deadline was ${deadline} (DLP + ${windowDaysFor(draft.intervalMonths)} days): ${-daysLeft} day(s) late. State the reason in the cover letter.`,
          }
        : {
            result: "PASS",
            detail: `Due by ${deadline} (DLP + ${windowDaysFor(draft.intervalMonths)} days): ${daysLeft} day(s) left.${draft.facts?.registration?.expiryDate && daysBetween(deadline, draft.facts.registration.expiryDate)! < 183 ? " The registration expires within 6 months of the deadline — NAFDAC expects the PSUR at least 6 months before renewal." : ""}`,
          },
    TITLE_PAGE_COMPLETE_AND_SIGNED:
      st.TITLE_PAGE === "NEEDS_AUTHOR" || st.TITLE_PAGE === "NEEDS_DATA"
        ? { result: "ACTION", detail: "Complete the highlighted fields on the title page." }
        : {
            result: "MANUAL",
            detail:
              "Title page complete with the confidentiality statement. The Nigerian QPPV must sign and date it.",
          },
    EXECUTIVE_SUMMARY_COMPLETE:
      st.EXEC_SUMMARY === "NEEDS_AUTHOR" || st.EXEC_SUMMARY === "NEEDS_DATA"
        ? {
            result: "ACTION",
            detail:
              "The executive summary still prints placeholders from the sections it summarises.",
          }
        : { result: "PASS", detail: "All seven elements are present." },
    SECTIONS_PRESENT_OR_JUSTIFIED: (() => {
      const open = SECTIONS.filter(
        (s) => s.number && (st[s.id] === "NEEDS_AUTHOR" || st[s.id] === "NEEDS_DATA"),
      );
      return open.length
        ? {
            result: "ACTION",
            detail: `Still to complete: Section${open.length > 1 ? "s" : ""} ${open.map((s) => s.number).join(", ")}.`,
          }
        : {
            result: "PASS",
            detail:
              "Sections 1–21 are populated or marked not applicable with a reason; contents and abbreviations are included.",
          };
    })(),
    LINE_LISTING_OR_NIL_STATEMENT: draft.facts
      ? {
          result: "PASS",
          detail: draft.facts.lineListing.length
            ? `Appendix III lists ${draft.facts.lineListing.length} ICSR(s).`
            : "Appendix III carries the nil statement.",
        }
      : { result: "ACTION", detail: "Refresh data from records to build the line listing." },
    LITERATURE_IN_OWN_WORDS: fromInputs(
      draft,
      ["literatureSummary", "literatureStrategy"],
      "Literature summary and search strategy are present.",
      "Check the summary is in your own words and ends with a product-specific assessment.",
    ),
    INTEGRATED_BENEFIT_RISK_ANALYSIS: fromInputs(
      draft,
      ["benefitEvaluation", "integratedBenefitRisk", "conclusionsActions"],
      "Benefit evaluation, integrated analysis and conclusions are present.",
      "Check the analysis draws on the whole report and the conclusion covers new risks, the overall balance and actions.",
    ),
    APPENDIX_RSI_ATTACHED: fromInputs(
      draft,
      ["rsiTypeVersion"],
      "The RSI version is stated in Appendix I.",
      `Attach the SmPC to the submission${draft.inputs.rmpVersion?.trim() ? "" : "; if the product has an RMP, state its version"}.`,
    ),
    PREVIOUS_QUERIES_ADDRESSED: fromInputs(
      draft,
      ["previousQueries"],
      "Section 20 responds to the previous assessment.",
      "Check every query and commitment from the last NAFDAC assessment is covered.",
    ),
  };

  const items: PresubmissionItem[] = SCREENING_CHECKS.map((c) => ({
    key: c.id,
    number: c.number,
    label: c.label,
    ...byId[c.id]!,
  }));

  items.push(
    {
      key: "NIGERIAN_EXPOSURE",
      label:
        "Nigerian exposure for the interval and cumulatively (V4 Section 5) — global figures do not substitute.",
      ...fromInputs(
        draft,
        ["exposureNigeriaInterval", "exposureNigeriaCumulative", "exposureMethod"],
        "Nigerian exposure and its method are stated.",
      ),
    },
    {
      key: "NIGERIAN_CASES",
      label: "Nigerian case counts in the summary tabulations (V4 Section 7).",
      ...(draft.facts
        ? {
            result: "PASS" as const,
            detail: `Stated from the records: ${draft.facts.interval.nigerian} in the interval, ${draft.facts.cumulative.nigerian} cumulatively.`,
          }
        : { result: "ACTION" as const, detail: "Refresh data from records." }),
    },
    {
      key: "NIGERIAN_RECONCILIATION",
      label:
        "Nigerian ICSRs reconciled with what was reported to NAFDAC (the evaluator checks VigiFlow).",
      result: "MANUAL",
      detail:
        "This system cannot see VigiFlow. If you can, state in the Section 6 comment how many of these ICSRs were submitted to NAFDAC.",
    },
  );
  return items;
}

export function presubmissionSummary(items: PresubmissionItem[]) {
  return {
    pass: items.filter((i) => i.result === "PASS").length,
    action: items.filter((i) => i.result === "ACTION").length,
    manual: items.filter((i) => i.result === "MANUAL").length,
  };
}
