export type RecoveryConfidence = "high" | "medium" | "low";
export type RecoveryFixerType = "deterministic" | "ai";

export interface RecoveryMove {
  sourceColumn: string;
  sourceValue: string;
  targetField: string;
  reason: string;
  confidence: RecoveryConfidence;
  fixerType: RecoveryFixerType;
}

export interface RecoveryProposal {
  rowIndex: number;
  moves: RecoveryMove[];
  overallConfidence: RecoveryConfidence;
}

type RowObject = Record<string, string>;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isAgeLike(value: string): boolean {
  const v = normalizeWhitespace(value);
  if (!v) return false;
  return /^\d{1,3}(?:\.\d+)?\s*(?:y|yr|yrs|years?|m|mo|months?|d|days?)?$/i.test(v);
}

function isSexLike(value: string): boolean {
  const v = normalizeWhitespace(value).toUpperCase();
  if (!v) return false;
  return /^(M|F|MALE|FEMALE|UNKNOWN|UNSPECIFIED|U|UNK|NOT KNOWN|NOTKNOWN)$/i.test(v);
}

function isPhoneLike(value: string): boolean {
  const v = normalizeWhitespace(value);
  if (!v) return false;
  return /^\+?[\d\s().-]{7,}$/.test(v) && (v.replace(/\D/g, "").length >= 7 || /\d/.test(v));
}

function isDateLike(value: string): boolean {
  const v = normalizeWhitespace(value);
  if (!v) return false;
  return /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/.test(v);
}

function isNameLike(value: string): boolean {
  const v = normalizeWhitespace(value);
  if (!v) return false;
  if (isAgeLike(v) || isSexLike(v) || isPhoneLike(v) || isDateLike(v)) return false;
  const digits = (v.match(/\d/g) ?? []).length;
  return digits < v.length * 0.25 && /[A-Za-z]/.test(v);
}

function isDesignationLike(value: string): boolean {
  const v = normalizeWhitespace(value);
  if (!v) return false;
  if (isAgeLike(v) || isSexLike(v) || isPhoneLike(v) || isDateLike(v)) return false;
  const digits = (v.match(/\d/g) ?? []).length;
  return digits <= Math.max(1, v.length * 0.2) && /[A-Za-z]/.test(v);
}

function isRecordNumberLike(value: string): boolean {
  const v = normalizeWhitespace(value);
  if (!v) return false;
  return /^(?:[A-Z0-9-]{3,}|\d{3,})$/.test(v.replace(/\s+/g, "")) && !isAgeLike(v);
}

function compatibleWithField(value: string, field: string): boolean {
  const v = normalizeWhitespace(value);
  if (!v) return false;
  switch (field) {
    case "patient_identifier":
    case "reporter_name":
      return isNameLike(v) || isDesignationLike(v);
    case "age":
      return isAgeLike(v);
    case "sex":
      return isSexLike(v);
    case "reporter_phone":
      return isPhoneLike(v);
    case "date_of_birth":
    case "report_date":
    case "vaccination_date":
    case "onset_date":
      return isDateLike(v);
    case "patient_id":
      return isRecordNumberLike(v);
    case "reporter_designation":
      return isDesignationLike(v);
    case "case_id":
      return Boolean(v) && !isAgeLike(v) && !isSexLike(v) && !isPhoneLike(v) && !isDateLike(v);
    default:
      return Boolean(v);
  }
}

function isProtectedIdentifier(field: string): boolean {
  return ["case_id", "patient_id", "previous_case_id"].includes(field);
}

function headerForField(mapping: Record<string, string>, field: string): string | undefined {
  return Object.entries(mapping).find(([, mapped]) => mapped === field)?.[0];
}

function recoverMove(
  sourceColumn: string,
  sourceValue: string,
  targetField: string,
  currentField: string,
  currentValue: string,
): RecoveryMove | null {
  const normalizedSource = normalizeWhitespace(sourceValue);
  if (!normalizedSource) return null;
  if (isProtectedIdentifier(targetField)) {
    return null;
  }
  if (!compatibleWithField(normalizedSource, targetField)) {
    return null;
  }
  if (compatibleWithField(currentValue, currentField)) {
    return null;
  }
  const reason = `Value "${normalizedSource}" matches ${targetField} semantics better than the value currently assigned to ${currentField}.`;
  return {
    sourceColumn,
    sourceValue: normalizedSource,
    targetField,
    reason,
    confidence: "high",
    fixerType: "deterministic",
  };
}

