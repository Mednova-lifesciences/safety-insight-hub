import { useEffect, useState } from "react";
import { History, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Section, StatusPill } from "@/components/pv/primitives";
import { ConfirmWithPassword } from "@/components/pv/confirm-with-password";
import { c17Rules, type C17RuleVersionRecord } from "@/services/api/c17-rules";
import {
  C17_CRITERION_LABELS,
  C17_TRIGGER_LABELS,
  DEFAULT_C17_RULE,
  normalizeMedicallyImportantTerms,
  type C17Criterion,
  type C17Rule,
  type C17VaccineTrigger,
} from "@/services/e2b-r3/c17-rule";
import { isApiConfigured } from "@/services/api/client";

/**
 * The C.1.7 rule, as something the assessors own rather than something the
 * code decides. Any of the qualified assessors may change it, each change
 * is a new version signed with their own password, and the previous
 * versions stay readable — a decision can always be traced to the rule
 * text that was in force when it was taken.
 *
 * Changing the rule never touches a decision already finalized: those are
 * immutable by design.
 */
export function C17RuleSection({ canEdit }: { canEdit: boolean }) {
  const [record, setRecord] = useState<C17RuleVersionRecord | null>(null);
  const [draft, setDraft] = useState<C17Rule>(DEFAULT_C17_RULE);
  const [terms, setTerms] = useState(DEFAULT_C17_RULE.medicallyImportantTerms.join(", "));
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<C17RuleVersionRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [{ rule, record: active }, versions] = await Promise.all([
        c17Rules.active(),
        c17Rules.history(),
      ]);
      setRecord(active ?? null);
      setDraft(rule);
      setTerms(normalizeMedicallyImportantTerms(rule.medicallyImportantTerms).join(", "));
      setHistory(versions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the C.1.7 rule.");
    }
  }

  useEffect(() => {
    if (!isApiConfigured()) return;
    load();
  }, []);

  const inForce = record?.rule ?? DEFAULT_C17_RULE;
  const parsedTerms = normalizeMedicallyImportantTerms(terms.split(/[,\n]/));
  const next: C17Rule = { ...draft, medicallyImportantTerms: parsedTerms };
  // Compare against the rule as it would be written today, so a list that was
  // saved with repeats does not read as an unsaved change forever.
  const inForceTidied: C17Rule = {
    ...inForce,
    medicallyImportantTerms: normalizeMedicallyImportantTerms(inForce.medicallyImportantTerms),
  };
  const changed = JSON.stringify(next) !== JSON.stringify(inForceTidied);
  const sameVersion = next.version.trim() === inForce.version.trim();

  async function save() {
    const saved = await c17Rules.save(next, note.trim() || undefined);
    setConfirming(false);
    setNote("");
    toast.success(
      `C.1.7 rule v${saved.rule.version} is now in force. Run preflight again to apply it to cases still awaiting a decision.`,
    );
    await load();
  }

  function toggleCriterion(key: C17Criterion) {
    setDraft((d) => ({ ...d, criteria: { ...d.criteria, [key]: !d.criteria[key] } }));
  }
  function toggleTrigger(key: C17VaccineTrigger) {
    setDraft((d) => ({
      ...d,
      vaccineTriggers: { ...d.vaccineTriggers, [key]: !d.vaccineTriggers[key] },
    }));
  }

  return (
    <Section
      id="c17-rule"
      title="C.1.7 — expedited reporting rule"
      description="What makes a case an expedited report. The rule recommends; a qualified assessor still decides each case. Changing it needs your password and creates a new version — earlier versions are kept."
      actions={
        <Button size="sm" variant="outline" onClick={() => setShowHistory((v) => !v)}>
          <History className="size-4" /> {showHistory ? "Hide history" : "History"}
        </Button>
      }
    >
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusPill tone="success" icon={<ShieldCheck className="size-3" />}>
            In force: v{inForce.version}
          </StatusPill>
          <span className="text-muted-foreground">
            {record
              ? `${inForce.name} — set by ${record.changedBy} (${record.changedByRole}) on ${new Date(record.createdAt).toLocaleString()}`
              : `${inForce.name} — the agreed default, not yet changed by anyone here`}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="c17-name">Rule name</Label>
            <Input
              id="c17-name"
              value={draft.name}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c17-version">Version</Label>
            <Input
              id="c17-version"
              value={draft.version}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c17-jurisdiction">Jurisdiction</Label>
            <Input
              id="c17-jurisdiction"
              value={draft.jurisdiction}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, jurisdiction: e.target.value }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">A case is an expedited report when it is…</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(Object.keys(C17_CRITERION_LABELS) as C17Criterion[]).map((key) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.criteria[key]}
                  disabled={!canEdit}
                  onChange={() => toggleCriterion(key)}
                />
                <span>{C17_CRITERION_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">…or, for vaccines, when the case involves</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(Object.keys(C17_TRIGGER_LABELS) as C17VaccineTrigger[]).map((key) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.vaccineTriggers[key]}
                  disabled={!canEdit}
                  onChange={() => toggleTrigger(key)}
                />
                <span>{C17_TRIGGER_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="c17-terms">
            Reactions that count as medically important on their own
          </Label>
          <Textarea
            id="c17-terms"
            rows={3}
            value={terms}
            disabled={!canEdit}
            onChange={(e) => setTerms(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Separated by commas. Matched against the reaction's own words, so spelling variants of
            the same event should each be listed.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={draft.aiAssistWhenUnclear}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, aiAssistWhenUnclear: e.target.checked }))}
          />
          <span>
            <span className="font-medium">
              Ask AI when the case does not say whether it is serious
            </span>
            <span className="block text-xs text-muted-foreground">
              The model reads that case and suggests an answer with its reasons. It is only ever a
              suggestion: a qualified assessor still decides.
            </span>
          </span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="c17-notes">Why the rule says this</Label>
          <Textarea
            id="c17-notes"
            rows={3}
            value={draft.notes}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          />
        </div>

        {canEdit ? (
          confirming ? (
            <ConfirmWithPassword
              title={`Put "${next.name}" v${next.version} in force?`}
              warning="Every case assessed from now on is judged by this rule, and the change is recorded against your name. Decisions already finalized are not affected."
              confirmLabel="Sign and put in force"
              actionName="the C.1.7 rule change"
              blockedReason={
                sameVersion
                  ? `Give the new rule a version different from the one in force (v${inForce.version}), so each decision can be traced to the text that produced it.`
                  : undefined
              }
              onConfirmed={save}
              onCancel={() => setConfirming(false)}
            >
              <div className="space-y-1.5">
                <Label htmlFor="c17-note">What changed, and why</Label>
                <Input
                  id="c17-note"
                  placeholder="e.g. NAFDAC confirmed the criteria on 20 Sep 2026"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </ConfirmWithPassword>
          ) : (
            <div className="flex items-center gap-3">
              <Button size="sm" disabled={!changed} onClick={() => setConfirming(true)}>
                Save rule…
              </Button>
              {changed ? (
                <span className="text-xs text-muted-foreground">
                  Unsaved changes. Nothing applies until you sign them.
                </span>
              ) : null}
            </div>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            Only a Review Officer, Evaluator or Peer Reviewer can change this rule.
          </p>
        )}

        {showHistory ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium">Versions</p>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No change has been saved yet; the agreed default is in force.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {history.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={v.status === "ACTIVE" ? "success" : "neutral"}>
                      v{v.rule.version}
                    </StatusPill>
                    <span>{v.rule.name}</span>
                    <span className="text-muted-foreground">
                      {v.changedBy} ({v.changedByRole}) · {new Date(v.createdAt).toLocaleString()}
                      {v.note ? ` · ${v.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
