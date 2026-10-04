import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  PsurBenefitRiskAssessment,
  PsurEvidenceQuality,
  PsurIntegratedEffectsRow,
  PsurKeyRisk,
} from "@/types/pv";

const QUALITY: Record<PsurEvidenceQuality, string> = {
  HIGH: "High",
  MODERATE: "Moderate",
  LOW: "Low",
  VERY_LOW: "Very low",
  NOT_ASSESSABLE: "Not assessable",
};

/** The template's five dimensions, in its order and wording. */
const DIMENSIONS: [PsurIntegratedEffectsRow["dimension"], string][] = [
  ["CONDITION_UNMET_NEED", "Analysis of Condition / Unmet Medical Need"],
  ["CURRENT_TREATMENT_OPTIONS", "Current Treatment Options"],
  ["BENEFIT", "Benefit"],
  ["RISK", "Risk"],
  ["RISK_MANAGEMENT", "Risk Management"],
];

type Data = PsurBenefitRiskAssessment;

function Cell({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Textarea
      aria-label={label}
      rows={2}
      className="min-h-0 resize-y border-0 bg-transparent p-1 text-xs shadow-none [field-sizing:content] focus-visible:ring-1"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A template table: its column headings, one row per entry, and a
 *  remove button per row unless the rows are fixed. */
function Grid({
  title,
  headers,
  widths,
  children,
  onAdd,
  addLabel,
  disabled,
}: {
  title: string;
  headers: string[];
  widths: string[];
  children: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
            {onAdd && !disabled ? <col style={{ width: "2.5rem" }} /> : null}
          </colgroup>
          <thead className="bg-muted/50">
            <tr>
              {headers.map((h) => (
                <th key={h} className="border-b border-r border-border p-2 text-left font-semibold">
                  {h}
                </th>
              ))}
              {onAdd && !disabled ? <th className="border-b border-border" /> : null}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {onAdd && !disabled ? (
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="size-4" /> {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

const td = "border-b border-r border-border align-top";

/**
 * Section 10.1-10.3 of the V4 form as its own tables, with the template's
 * columns: key benefits; important identified and important potential
 * risks (separate tables, as on the form); missing information; and the
 * five-dimension integrated effects table.
 */
export function BenefitRiskTables({
  data,
  setData,
  disabled,
}: {
  data: Data;
  setData: (f: (d: Data) => Data) => void;
  disabled: boolean;
}) {
  const remove = (onClick: () => void, label: string) =>
    disabled ? null : (
      <td className="border-b border-border p-1 align-top">
        <Button size="icon" variant="ghost" aria-label={label} onClick={onClick}>
          <Trash2 className="size-4" />
        </Button>
      </td>
    );

  const riskTable = (kind: PsurKeyRisk["kind"]) => {
    const name = kind === "IDENTIFIED" ? "Important Identified Risk" : "Important Potential Risk";
    const rows = data.keyRisks.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === kind);
    const set = (i: number, patch: Partial<PsurKeyRisk>) =>
      setData((d) => ({
        ...d,
        keyRisks: d.keyRisks.map((x, j) => (j === i ? { ...x, ...patch } : x)),
      }));
    return (
      <Grid
        title={kind === "IDENTIFIED" ? "Important identified risks:" : "Important potential risks:"}
        headers={[
          name,
          "Severity",
          "Frequency",
          "Reversibility",
          "Duration",
          "Preventability/Risk Management",
          "Comment",
        ]}
        widths={["17%", "12%", "17%", "12%", "11%", "16%", "15%"]}
        disabled={disabled}
        addLabel={`Add ${name.toLowerCase()}`}
        onAdd={() =>
          setData((d) => ({
            ...d,
            keyRisks: [
              ...d.keyRisks,
              {
                id: `kr-${Date.now()}`,
                kind,
                risk: "",
                severity: "",
                frequency: "",
                frequencyDataSource: "",
                reversibility: "",
                duration: "",
                preventabilityRiskManagement: "",
                comment: "",
              },
            ],
          }))
        }
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={8} className="p-2 text-muted-foreground">
              None recorded.
            </td>
          </tr>
        ) : (
          rows.map(({ r, i }, n) => (
            <tr key={r.id}>
              <td className={td}>
                <Cell
                  label={`${name} ${n + 1}`}
                  value={r.risk}
                  disabled={disabled}
                  onChange={(v) => set(i, { risk: v })}
                />
              </td>
              <td className={td}>
                <Cell
                  label={`${name} ${n + 1}: severity`}
                  value={r.severity}
                  disabled={disabled}
                  onChange={(v) => set(i, { severity: v })}
                />
              </td>
              <td className={td}>
                <Cell
                  label={`${name} ${n + 1}: frequency`}
                  value={r.frequency}
                  disabled={disabled}
                  onChange={(v) => set(i, { frequency: v })}
                />
                <Cell
                  label={`${name} ${n + 1}: frequency data source`}
                  value={r.frequencyDataSource}
                  disabled={disabled}
                  onChange={(v) => set(i, { frequencyDataSource: v })}
                />
              </td>
              <td className={td}>
                <Cell
                  label={`${name} ${n + 1}: reversibility`}
                  value={r.reversibility}
                  disabled={disabled}
                  onChange={(v) => set(i, { reversibility: v })}
                />
              </td>
              <td className={td}>
                <Cell
                  label={`${name} ${n + 1}: duration`}
                  value={r.duration}
                  disabled={disabled}
                  onChange={(v) => set(i, { duration: v })}
                />
              </td>
              <td className={td}>
                <Cell
                  label={`${name} ${n + 1}: preventability / risk management`}
                  value={r.preventabilityRiskManagement}
                  disabled={disabled}
                  onChange={(v) => set(i, { preventabilityRiskManagement: v })}
                />
              </td>
              <td className={td}>
                <Cell
                  label={`${name} ${n + 1}: comment`}
                  value={r.comment}
                  disabled={disabled}
                  onChange={(v) => set(i, { comment: v })}
                />
              </td>
              {remove(
                () => setData((d) => ({ ...d, keyRisks: d.keyRisks.filter((_, j) => j !== i) })),
                `Remove ${name.toLowerCase()} ${n + 1}`,
              )}
            </tr>
          ))
        )}
      </Grid>
    );
  };

  const effects = new Map(data.integratedEffectsTable.map((r) => [r.dimension, r]));
  const setEffect = (
    dim: PsurIntegratedEffectsRow["dimension"],
    patch: Partial<PsurIntegratedEffectsRow>,
  ) =>
    setData((d) => {
      const has = d.integratedEffectsTable.some((r) => r.dimension === dim);
      return {
        ...d,
        integratedEffectsTable: has
          ? d.integratedEffectsTable.map((r) => (r.dimension === dim ? { ...r, ...patch } : r))
          : [
              ...d.integratedEffectsTable,
              { dimension: dim, evidenceAndUncertainty: "", reviewerConclusion: "", ...patch },
            ],
      };
    });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="label-caps">10.1 Key Benefits</p>
        <Grid
          title=""
          headers={[
            "Key Benefit",
            "Evidence Source",
            "Magnitude",
            "Evidence Quality (High/Moderate/Low/Very Low)",
          ]}
          widths={["32%", "26%", "20%", "22%"]}
          disabled={disabled}
          addLabel="Add key benefit"
          onAdd={() =>
            setData((d) => ({
              ...d,
              keyBenefits: [
                ...d.keyBenefits,
                {
                  id: `kb-${Date.now()}`,
                  benefit: "",
                  evidenceSource: "",
                  magnitude: "",
                  evidenceQuality: "NOT_ASSESSABLE",
                },
              ],
            }))
          }
        >
          {data.keyBenefits.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-2 text-muted-foreground">
                None recorded.
              </td>
            </tr>
          ) : (
            data.keyBenefits.map((b, i) => {
              const set = (patch: Partial<typeof b>) =>
                setData((d) => ({
                  ...d,
                  keyBenefits: d.keyBenefits.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                }));
              return (
                <tr key={b.id}>
                  <td className={td}>
                    <Cell
                      label={`Key benefit ${i + 1}`}
                      value={b.benefit}
                      disabled={disabled}
                      onChange={(v) => set({ benefit: v })}
                    />
                  </td>
                  <td className={td}>
                    <Cell
                      label={`Key benefit ${i + 1}: evidence source`}
                      value={b.evidenceSource}
                      disabled={disabled}
                      onChange={(v) => set({ evidenceSource: v })}
                    />
                  </td>
                  <td className={td}>
                    <Cell
                      label={`Key benefit ${i + 1}: magnitude`}
                      value={b.magnitude}
                      disabled={disabled}
                      onChange={(v) => set({ magnitude: v })}
                    />
                  </td>
                  <td className={`${td} p-1`}>
                    <Select
                      value={b.evidenceQuality}
                      disabled={disabled}
                      onValueChange={(v) => set({ evidenceQuality: v as PsurEvidenceQuality })}
                    >
                      <SelectTrigger
                        className="h-8 text-xs"
                        aria-label={`Key benefit ${i + 1}: evidence quality`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(QUALITY) as PsurEvidenceQuality[]).map((q) => (
                          <SelectItem key={q} value={q}>
                            {QUALITY[q]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  {remove(
                    () =>
                      setData((d) => ({
                        ...d,
                        keyBenefits: d.keyBenefits.filter((_, j) => j !== i),
                      })),
                    `Remove key benefit ${i + 1}`,
                  )}
                </tr>
              );
            })
          )}
        </Grid>
      </div>

      <div className="space-y-3">
        <p className="label-caps">10.2 Key Risks</p>
        {riskTable("IDENTIFIED")}
        {riskTable("POTENTIAL")}
        <p className="text-xs italic text-muted-foreground">
          Frequency: state the available frequency estimate using an appropriate denominator or
          category, where applicable, and indicate the data source e.g RSI, SmPC, PSUR document,
          etc. (the second box in each Frequency cell).
        </p>
        <Grid
          title="Missing information:"
          headers={["Missing Information", "Risk-Minimisation Implication"]}
          widths={["45%", "55%"]}
          disabled={disabled}
          addLabel="Add missing information"
          onAdd={() =>
            setData((d) => ({
              ...d,
              missingInformation: [
                ...d.missingInformation,
                { id: `mi-${Date.now()}`, missingInformation: "", riskMinimisationImplication: "" },
              ],
            }))
          }
        >
          {data.missingInformation.length === 0 ? (
            <tr>
              <td colSpan={3} className="p-2 text-muted-foreground">
                None recorded.
              </td>
            </tr>
          ) : (
            data.missingInformation.map((m, i) => {
              const set = (patch: Partial<typeof m>) =>
                setData((d) => ({
                  ...d,
                  missingInformation: d.missingInformation.map((x, j) =>
                    j === i ? { ...x, ...patch } : x,
                  ),
                }));
              return (
                <tr key={m.id}>
                  <td className={td}>
                    <Cell
                      label={`Missing information ${i + 1}`}
                      value={m.missingInformation}
                      disabled={disabled}
                      onChange={(v) => set({ missingInformation: v })}
                    />
                  </td>
                  <td className={td}>
                    <Cell
                      label={`Missing information ${i + 1}: risk-minimisation implication`}
                      value={m.riskMinimisationImplication}
                      disabled={disabled}
                      onChange={(v) => set({ riskMinimisationImplication: v })}
                    />
                  </td>
                  {remove(
                    () =>
                      setData((d) => ({
                        ...d,
                        missingInformation: d.missingInformation.filter((_, j) => j !== i),
                      })),
                    `Remove missing information ${i + 1}`,
                  )}
                </tr>
              );
            })
          )}
        </Grid>
      </div>

      <div className="space-y-2">
        <p className="label-caps">10.3 Integrated Benefit-Risk Effects Table</p>
        <p className="text-xs italic text-muted-foreground">
          Synthesise the evidence and uncertainty for each dimension before reaching an overall
          conclusion (structured benefit-risk framework, modelled on the FDA five-dimension
          framework and CIOMS Working Group XII's Structured Benefit-Risk Framework).
        </p>
        <Grid
          title=""
          headers={["Dimension", "Evidence & Uncertainty", "Reviewer Conclusion"]}
          widths={["24%", "38%", "38%"]}
          disabled={disabled}
        >
          {DIMENSIONS.map(([dim, label]) => (
            <tr key={dim}>
              <th className={`${td} bg-muted/30 p-2 text-left font-semibold`}>{label}</th>
              <td className={td}>
                <Cell
                  label={`${label}: evidence and uncertainty`}
                  value={effects.get(dim)?.evidenceAndUncertainty ?? ""}
                  disabled={disabled}
                  onChange={(v) => setEffect(dim, { evidenceAndUncertainty: v })}
                />
              </td>
              <td className={td}>
                <Cell
                  label={`${label}: reviewer conclusion`}
                  value={effects.get(dim)?.reviewerConclusion ?? ""}
                  disabled={disabled}
                  onChange={(v) => setEffect(dim, { reviewerConclusion: v })}
                />
              </td>
            </tr>
          ))}
        </Grid>
      </div>
    </div>
  );
}