export function generateRecoveryProposal(
  row: RowObject,
  mapping: Record<string, string>,
): RecoveryProposal | null {
  const moves: RecoveryMove[] = [];
  const headers = Object.keys(row);

  for (const sourceColumn of headers) {
    const currentField = mapping[sourceColumn];
    if (!currentField || !row[sourceColumn]) continue;
    const currentValue = normalizeWhitespace(row[sourceColumn]!);
    if (!currentValue || compatibleWithField(currentValue, currentField)) continue;

    for (const [candidateHeader, candidateField] of Object.entries(mapping)) {
      if (candidateHeader === sourceColumn) continue;
      const candidateValue = normalizeWhitespace(row[candidateHeader] ?? "");
      if (!candidateValue || !compatibleWithField(candidateValue, currentField)) continue;
      const move = recoverMove(candidateHeader, candidateValue, currentField, currentField, currentValue);
      if (!move) continue;
      moves.push(move);
    }
  }

  if (moves.length === 0) return null;

  const deduped = new Map<string, RecoveryMove>();
  for (const move of moves) {
    const key = `${move.sourceColumn}:${move.targetField}`;
    if (!deduped.has(key)) deduped.set(key, move);
  }

  const uniqueMoves = [...deduped.values()];
  const overallConfidence: RecoveryConfidence = uniqueMoves.every((m) => m.confidence === "high")
    ? "high"
    : uniqueMoves.some((m) => m.confidence === "medium")
      ? "medium"
      : "low";

  return {
    rowIndex: -1,
    moves: uniqueMoves,
    overallConfidence,
  };
}

export function applyRecoveryProposal(
  row: RowObject,
  mapping: Record<string, string>,
  proposal: RecoveryProposal,
): RowObject | null {
  const working = { ...row };
  const targetAssignments = new Map<string, string>();
  const clearColumns = new Set<string>();

  for (const move of proposal.moves) {
    const sourceColumn = move.sourceColumn;
    const sourceValue = move.sourceValue;
    if (!(sourceColumn in working) || normalizeWhitespace(working[sourceColumn] ?? "") !== sourceValue) {
      return null;
    }
    if (isProtectedIdentifier(move.targetField)) {
      return null;
    }

    const targetColumn = headerForField(mapping, move.targetField);
    if (!targetColumn) return null;
    if (targetColumn === sourceColumn) continue;
    if (targetAssignments.has(targetColumn)) return null;

    targetAssignments.set(targetColumn, sourceValue);
    clearColumns.add(sourceColumn);
  }

  for (const header of Object.keys(working)) {
    if (targetAssignments.has(header)) {
      working[header] = targetAssignments.get(header)!;
    } else if (clearColumns.has(header) && !targetAssignments.has(header)) {
      working[header] = "";
    }
  }

  // Final safety check: every assignment must still be compatible with its
  // target field, and no target field may be receiving a fabricated value.
  for (const [header, value] of Object.entries(working)) {
    const field = mapping[header];
    if (field && value && !compatibleWithField(value, field)) {
      if (header in targetAssignments) {
        return null;
      }
    }
  }

  return working;
}

export function recoverRows(
  headers: string[],
  mapping: Record<string, string>,
  rows: RowObject[],
): { rows: RowObject[]; proposals: RecoveryProposal[]; applied: number } {
  const recovered = rows.map((row) => ({ ...row }));
  const proposals: RecoveryProposal[] = [];
  let applied = 0;

  for (let i = 0; i < rows.length; i++) {
    const proposal = generateRecoveryProposal(rows[i] ?? {}, mapping);
    if (!proposal) continue;
    proposal.rowIndex = i;
    proposals.push(proposal);

    if (proposal.overallConfidence !== "high") continue;

    const next = applyRecoveryProposal(rows[i] ?? {}, mapping, proposal);
    if (!next) continue;
    recovered[i] = next;
    applied += 1;
  }

  return { rows: recovered, proposals, applied };
}

export function recoverSheetRows(
  headers: string[],
  mapping: Record<string, string>,
  sheetRows: string[][],
): { rows: string[][]; proposals: RecoveryProposal[]; applied: number } {
  const converted = sheetRows.map((row) => {
    const out: RowObject = {};
    headers.forEach((header, idx) => {
      out[header] = row[idx] ?? "";
    });
    return out;
  });

  const recovered = recoverRows(headers, mapping, converted);
  const rebuilt = recovered.rows.map((row) =>
    headers.map((header) => (row[header] ?? "").toString()),
  );
  return { rows: rebuilt, proposals: recovered.proposals, applied: recovered.applied };
}
