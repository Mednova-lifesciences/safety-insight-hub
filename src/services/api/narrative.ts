import type { CaseDetail, CaseOutcome } from "@/types/pv";
import { describeIntake } from "./intake-channel";

const OUTCOME_TEXT: Record<CaseOutcome, string> = {
  RECOVERED: "recovered/resolved",
  RECOVERING: "recovering/resolving",
  NOT_RECOVERED: "not recovered",
  RECOVERED_WITH_SEQUELAE: "recovered with sequelae",
  FATAL: "fatal",
  UNKNOWN: "unknown",
};

const has = (v: string | undefined | null): v is string => !!v && v.trim().length > 0;

/**
 * A case narrative drafted only from what the case records, in the usual
 * order (reporter, patient, product, event, action, outcome, seriousness).
 * Nothing is inferred: a missing fact is listed as not reported, so the
 * coordinator sees what to follow up before editing and saving.
 */
export function draftNarrative(c: CaseDetail): string {
  const missing: string[] = [];
  const p = c.patient ?? { identifier: "" };
  const drug = c.suspectProducts?.[0];
  const event = c.reactions?.[0];

  const reporter = has(c.reporter?.qualification) ? c.reporter.qualification : "A reporter";
  const country = has(c.reporter?.country) ? ` in ${c.reporter.country}` : "";
  const intro = `${reporter}${country} reported this case on ${c.receivedDate} (source: ${describeIntake(c)}).`;

  const age = has(p.age) ? `${p.age.trim()}-year-old ` : "";
  if (!age) missing.push("patient age");
  const sex = p.sex === "MALE" ? "male " : p.sex === "FEMALE" ? "female " : "";
  if (!sex) missing.push("patient sex");
  const weight = has(p.weightKg) ? ` weighing ${p.weightKg.trim()} kg` : "";
  const history = has(p.medicalHistory)
    ? ` with a relevant medical history of ${p.medicalHistory.trim()}`
    : "";
  const patient = `A ${age}${sex}patient${weight}${history}`;

  const name = drug?.reportedName || c.product;
  const dose = [drug?.dose, drug?.route].filter(has).join(" ");
  const indication = has(drug?.indication) ? ` for ${drug.indication.trim()}` : "";
  if (!indication) missing.push("indication");
  const start = has(drug?.therapyStart) ? ` from ${drug.therapyStart}` : "";
  if (!start) missing.push("therapy start date");
  const end = has(drug?.therapyEnd) ? ` to ${drug.therapyEnd}` : "";
  const exposure = `${patient} received ${name}${dose ? ` ${dose}` : ""}${indication}${start}${end}.`;

  const others = (c.concomitantMedicines ?? []).filter((m) => has(m.name));
  const concomitant = others.length
    ? ` Concomitant medicines: ${others.map((m) => [m.name, m.dose].filter(has).join(" ")).join("; ")}.`
    : "";

  const term = event?.reportedTerm || c.reaction;
  const coded =
    event?.codedTerm?.dictionary === "MedDRA"
      ? ` (MedDRA ${event.codedTerm.dictionaryVersion} LLT: ${event.codedTerm.term}, ${event.codedTerm.code})`
      : "";
  const onset = has(event?.onsetDate) ? `On ${event.onsetDate}, the` : "The";
  if (!has(event?.onsetDate)) missing.push("onset date");
  const ended = has(event?.endDate) ? ` The event ended on ${event.endDate}.` : "";
  const reaction = `${onset} patient experienced ${term}${coded}.${ended}`;

  const action = has(drug?.action)
    ? ` Action taken with ${name}: ${drug.action.trim().toLowerCase()}.`
    : "";
  if (!action) missing.push("action taken with the product");
  const outcome = ` The outcome was ${OUTCOME_TEXT[event?.outcome ?? c.outcome] ?? "unknown"}.`;
  const batch = has(drug?.batchNumber)
    ? ` Batch ${drug.batchNumber.trim()}${has(drug.expiryDate) ? `, expiry ${drug.expiryDate}` : ""}.`
    : "";

  const criteria = (c.reportedSeriousnessCriteria ?? []).filter(has);
  const seriousness =
    c.seriousness === "SERIOUS"
      ? ` The case was reported as serious${criteria.length ? ` (${criteria.join("; ").toLowerCase()})` : ""}.`
      : c.seriousness === "NON_SERIOUS"
        ? " The case was reported as non-serious."
        : " Seriousness has not yet been assessed.";

  const paragraphs = [
    intro,
    `${exposure}${concomitant}`,
    `${reaction}${action}${outcome}${batch}${seriousness}`,
  ];
  if (missing.length) paragraphs.push(`Not reported: ${missing.join(", ")}.`);
  return paragraphs.join("\n\n");
}
