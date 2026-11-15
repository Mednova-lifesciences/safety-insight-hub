import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { StatusPill, type Tone } from "@/components/pv/primitives";
import type {
  PsurAppraisalQuestion,
  PsurAppraisalVerdict,
  PsurDocument,
  PsurSectionAppraisal,
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

const VERDICT: Record<PsurAppraisalVerdict, { label: string; tone: Tone }> = {
  SOUND: { label: "Sound", tone: "success" },
  CONCERN: { label: "Concern", tone: "warning" },
  NOT_ASSESSABLE: { label: "Can't tell", tone: "neutral" },
};

function VerdictIcon({ verdict }: { verdict: PsurAppraisalVerdict }) {
  if (verdict === "SOUND") return <CheckCircle2 className="size-3.5 shrink-0 text-success" />;
  if (verdict === "CONCERN") return <AlertTriangle className="size-3.5 shrink-0 text-warning" />;
  return <HelpCircle className="size-3.5 shrink-0 text-muted-foreground" />;
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

function QuestionRow({ label, q }: { label: string; q: PsurAppraisalQuestion }) {
  const v = VERDICT[q.verdict];
  return (
    <li className="flex items-start gap-2">
      <VerdictIcon verdict={q.verdict} />
      <div className="min-w-0">
        <p>
          <span className="font-medium">{label}</span>{" "}
          <span className="text-muted-foreground">— {v.label}</span>
        </p>
        {q.reasoning ? <p className="text-muted-foreground">{q.reasoning}</p> : null}
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
  const concerns = concernCount(s);
  return (
    <details
      open={concerns > 0}
      className="rounded-md border border-info/30 bg-info-soft/20 p-3 text-xs"
    >
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Scientific appraisal of what the MAH presented</span>
        <StatusPill tone={concerns > 0 ? "warning" : "success"}>
          {concerns > 0
            ? `${concerns} of 4 questions raise a concern`
            : "No concerns on the four questions"}
        </StatusPill>
      </summary>
      {s.summary ? <p className="mt-2">{s.summary}</p> : null}
      <ul className="mt-2 space-y-2">
        {APPRAISAL_QUESTIONS.map((q) => (
          <QuestionRow key={q.key} label={q.label} q={s[q.key]} />
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
            {a.sections.map((s) => (
              <tr key={s.v4Section} className="border-t border-border">
                <td className="py-1 pr-2">
                  <a href={`#v4-${s.v4Section}`} className="underline underline-offset-2">
                    {SECTION_SHORT[s.v4Section] ?? s.v4Section}
                  </a>
                </td>
                {APPRAISAL_QUESTIONS.map((q) => (
                  <td key={q.key} className="py-1 pr-2" title={s[q.key].reasoning}>
                    <span className="inline-flex items-center gap-1">
                      <VerdictIcon verdict={s[q.key].verdict} />
                      {VERDICT[s[q.key].verdict].label}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        AI guidance{a.model ? ` (${a.model})` : ""} to support your assessment, not a decision.
      </p>
    </div>
  );
}
