import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, RefreshCw, Undo2 } from "lucide-react";
import { PermissionGate } from "@/components/pv/permission-gate";
import { PageHeader, Section, StatusPill, type Tone } from "@/components/pv/primitives";
import { DraftBlocks } from "@/components/pv/draft-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser, usePermission } from "@/lib/auth";
import { currentActor } from "@/services/api/db";
import { psurDrafts, type PsurDraft } from "@/services/psur/draft/drafts";
import { refreshDraftFacts } from "@/services/psur/draft/refresh";
import {
  INPUTS,
  SECTIONS,
  SECTION_BY_ID,
  sectionHeading,
  type DraftSectionId,
  type InputKey,
} from "@/services/psur/draft/template";
import { intervalFrom, longDate, sectionBlocks } from "@/services/psur/draft/content";
import { STATUS_LABELS, draftReadiness, type SectionStatus } from "@/services/psur/draft/status";
import { cn } from "@/lib/utils";
import { downloadDraftDocx, type DraftVersion } from "@/services/psur/draft/draft-docx";
import {
  presubmissionCheck,
  presubmissionSummary,
  type CheckResult,
} from "@/services/psur/draft/presubmission";
import { recordAudit } from "@/services/api/db";
import { ClipboardCheck, Download } from "lucide-react";

const CHECK_TONE: Record<CheckResult, Tone> = {
  PASS: "success",
  ACTION: "warning",
  MANUAL: "info",
};
const CHECK_LABEL: Record<CheckResult, string> = {
  PASS: "Pass",
  ACTION: "Action needed",
  MANUAL: "Confirm by hand",
};

