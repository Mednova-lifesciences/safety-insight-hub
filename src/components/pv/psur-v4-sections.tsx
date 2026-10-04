import { useState } from "react";
import { toast } from "sonner";
import { usePermission } from "@/lib/auth";
import { Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { psur as psurApi } from "@/services/api/psur";
import { aiSectionAssessment, SECTION_IDS, v4Ticks } from "@/services/psur/v4-report";
import {
  PSUR_V4_TEMPLATE_SECTIONS,
  type PsurDocument,
  type PsurFinding,
  type PsurV4SectionId,
} from "@/types/pv";

const SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => SECTION_IDS[n]!);
const NAME = new Map(PSUR_V4_TEMPLATE_SECTIONS.map((s) => [s.id, s.name]));

interface Draft {
  text: string;
  /** Ticked by the evaluator, or set by editing the text. */
  reviewed: boolean;
}

/**
 * The evaluator's answers to Sections 1-8 of the V4 evaluation form that
 * are not research: the form's three tick boxes, and their own wording of
 * each section's assessment. Until a section is reviewed here, the V4
 * report prints the AI's assessment marked "not yet reviewed".
 */
export function V4SectionsPanel({
  doc,
  findings,
  onChanged,
}: {
  doc: PsurDocument;
  findings: PsurFinding[];
  onChanged: () => void;
}) {
  const canEvaluate = usePermission("psur.evaluate");
  const initialTicks = v4Ticks(doc, findings);
  const [s2Inconsistent, setS2Inconsistent] = useState(initialTicks.s2Inconsistent);
  const [s2Explanation, setS2Explanation] = useState(doc.v4SectionAnswers?.s2Explanation ?? "");
  const [s7AdrTabulation, setS7AdrTabulation] = useState(initialTicks.s7AdrTabulation);
  const [s7VigiflowChecked, setS7VigiflowChecked] = useState(initialTicks.s7VigiflowChecked);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      SECTIONS.map((id) => {
        const saved = doc.v4SectionAnswers?.assessments?.[id];
        return [id, { text: saved?.text ?? aiSectionAssessment(doc, id) ?? "", reviewed: !!saved }];
      }),
    ),
  );
  const [saving, setSaving] = useState(false);

  const setDraft = (id: PsurV4SectionId, d: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...d } }));

  async function save() {
    setSaving(true);
    try {
      const assessments: Partial<Record<PsurV4SectionId, string>> = {};
      for (const id of SECTIONS) {
        const d = drafts[id]!;
        if (d.reviewed && d.text.trim()) assessments[id] = d.text;
      }
      await psurApi.updateV4SectionAnswers(doc.id, {
        s2Inconsistent,
        s2Explanation,
        s7AdrTabulation,
        s7VigiflowChecked,
        assessments,
      });
      toast.success("Sections 1-8 saved.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const tick = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={!canEvaluate}
        aria-label={label}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <Section
      id="v4-sections-1-8"
      title="Sections 1-8 — V4 form answers"
      description="The V4 form's tick boxes, and your own assessment of each section. Until you review a section, the V4 report prints the AI's assessment marked as not yet reviewed."
      actions={
        canEvaluate ? (
          <Button size="sm" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save sections 1-8"}
          </Button>
        ) : null
      }
    >
      <div className="space-y-3">
        {SECTIONS.map((id) => {
          const d = drafts[id]!;
          const saved = doc.v4SectionAnswers?.assessments?.[id];
          return (
            <div key={id} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{NAME.get(id) ?? id}</p>
                {d.reviewed ? (
                  <StatusPill tone="success">
                    {saved?.by ? `Reviewed by ${saved.by}` : "Reviewed"}
                  </StatusPill>
                ) : (
                  <StatusPill tone="assist">AI draft — not yet reviewed</StatusPill>
                )}
              </div>

              {id === "S2_WORLDWIDE_STATUS" ? (
                <>
                  {tick(
                    "Any action inconsistent with, or not yet reflected in, NAFDAC's current position on this product?",
                    s2Inconsistent,
                    setS2Inconsistent,
                  )}
                  {s2Inconsistent ? (
                    <Textarea
                      aria-label="If yes, explain"
                      placeholder="If yes, explain"
                      value={s2Explanation}
                      disabled={!canEvaluate}
                      rows={2}
                      onChange={(e) => setS2Explanation(e.target.value)}
                    />
                  ) : null}
                </>
              ) : null}
              {id === "S7_AGGREGATE_SAFETY_DATA" ? (
                <>
                  {tick(
                    "Attach or reproduce the MAH's summary tabulation of ADRs and identify any SOCs requiring specific regulatory assessment",
                    s7AdrTabulation,
                    setS7AdrTabulation,
                  )}
                  {tick(
                    "Check VigiFlow for the Nigerian component of the product's safety data",
                    s7VigiflowChecked,
                    setS7VigiflowChecked,
                  )}
                </>
              ) : null}

              <Textarea
                aria-label={`Reviewer's assessment of ${NAME.get(id) ?? id}`}
                value={d.text}
                disabled={!canEvaluate}
                rows={3}
                onChange={(e) => setDraft(id, { text: e.target.value, reviewed: true })}
              />
              {canEvaluate ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={d.reviewed}
                    aria-label={`I have reviewed the assessment of ${NAME.get(id) ?? id}`}
                    onCheckedChange={(c) => setDraft(id, { reviewed: c === true })}
                  />
                  I have reviewed this assessment
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
