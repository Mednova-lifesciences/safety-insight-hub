import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { StatusPill, type Tone } from "@/components/pv/primitives";
import { buildAuthoritativeSectionCoverage } from "@/services/psur/section-consistency";
import {
  appraisalCellKind,
  wholeSectionKind,
  type AppraisalCellKind,
} from "@/services/psur/scientific-appraisal";
import type {
  PsurAppraisalQuestion,
  PsurDocument,
  PsurSectionAppraisal,
  PsurSectionStatus,
  PsurV4SectionId,
} from "@/types/pv";

/** The assessors' four questions, in the order they asked them. */
export const APPRAISAL_QUESTIONS: {
  key: "correct" | "classified" | "meaningful" | "interpreted";
  label: string;
}[] = [
  { key: "correct", label: "Is it correct?" },
  { key: "classified", label: "Is it appropriately classified?" },
  { key: "meaningful", label: "Is it scientifically meaningful?" },
  { key: "interpreted", label: "Is it adequately interpreted?" },
];

/** How each kind of answer reads on screen. "Not in submission" and "Not
 *  appraised" are deliberately different from each other and from a verdict:
 *  the first says the MAH left the section out, the second says the AI
 *  failed to return anything, so the assessor knows which one needs them. */
const KIND: Record<AppraisalCellKind, { label: string; tone: Tone; hint: string }> = {
  SOUND: { label: "Sound", tone: "success", hint: "" },
  CONCERN: { label: "Concern", tone: "warning", hint: "" },
  NOT_IN_SUBMISSION: {
    label: "Not in submission",
    tone: "neutral",
    hint: "The MAH did not include this section, so there was nothing to appraise. It is raised as a missing-section finding.",
  },
  NOT_RETURNED: {
    label: "Not appraised",
    tone: "warning",
    hint: "The AI returned no assessment for this section. Appraise it yourself, or re-run the review.",
  },
  INSUFFICIENT_DETAIL: {
    label: "Not enough detail",
    tone: "neutral",
    hint: "The section is present but too thin for the AI to judge this question.",
  },
};