function PresubmissionPanel({ draft }: { draft: PsurDraft }) {
  const items = presubmissionCheck(draft);
  const sum = presubmissionSummary(items);
  return (
    <Section
      title="Pre-submission check"
      description="The draft checked the way NAFDAC's Review Officer will screen it: the 16 items of the PSUR Administrative Screening Checklist, plus the Nigerian requirements of the V4 evaluation form."
      actions={
        <div className="flex gap-2">
          <StatusPill tone="success">{sum.pass} pass</StatusPill>
          <StatusPill tone="warning">{sum.action} action</StatusPill>
          <StatusPill tone="info">{sum.manual} by hand</StatusPill>
        </div>
      }
    >
      <ul className="space-y-2">
        {items.map((i) => (
          <li
            key={i.key}
            className="grid gap-1 border-b border-border pb-2 last:border-0 sm:grid-cols-[8.5rem_1fr]"
          >
            <span>
              <StatusPill tone={CHECK_TONE[i.result]}>{CHECK_LABEL[i.result]}</StatusPill>
            </span>
            <span className="text-sm">
              <span className="font-medium">
                {i.number ? `${i.number}. ` : ""}
                {i.label}
              </span>
              <span className="block text-muted-foreground">{i.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const Route = createFileRoute("/_app/psur-drafts/$draftId")({
  head: () => ({ meta: [{ title: "PSUR draft — MedNova PV Assist" }] }),
  component: () => (
    <PermissionGate permission="team.view">
      <DraftWorkspace />
    </PermissionGate>
  ),
});

const STATUS_TONE: Record<SectionStatus, Tone> = {
  NOT_APPLICABLE: "neutral",
  NEEDS_AUTHOR: "warning",
  NEEDS_DATA: "warning",
  READY_TO_REVIEW: "info",
  REVIEWED: "success",
};

const SOURCE_LABEL = {
  RECORDS: "Filled from your records",
  MIXED: "Records + author",
  AUTHOR: "Written by the author",
} as const;

function SectionEditor({
  draft,
  id,
  canEdit,
  status,
  onChange,
}: {
  draft: PsurDraft;
  id: DraftSectionId;
  canEdit: boolean;
  status: SectionStatus;
  onChange: (d: PsurDraft) => void;
}) {
  const s = SECTION_BY_ID[id];
  const [values, setValues] = useState<Partial<Record<InputKey, string>>>({});
  const [naReason, setNaReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues(Object.fromEntries(s.inputs.map((k) => [k, draft.inputs[k] ?? ""])));
    setNaReason(draft.sections[id]?.notApplicable?.reason ?? "");
    // Reset only when switching section, not on every save of this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dirty = s.inputs.some((k) => (values[k] ?? "") !== (draft.inputs[k] ?? ""));
  const isNa = status === "NOT_APPLICABLE";

  async function run(fn: () => Promise<PsurDraft>, ok: string) {
    setBusy(true);
    try {
      onChange(await fn());
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title={sectionHeading(s)}
        description={s.guidance}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone="neutral">{SOURCE_LABEL[s.source]}</StatusPill>
            <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusPill>
          </div>
        }
      >
        <p className="label-caps mb-2">As it will print</p>
        <DraftBlocks blocks={sectionBlocks(draft, id)} />
      </Section>

      {s.inputs.length > 0 && !isNa ? (
        <Section
          title="Author input"
          description="Only what you write here is printed as your text. Empty required fields print as a highlighted placeholder."
        >
          <div className="space-y-3">
            {s.inputs.map((k) => {
              const def = INPUTS[k];
              return (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`in-${k}`}>
                    {def.label}{" "}
                    {def.required ? null : (
                      <span className="text-xs text-muted-foreground">(optional)</span>
                    )}
                  </Label>
                  {def.multiline ? (
                    <Textarea
                      id={`in-${k}`}
                      rows={4}
                      disabled={!canEdit}
                      value={values[k] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                    />
                  ) : (
                    <Input
                      id={`in-${k}`}
                      disabled={!canEdit}
                      value={values[k] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">{def.hint}</p>
                </div>
              );
            })}
            {canEdit ? (
              <Button
                size="sm"
                disabled={busy || !dirty}
                onClick={() => run(() => psurDrafts.saveInputs(draft, values), "Saved.")}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            ) : null}
          </div>
        </Section>
      ) : null}

      {s.naAllowed && canEdit ? (
        <Section
          title="Not applicable"
          description="Only if this section genuinely does not apply. The reason is printed in the section."
        >
          <div className="space-y-2">
            <Textarea
              rows={2}
              aria-label="Reason not applicable"
              placeholder="State why this section does not apply."
              value={naReason}
              onChange={(e) => setNaReason(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {s.naSuggestion && !naReason ? (
                <Button size="sm" variant="ghost" onClick={() => setNaReason(s.naSuggestion!)}>
                  Use suggested wording
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !naReason.trim()}
                onClick={() =>
                  run(
                    () =>
                      psurDrafts.setSection(
                        draft,
                        id,
                        { notApplicable: { reason: naReason.trim() } },
                        "marked not applicable",
                      ),
                    "Marked not applicable.",
                  )
                }
              >
                Mark not applicable
              </Button>
              {isNa ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => psurDrafts.setSection(draft, id, {}, "not-applicable mark removed"),
                      "Section is applicable again.",
                    )
                  }
                >
                  <Undo2 className="size-3.5" /> It does apply
                </Button>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      {canEdit && !isNa ? (
        <div className="flex flex-wrap items-center gap-2">
          {status === "REVIEWED" ? (
            <>
              <StatusPill tone="success">
                Reviewed by {draft.sections[id]?.reviewed?.by} ·{" "}
                {draft.sections[id]?.reviewed?.at.slice(0, 16).replace("T", " ")}
              </StatusPill>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      psurDrafts.setSection(
                        draft,
                        id,
                        { ...draft.sections[id], reviewed: undefined },
                        "review withdrawn",
                      ),
                    "Review withdrawn.",
                  )
                }
              >
                <Undo2 className="size-3.5" /> Withdraw review
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy || status !== "READY_TO_REVIEW" || dirty}
              onClick={() =>
                run(
                  () =>
                    psurDrafts.setSection(
                      draft,
                      id,
                      {
                        ...draft.sections[id],
                        reviewed: { by: currentActor().name, at: new Date().toISOString() },
                      },
                      "reviewed",
                    ),
                  "Section marked reviewed.",
                )
              }
            >
              <CheckCircle2 className="size-4" /> I have reviewed this section as it will print
            </Button>
          )}
          {status === "NEEDS_AUTHOR" ? (
            <span className="text-xs text-muted-foreground">
              Complete the highlighted placeholders first.
            </span>
          ) : null}
          {status === "NEEDS_DATA" ? (
            <span className="text-xs text-muted-foreground">Refresh data from records first.</span>
          ) : null}
          {dirty ? (
            <span className="text-xs text-muted-foreground">Save your changes first.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DraftWorkspace() {
  const { draftId } = Route.useParams();
  const user = useCurrentUser();
  const canEdit = usePermission("case.assign");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["psur-draft", draftId],
    queryFn: () => psurDrafts.get(draftId),
  });
  const [selected, setSelected] = useState<DraftSectionId | "CHECK">("TITLE_PAGE");
  const contentRef = useRef<HTMLDivElement>(null);
  // Picking a section low in the list leaves the page scrolled down; bring
  // the chosen section's start back into view.
  useEffect(() => {
    const el = contentRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, [selected]);
  const [exporting, setExporting] = useState<DraftVersion | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const setDraft = (d: PsurDraft) => {
    queryClient.setQueryData(["psur-draft", draftId], d);
    queryClient.invalidateQueries({ queryKey: ["psur-drafts"] });
  };

  if (query.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading draft…</p>;
  if (query.error || !query.data)
    return <p className="p-6 text-sm text-destructive">{query.error?.message ?? "Not found."}</p>;

  const draft = query.data;
  const readiness = draftReadiness(draft);

  async function exportDocx(version: DraftVersion) {
    setExporting(version);
    try {
      await downloadDraftDocx(draft, version);
      await recordAudit({
        action: version === "clean" ? "PSUR_DRAFT_EXPORTED_CLEAN" : "PSUR_DRAFT_EXPORTED_WORKING",
        entity: "PsurDraft",
        entityId: draft.id,
        newValue: `${draft.productName}, DLP ${draft.dlp}`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The draft could not be exported.");
    } finally {
      setExporting(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      setDraft(await refreshDraftFacts(draft, user?.organisation ?? "The holder"));
      toast.success("Data refreshed from the records.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the records.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`PSUR draft — ${draft.productName}`}
        description={`Reporting interval ${longDate(intervalFrom(draft))} to ${longDate(draft.dlp)} · data lock point ${longDate(draft.dlp)}${draft.ibd ? ` · IBD ${longDate(draft.ibd)}` : ""}`}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={readiness.cleanAllowed ? "success" : "neutral"}>
              {readiness.done} of {readiness.total} sections done
            </StatusPill>
            <StatusPill tone={draft.facts ? "neutral" : "warning"}>
              {draft.facts
                ? `Records read ${draft.facts.takenAt.slice(0, 16).replace("T", " ")}`
                : "Records not read yet"}
            </StatusPill>
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to="/psur-drafts">
                <ArrowLeft className="size-4" /> All drafts
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!exporting}
              onClick={() => exportDocx("working")}
            >
              <Download className="size-4" />
              {exporting === "working" ? "Preparing…" : "Working draft (Word)"}
            </Button>
            <Button
              size="sm"
              disabled={!!exporting || !readiness.cleanAllowed}
              title={
                readiness.cleanAllowed
                  ? undefined
                  : "Every section must be reviewed or marked not applicable first."
              }
              onClick={() => exportDocx("clean")}
            >
              <Download className="size-4" />
              {exporting === "clean" ? "Preparing…" : "Clean draft (Word)"}
            </Button>
            {canEdit ? (
              <Button size="sm" variant="outline" disabled={refreshing} onClick={refresh}>
                <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
                {refreshing ? "Reading records…" : "Refresh data from records"}
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-4 p-6 lg:grid-cols-[17rem_1fr]">
        <nav className="panel h-fit p-2 lg:sticky lg:top-16">
          <ul className="space-y-0.5">
            <li>
              <button
                type="button"
                onClick={() => setSelected("CHECK")}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-medium",
                  selected === "CHECK" ? "bg-accent" : "hover:bg-muted",
                )}
              >
                <ClipboardCheck className="size-4" /> Pre-submission check
              </button>
            </li>
            {SECTIONS.map((s) => {
              const st = readiness.statuses[s.id];
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left text-sm",
                      selected === s.id ? "bg-accent" : "hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0">{sectionHeading(s)}</span>
                    <span
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        st === "REVIEWED" || st === "NOT_APPLICABLE"
                          ? "bg-success"
                          : st === "READY_TO_REVIEW"
                            ? "bg-info"
                            : "bg-warning",
                      )}
                      aria-label={STATUS_LABELS[st]}
                      title={STATUS_LABELS[st]}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div ref={contentRef} className="min-w-0 scroll-mt-20">
          {selected === "CHECK" ? (
            <PresubmissionPanel draft={draft} />
          ) : (
            <SectionEditor
              key={selected}
              draft={draft}
              id={selected}
              canEdit={canEdit}
              status={readiness.statuses[selected]}
              onChange={setDraft}
            />
          )}
        </div>
      </div>
    </>
  );
}
