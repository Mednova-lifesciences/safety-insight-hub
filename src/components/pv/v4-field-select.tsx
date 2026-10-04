import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { V4_FIELDS, v4FieldLabel, type V4FieldId } from "@/services/psur/v4-fields";

/**
 * Which field of the V4 evaluation form a piece of research answers. The
 * V4 report prints the research inside that field with a numbered
 * citation, keeping the template's own structure.
 */
export function V4FieldSelect({
  value,
  onChange,
  disabled,
}: {
  value: V4FieldId;
  onChange: (v: V4FieldId) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="label-caps">Goes in the V4 report under</span>
      <Select value={value} onValueChange={(v) => onChange(v as V4FieldId)} disabled={!!disabled}>
        <SelectTrigger className="mt-1" aria-label="V4 report field">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {V4_FIELDS.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {v4FieldLabel(f.id).slice(0, 100)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