function KindIcon({ kind }: { kind: AppraisalCellKind }) {
  if (kind === "SOUND") return <CheckCircle2 className="size-3.5 shrink-0 text-success" />;
  if (kind === "CONCERN" || kind === "NOT_RETURNED")
    return <AlertTriangle className="size-3.5 shrink-0 text-warning" />;
  return <HelpCircle className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** The section's authoritative coverage status (is it present at all?),
 *  from the same source the rest of the screen uses. */
export function coverageStatusFor(
  doc: PsurDocument,
  section: PsurV4SectionId,
): PsurSectionStatus | undefined {
  return buildAuthoritativeSectionCoverage(doc).find((c) => c.section === section)?.status;
}

export function appraisalFor(
  doc: PsurDocument,
  section: PsurV4SectionId,
): PsurSectionAppraisal | undefined {
  return doc.scientificAppraisal?.sections.find((s) => s.v4Section === section);
}

export function concernCount(s: PsurSectionAppraisal): number {
  return APPRAISAL_QUESTIONS.filter((q) => s[q.key].verdict === "CONCERN").length;
}

function QuestionRow({
  label,
  q,
  kind,
}: {
  label: string;
  q: PsurAppraisalQuestion;
  kind: AppraisalCellKind;
}) {
  const k = KIND[kind];
  // For "nothing to judge" the AI's own reasoning is usually a restatement of
  // the same fact; show our plain-language explanation, then its reasoning.
  return (
    <li className="flex items-start gap-2">
      <KindIcon kind={kind} />
      <div className="min-w-0">
        <p>
          <span className="font-medium">{label}</span>{" "}
          <span className="text-muted-foreground">— {k.label}</span>
        </p>
        {q.reasoning ? <p className="text-muted-foreground">{q.reasoning}</p> : null}
        {k.hint && kind !== "INSUFFICIENT_DETAIL" ? (
          <p className="text-muted-foreground">{k.hint}</p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The critical appraisal of ONE section, shown inside that section of the
 * form. Opens by itself when any of the four questions raised a concern.
 * AI guidance only — the evaluator's own assessment is what is recorded.
 */
export function SectionAppraisal({
  doc,
  section,
}: {
  doc: PsurDocument;
  section: PsurV4SectionId;
}) {
  const s = appraisalFor(doc, section);
  if (!s) return null;
  const status = coverageStatusFor(doc, section);
  const concerns = concernCount(s);
  const whole = wholeSectionKind(s, status);
  // The pill must never say "no concerns" about a section nobody could judge.
  const pill: { tone: Tone; text: string } =
    concerns > 0
      ? { tone: "warning", text: `${concerns} of 4 questions raise a concern` }
      : whole === "NOT_IN_SUBMISSION"
        ? { tone: "neutral", text: "Not in the submission — nothing to appraise" }
        : whole === "NOT_RETURNED"
          ? { tone: "warning", text: "Not appraised — the AI returned nothing for this section" }
          : whole === "INSUFFICIENT_DETAIL"
            ? { tone: "neutral", text: "Too little detail to judge" }
            : { tone: "success", text: "No concerns on the questions it could judge" };
  return (
    <details
      open={concerns > 0 || whole === "NOT_RETURNED"}
      className="rounded-md border border-info/30 bg-info-soft/20 p-3 text-xs"
    >
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Scientific appraisal of what the MAH presented</span>
        <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
      </summary>
      {s.summary ? <p className="mt-2">{s.summary}</p> : null}
      <ul className="mt-2 space-y-2">
        {APPRAISAL_QUESTIONS.map((q) => (
          <QuestionRow
            key={q.key}
            label={q.label}
            q={s[q.key]}
            kind={appraisalCellKind(s[q.key].verdict, s, status)}
          />
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground">
        AI guidance to support your assessment, not a decision. Specific problems appear as findings
        above, each with what the data actually shows and a suggested next step.
      </p>
    </details>
  );
}

const SECTION_SHORT: Partial<Record<PsurV4SectionId, string>> = {
  S1_PRODUCT_REGULATORY: "1. Product & regulatory",
  S2_WORLDWIDE_STATUS: "2. Worldwide status",
  S3_THERAPEUTIC_CONTEXT: "3. Therapeutic context",
  S4_RSI: "4. RSI",
  S5_EXPOSURE_ACTIONS: "5. Exposure & actions",
  S6_LITERATURE: "6. Literature",
  S7_AGGREGATE_SAFETY_DATA: "7. Aggregate safety data",
  S8_SIGNAL_EVALUATION: "8. Signals",
  S9_SPECIAL_POPULATIONS: "9. Special populations",
  S10_BENEFIT_RISK: "10. Benefit-risk",
  S11_UNCERTAINTIES: "11. Uncertainties",
};

/**
 * One card for the whole submission: which sections the appraisal has
 * concerns about, which parts of the document it could not read, and
 * whether it ran at all. Links each row to its section of the form.
 */
export function ScientificAppraisalSummary({ doc }: { doc: PsurDocument }) {
  const a = doc.scientificAppraisal;
  if (!a) return null;
  if (a.error) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft/40 p-3 text-sm"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <p className="font-semibold">The scientific appraisal did not run</p>
          <p className="text-xs text-muted-foreground">
            {a.error} The completeness findings below are unaffected, but nothing has checked
            whether what the MAH presented is correct, appropriately classified, scientifically
            meaningful and adequately interpreted.
          </p>
        </div>
      </div>
    );
  }
  const ctx = a.productContext;
  const coverageByS = new Map(
    buildAuthoritativeSectionCoverage(doc).map((c) => [c.section, c.status]),
  );
  return (
    <div className="space-y-2 rounded-md border border-info/30 bg-info-soft/20 p-3 text-sm">
      <p className="font-semibold">Scientific appraisal — the four questions, section by section</p>
      {ctx && (ctx.activeSubstance || ctx.therapeuticClass || ctx.approvedIndications.length) ? (
        <p className="text-xs text-muted-foreground">
          Read as: {[ctx.activeSubstance, ctx.therapeuticClass].filter(Boolean).join(", ")}
          {ctx.approvedIndications.length
            ? ` — approved for ${ctx.approvedIndications.join("; ")}`
            : ""}
          . If this is wrong, treat the appraisal with caution.
        </p>
      ) : null}
      {a.unreadPages.length ? (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Not read by the appraisal: {a.unreadPages.join("; ")}. Review those pages yourself — a
          section with no concern may simply not have been seen.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Section</th>
              {APPRAISAL_QUESTIONS.map((q) => (
                <th key={q.key} className="py-1 pr-2 font-medium">
                  {q.label.replace("Is it ", "").replace("?", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.sections.map((s) => {
              const status = coverageByS.get(s.v4Section);
              const whole = wholeSectionKind(s, status);
              return (
                <tr key={s.v4Section} className="border-t border-border">
                  <td className="py-1 pr-2">
                    <a href={`#v4-${s.v4Section}`} className="underline underline-offset-2">
                      {SECTION_SHORT[s.v4Section] ?? s.v4Section}
                    </a>
                  </td>
                  {whole === "NOT_IN_SUBMISSION" || whole === "NOT_RETURNED" ? (
                    <td colSpan={4} className="py-1 pr-2" title={KIND[whole].hint}>
                      <span className="inline-flex items-center gap-1">
                        <KindIcon kind={whole} />
                        {whole === "NOT_IN_SUBMISSION"
                          ? "Not in the submission — nothing to appraise"
                          : "Not appraised — the AI returned nothing for this section"}
                      </span>
                    </td>
                  ) : (
                    APPRAISAL_QUESTIONS.map((q) => {
                      const kind = appraisalCellKind(s[q.key].verdict, s, status);
                      return (
                        <td key={q.key} className="py-1 pr-2" title={s[q.key].reasoning}>
                          <span className="inline-flex items-center gap-1">
                            <KindIcon kind={kind} />
                            {KIND[kind].label}
                          </span>
                        </td>
                      );
                    })
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>Not in submission</strong> means the MAH left that section out — there was nothing to
        appraise, and it is raised as a missing-section finding. <strong>Not appraised</strong> is
        different: the AI returned nothing for that section, so appraise it yourself.
      </p>
      <p className="text-xs text-muted-foreground">
        AI guidance{a.model ? ` (${a.model})` : ""} to support your assessment, not a decision.
      </p>
    </div>
  );
}
