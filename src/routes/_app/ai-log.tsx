import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { PermissionGate } from "@/components/pv/permission-gate";
import {
  EmptyState,
  PageHeader,
  QueryBoundary,
  Section,
  StatusPill,
} from "@/components/pv/primitives";
import { usePvQuery } from "@/lib/data-source";
import { aiDisclosures, type AiDisclosure } from "@/services/api/ai-disclosures";

/**
 * What each AI call sent to OpenAI — field names and how many values of each
 * kind were replaced by placeholder tokens before it left the server. Never
 * the values themselves (there are none to show: the log does not hold
 * them). For administrators (NDPA 2023 accountability).
 */
export const Route = createFileRoute("/_app/ai-log")({
  head: () => ({
    meta: [
      { title: "AI data log — MedNova PV Assist" },
      {
        name: "description",
        content: "What each AI request disclosed, as field names and counts — never values.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="ai_log.view">
      <AiLogPage />
    </PermissionGate>
  ),
});

const KIND_LABELS: Record<string, string> = {
  NAME: "names / initials",
  RECORD: "record numbers",
  DOB: "dates of birth",
  PHONE: "phone numbers",
  EMAIL: "e-mail addresses",
  ADDRESS: "street addresses",
};

function Replaced({ entry }: { entry: AiDisclosure }) {
  const kinds = Object.entries(entry.replaced);
  if (kinds.length === 0) return <span className="text-muted-foreground">none found</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {kinds.map(([k, n]) => (
        <StatusPill key={k} tone="info">
          {n} {KIND_LABELS[k] ?? k}
        </StatusPill>
      ))}
    </span>
  );
}

function AiLogPage() {
  const log = usePvQuery(
    ["ai-disclosures"],
    () => aiDisclosures.list(200),
    () => [],
  );
  return (
    <>
      <PageHeader
        title="AI data log"
        description="Every request sent to OpenAI, with the identifiers that were replaced by placeholder tokens on the server before it was sent. Field names and counts only — the log never holds a value."
      />
      <div className="space-y-4 p-6">
        <Section
          title="Recent AI requests"
          description="Names and initials, patient record numbers, dates of birth, reporter names, phone numbers, e-mail and street addresses are replaced before any request leaves the server, and put back into the answer afterwards."
        >
          <QueryBoundary query={log} loadingLabel="Loading the AI data log">
            {(entries) =>
              entries.length === 0 ? (
                <EmptyState
                  title="No AI requests logged yet"
                  description="Entries appear here as line lists, reports and cases are analysed."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-left">
                        {["When", "Where", "Model", "Replaced before sending", "Fields"].map(
                          (h) => (
                            <th key={h} className="label-caps px-3 py-2">
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className="border-b border-border align-top last:border-0">
                          <td className="mono-num px-3 py-2 whitespace-nowrap">
                            {e.at.replace("T", " ").slice(0, 19)}
                          </td>
                          <td className="px-3 py-2">
                            <p className="font-mono text-xs">{e.endpoint ?? "—"}</p>
                            {e.role ? (
                              <p className="text-xs text-muted-foreground">{e.role}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {e.model}
                            {e.kind === "image" ? (
                              <StatusPill tone="warning" className="ml-1">
                                image
                              </StatusPill>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Replaced entry={e} />
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {Object.entries(e.fields)
                              .map(([f, n]) => `${f} ×${n}`)
                              .join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </QueryBoundary>
        </Section>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> See docs/DATA-PROTECTION.md for what is implemented
          and what remains for MedNova and NAFDAC under the Nigeria Data Protection Act 2023.
        </p>
      </div>
    </>
  );
}
