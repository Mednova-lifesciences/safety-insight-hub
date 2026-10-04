import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { V4ExposureTable } from "@/types/pv";

export interface Column<R> {
  key: keyof R & string;
  label: string;
  /** Relative width; the template's columns are not all equal. */
  width?: number;
}

/**
 * One of the V4 form's open tables ("add more rows to table below as
 * required"): a row per line, editable in place, rows added and removed.
 */
export function RowsEditor<R extends Record<string, string>>({
  label,
  columns,
  rows,
  blank,
  disabled,
  onChange,
}: {
  label: string;
  columns: Column<R>[];
  rows: R[];
  blank: R;
  disabled: boolean;
  onChange: (rows: R[]) => void;
}) {
  const template = columns.map((c) => `${c.width ?? 1}fr`).join(" ") + " auto";
  return (
    <div className="space-y-1" role="group" aria-label={label}>
      <div
        className="hidden gap-1 text-xs font-medium text-muted-foreground md:grid"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
        <span className="w-8" />
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No rows.</p>
      ) : (
        rows.map((row, i) => (
          <div
            key={i}
            className="grid gap-1 md:items-center"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((c) => (
              <Input
                key={c.key}
                aria-label={`${label}, row ${i + 1}: ${c.label}`}
                placeholder={c.label}
                value={row[c.key] ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  onChange(rows.map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r)))
                }
              />
            ))}
            {disabled ? (
              <span className="w-8" />
            ) : (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${label} row ${i + 1}`}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))
      )}
      {disabled ? null : (
        <Button size="sm" variant="outline" onClick={() => onChange([...rows, { ...blank }])}>
          <Plus className="size-4" /> Add row
        </Button>
      )}
    </div>
  );
}

/** Section 5's fixed exposure table: three rows, interval and cumulative. */
export function ExposureEditor({
  value,
  disabled,
  onChange,
}: {
  value: V4ExposureTable;
  disabled: boolean;
  onChange: (v: V4ExposureTable) => void;
}) {
  const row = (key: "global" | "nigerian" | "other", label: React.ReactNode, name: string) => (
    <div className="grid gap-1 md:grid-cols-[1.2fr_1fr_1fr] md:items-center">
      <div className="text-sm font-medium">{label}</div>
      <Input
        aria-label={`${name} — reporting interval`}
        placeholder="Reporting interval"
        value={value[key].interval}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, [key]: { ...value[key], interval: e.target.value } })}
      />
      <Input
        aria-label={`${name} — cumulative`}
        placeholder="Cumulative"
        value={value[key].cumulative}
        disabled={disabled}
        onChange={(e) =>
          onChange({ ...value, [key]: { ...value[key], cumulative: e.target.value } })
        }
      />
    </div>
  );
  return (
    <div className="space-y-1" role="group" aria-label="Exposure table">
      <div className="hidden gap-1 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[1.2fr_1fr_1fr]">
        <span />
        <span>Reporting Interval</span>
        <span>Cumulative</span>
      </div>
      {row("global", "Global exposure", "Global exposure")}
      {row("nigerian", "Nigerian exposure", "Nigerian exposure")}
      {row(
        "other",
        <div className="space-y-1">
          <span>Another relevant region (if applicable)</span>
          <Input
            aria-label="Another relevant region — name"
            placeholder="Region"
            value={value.otherRegion}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, otherRegion: e.target.value })}
          />
        </div>,
        "Another relevant region",
      )}
    </div>
  );
}
