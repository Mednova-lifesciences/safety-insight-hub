import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { V4_FIELDS, v4Field, type V4FieldId } from "@/services/psur/v4-fields";
import { PRINTED_FIELDS, SECTION_IDS } from "@/services/psur/v4-report";
import { PSUR_V4_TEMPLATE_SECTIONS } from "@/types/pv";

const SECTION_NAME = new Map(PSUR_V4_TEMPLATE_SECTIONS.map((s) => [s.id, s.name]));
/** The template prompts research can answer — Section 8's log is a table
 *  of the MAH's signals, filled on the form, so it is not offered. */
const OFFERED = V4_FIELDS.filter((f) => PRINTED_FIELDS.has(f.id) && f.id !== "S8_SIGNALS");
const SECTIONS = [...new Set(OFFERED.map((f) => f.section))];

/** A field as the picker shows it: the template's own prompt, in full. */
function optionLabel(id: V4FieldId): string {
  return PRINTED_FIELDS.has(id) ? v4Field(id).label : "Not printed in the V4 report (memo only)";
}

/**
 * Which field of the V4 evaluation form a piece of research answers,
 * grouped under the form's section headings. The V4 report prints the
 * research inside that field with a numbered citation, keeping the
 * template's own structure.
 */
export function V4FieldSelect({
  value,
  onChange,
  disabled,
  label = "Goes in the V4 report under",
}: {
  value: V4FieldId;
  onChange: (v: V4FieldId) => void;
  disabled?: boolean;
  label?: string;
}) {
  const section = SECTION_NAME.get(SECTION_IDS[v4Field(value).section]!) ?? "";
  return (
    <label className="block">
      <span className="label-caps">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as V4FieldId)} disabled={!!disabled}>
        <SelectTrigger
          className="mt-1 h-auto min-h-9 whitespace-normal py-2 text-left"
          aria-label="V4 report field"
        >
          <SelectValue>
            <span className="text-muted-foreground">{section} — </span>
            {optionLabel(value)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-96">
          {PRINTED_FIELDS.has(value) ? null : (
            <SelectItem value={value}>{optionLabel(value)}</SelectItem>
          )}
          {SECTIONS.map((n) => (
            <SelectGroup key={n}>
              <SelectLabel>{SECTION_NAME.get(SECTION_IDS[n]!) ?? `Section ${n}`}</SelectLabel>
              {OFFERED.filter((f) => f.section === n).map((f) => (
                <SelectItem key={f.id} value={f.id} className="whitespace-normal pl-6">
                  {optionLabel(f.id)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
