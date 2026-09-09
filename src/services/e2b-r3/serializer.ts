/**
 * PVCase -> real ICH E2B(R3) XML (HL7 v3, root MCCI_IN200100UV01 wrapping
 * one or more PORR_IN049016UV ICSR messages).
 *
 * Every element here is one this session actually confirmed exists at this
 * exact position by loading the official ICH reference instance
 * (regulatory-assets/e2b-r3/official-ich/ICH_ICSR_Reference_Instances_v3.1.zip)
 * into an XML tree and empirically pruning it against the real ICH XSD
 * (ICH_ICSR_XML_Schema_Set_v2.5.zip) with lxml — removing a candidate
 * element and re-validating; keeping the removal only when validation still
 * passed. Nothing below was typed from memory of the HL7 v3 R-MIM. Two
 * findings from that process that are easy to get wrong and matter here:
 *
 *  1. Multiple ICSRs in one batch are multiple sibling <PORR_IN049016UV>
 *     elements, but they MUST all appear before the batch's own trailing
 *     <receiver>/<sender> pair (MCCI_MT200100UV.Batch's content model is
 *     `... , choice(PORR_IN049016UV)[1..*], receiver, respondTo?, sender,
 *     attentionLine?`) — appending a new message after that pair produces
 *     a schema violation the validator reports confusingly as "expected
 *     attentionLine". Appending in the wrong place was this session's own
 *     first mistake when proving batching; #serializeBatchToXml appends
 *     each message via `.insertBefore(receiverEl)`, not `.push()`.
 *  2. Multiple suspect products are multiple sibling <component> elements
 *     inside ONE <organizer code="4" displayName="drugInformation">, not
 *     multiple separate drugInformation organizers.
 *  3. Within investigationEvent, every <outboundRelationship typeCode="SPRT">
 *     sibling (initialReport, sourceReport/reporter, follow-up link) MUST
 *     appear as a contiguous group BEFORE the <subjectOf1>/<subjectOf2>
 *     siblings (sender, report type, other case ids) — the content model is
 *     ordered, not a free bag of optional elements. Discovered by real XSD
 *     validation failure (SCHEMAV_ELEMENT_CONTENT) when the follow-up link
 *     was first appended after reportTypeBlock/otherIdsBlock instead of
 *     grouped with reporterBlock.
 *
 * What is deliberately NOT emitted, and why:
 *  - G.k.1 (drug characterization) and E.i.7 (outcome) are coded CE values
 *    whose element *position* this session verified against the schema,
 *    but whose numeric code->meaning mapping was NOT found in the
 *    downloaded ICH package (schemas + reference instances only — no
 *    codelist appendix). The 1..4 / 1..6 mappings below are the
 *    values used throughout this codebase's domain model comments and
 *    widely published E2B(R3) summaries, not a value machine-verified in
 *    this session against an ICH source document. Flagged here and in
 *    docs/E2B-R3-NAFDAC-VIGIFLOW.md as needing cross-check before any real
 *    submission.
 *  - MedDRA/WHODrug codes: never emitted unless CodedTerm.status === "MAPPED"
 *    (i.e. a licensed provider actually coded it). An UNMAPPED term is
 *    serialized with nullFlavor="UNK" on the coded <value> and the real
 *    verbatim text preserved in <originalText> — never a source category
 *    number masquerading as a dictionary code.
 *  - Reporter name (C.2.r.1), sender/receiver detailed address (C.3.3-4),
 *    documents (C.1.6.1), literature (C.4.r), follow-up links (C.1.10.r),
 *    nullification (C.1.11), medical history, weight/height/LMP/pregnancy,
 *    autopsy/cause of death, drug ingredients, marketing authorisation
 *    (G.k.3.x): all structurally optional (confirmed removable in the
 *    pruning pass) and omitted because this pipeline has no real source
 *    data for them — never populated with placeholder text.
 */
import type { PVCase, PVReaction, PVProduct, DrugCharacterization } from "./types";
import { WHODRUG_GLOBAL_RID_OID } from "./coding-provider";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** yyyymmdd or yyyymmddhhmmss from an ISO-8601-ish input. Never guesses a
 *  format it can't parse — throws instead of emitting a malformed HL7 TS. */
export function toHl7Ts(iso: string, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`toHl7Ts: cannot parse "${iso}" as a date`);
  }
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  if (!withTime) return `${yyyy}${mm}${dd}`;
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

/** G.k.1 — session could not locate a machine-verified codelist in the
 *  downloaded ICH package; values below match this codebase's own
 *  DrugCharacterization doc comment and standard E2B(R3) summaries, but are
 *  UNVERIFIED against an authoritative ICH source in this session. */
const DRUG_CHARACTERIZATION_CODE: Record<DrugCharacterization, string> = {
  SUSPECT: "1",
  CONCOMITANT: "2",
  INTERACTING: "3",
  NOT_ADMINISTERED: "4",
};

/** E.i.7 — same caveat as DRUG_CHARACTERIZATION_CODE above: unverified
 *  against an authoritative ICH codelist source in this session. */
const OUTCOME_CODE: Record<NonNullable<PVReaction["outcome"]>, string> = {
  RECOVERED: "1",
  RECOVERING: "2",
  NOT_RECOVERED: "3",
  RECOVERED_WITH_SEQUELAE: "4",
  FATAL: "5",
  UNKNOWN: "6",
};

function serializeReaction(r: PVReaction): string {
  const id = esc(r.id);
  const onset = r.onsetDate
    ? `<effectiveTime xsi:type="IVL_TS"><low value="${toHl7Ts(r.onsetDate)}"/></effectiveTime>`
    : "";
  const value =
    r.reaction.status === "MAPPED" && r.reaction.code
      ? `<value xsi:type="CE" code="${esc(r.reaction.code)}" codeSystem="2.16.840.1.113883.6.163" codeSystemVersion="${esc(r.reaction.dictionaryVersion ?? "")}"><originalText>${esc(r.reaction.sourceValue)}</originalText></value>`
      : `<value xsi:type="CE" nullFlavor="UNK"><originalText>${esc(r.reaction.sourceValue)}</originalText></value>`;

  const bool = (v: boolean | undefined, code: string, name: string): string => {
    const val = v === undefined ? `nullFlavor="NASK"` : `value="${v ? "true" : "false"}"`;
    return `<outboundRelationship2 typeCode="PERT"><observation classCode="OBS" moodCode="EVN"><code code="${code}" codeSystem="2.16.840.1.113883.3.989.2.1.1.19" codeSystemVersion="1.1" displayName="${name}"/><value xsi:type="BL" ${val}/></observation></outboundRelationship2>`;
  };

  const outcome = r.outcome
    ? `<outboundRelationship2 typeCode="PERT"><observation classCode="OBS" moodCode="EVN"><code code="27" codeSystem="2.16.840.1.113883.3.989.2.1.1.19" codeSystemVersion="1.1" displayName="outcome"/><value xsi:type="CE" code="${OUTCOME_CODE[r.outcome]}" codeSystem="2.16.840.1.113883.3.989.2.1.1.11" codeSystemVersion="1.0"/></observation></outboundRelationship2>`
    : "";

  const sc = r.seriousnessCriteria;
  return `<subjectOf2 typeCode="SBJ"><observation classCode="OBS" moodCode="EVN"><id root="${id}"/><code code="29" codeSystem="2.16.840.1.113883.3.989.2.1.1.19" codeSystemVersion="1.1" displayName="reaction"/>${onset}${value}${bool(sc.resultsInDeath, "34", "resultsInDeath")}${bool(sc.lifeThreatening, "21", "isLifeThreatening")}${bool(sc.hospitalization, "33", "requiresInpatientHospitalization")}${bool(sc.disabling, "35", "resultsInPersistentOrSignificantDisability")}${bool(sc.congenitalAnomaly, "12", "congenitalAnomalyBirthDefect")}${bool(sc.otherMedicallyImportant, "26", "otherMedicallyImportantCondition")}${outcome}</observation></subjectOf2>`;
}

function serializeDrugComponent(p: PVProduct): string {
  const id = esc(p.id);
  const productValue =
    p.product.status === "MAPPED" && p.product.code
      ? `<code code="${esc(p.product.code)}" codeSystem="TBD-MPID" codeSystemVersion="${esc(p.product.dictionaryVersion ?? "")}"/>`
      : `<code nullFlavor="UNK"/>`;
  // WHODrug Global RID — only emitted when a real provider actually
  // supplied one (never invented). Uses the fixed WHODrug Global RID OID,
  // not a guessed identifier system.
  const ridEl =
    p.product.status === "MAPPED" && p.product.rid
      ? `<id root="${WHODRUG_GLOBAL_RID_OID}" extension="${esc(p.product.rid)}"/>`
      : "";
  const route = p.route
    ? `<routeCode nullFlavor="UNK"><originalText>${esc(p.route)}</originalText></routeCode>`
    : "";
  const dose = p.dose ? `<doseQuantity nullFlavor="UNK"/><!-- dose (free text, no PQ unit known): ${esc(p.dose)} -->` : "";
  const batch = p.batchNumber
    ? `<consumable typeCode="CSM"><instanceOfKind classCode="INST"><productInstanceInstance classCode="MMAT" determinerCode="INSTANCE"><lotNumberText>${esc(p.batchNumber)}</lotNumberText></productInstanceInstance></instanceOfKind></consumable>`
    : "";
  const startDate = p.startDate
    ? `<effectiveTime xsi:type="IVL_TS"><low value="${toHl7Ts(p.startDate)}"/></effectiveTime>`
    : "";
  return `<component typeCode="COMP"><substanceAdministration classCode="SBADM" moodCode="EVN"><id root="${id}"/><consumable typeCode="CSM"><instanceOfKind classCode="INST"><kindOfProduct classCode="MMAT" determinerCode="KIND">${ridEl}${productValue}<name>${esc(p.product.sourceValue)}</name></kindOfProduct></instanceOfKind></consumable>${
    route || dose || batch || startDate
      ? `<outboundRelationship2 typeCode="COMP"><substanceAdministration classCode="SBADM" moodCode="EVN">${startDate}${route}${dose}${batch}</substanceAdministration></outboundRelationship2>`
      : ""
  }</substanceAdministration></component>`;
}

function serializeCausality(p: PVProduct): string {
  return `<component typeCode="COMP"><causalityAssessment classCode="OBS" moodCode="EVN"><code code="20" codeSystem="2.16.840.1.113883.3.989.2.1.1.19" codeSystemVersion="1.1" displayName="interventionCharacterization"/><value xsi:type="CE" code="${DRUG_CHARACTERIZATION_CODE[p.characterization]}" codeSystem="2.16.840.1.113883.3.989.2.1.1.13" codeSystemVersion="1.0"/><subject2 typeCode="SUBJ"><productUseReference classCode="SBADM" moodCode="EVN"><id root="${esc(p.id)}"/></productUseReference></subject2></causalityAssessment></component>`;
}

/** One PVCase -> one <PORR_IN049016UV> ICSR message (no XML declaration,
 *  no batch wrapper — see serializeBatchToXml for that). */
export function serializeCaseToMessage(
  pvCase: PVCase,
  opts: { messageId: string; senderId: string; receiverId: string },
): string {
  const name =
    pvCase.patient.identity.present && pvCase.patient.identity.value.kind === "INITIALS"
      ? `<name>${esc(pvCase.patient.identity.value.initials)}</name>`
      : `<name nullFlavor="${pvCase.patient.identity.present ? "MSK" : pvCase.patient.identity.nullFlavor}"/>`;
  const sexCode = pvCase.patient.sex === "MALE" ? "1" : pvCase.patient.sex === "FEMALE" ? "2" : undefined;
  const sex = sexCode ? `<administrativeGenderCode code="${sexCode}" codeSystem="1.0.5218"/>` : "";
  const age =
    pvCase.patient.age && pvCase.patient.ageUnit
      ? `<subjectOf2 typeCode="SBJ"><observation classCode="OBS" moodCode="EVN"><code code="3" codeSystem="2.16.840.1.113883.3.989.2.1.1.19" codeSystemVersion="1.1" displayName="age"/><value xsi:type="PQ" value="${esc(pvCase.patient.age)}" unit="${pvCase.patient.ageUnit}"/></observation></subjectOf2>`
      : "";

  const reactionsXml = pvCase.reactions.map(serializeReaction).join("");
  const drugComponentsXml = pvCase.products.map(serializeDrugComponent).join("");
  const causalityXml = pvCase.products.map(serializeCausality).join("");

  const drugOrganizer = pvCase.products.length
    ? `<subjectOf2 typeCode="SBJ"><organizer classCode="CATEGORY" moodCode="EVN"><code code="4" codeSystem="2.16.840.1.113883.3.989.2.1.1.20" codeSystemVersion="1.0" displayName="drugInformation"/>${drugComponentsXml}</organizer></subjectOf2>`
    : "";

  const c17 =
    pvCase.fulfilsExpeditedCriteria.present
      ? `value="${pvCase.fulfilsExpeditedCriteria.value ? "true" : "false"}"`
      : `nullFlavor="${pvCase.fulfilsExpeditedCriteria.nullFlavor}"`;

  const reporterQual = pvCase.reporter.qualificationCode
    ? `<asQualifiedEntity classCode="QUAL"><code code="${pvCase.reporter.qualificationCode}" codeSystem="2.16.840.1.113883.3.989.2.1.1.6" codeSystemVersion="1.0"/></asQualifiedEntity>`
    : "";
  const reporterCountry = pvCase.reporter.country
    ? `<asLocatedEntity classCode="LOCE"><location classCode="COUNTRY" determinerCode="INSTANCE"><code code="${esc(pvCase.reporter.country)}" codeSystem="1.0.3166.1.2.2"/></location></asLocatedEntity>`
    : "";
  const reporterBlock =
    reporterQual || reporterCountry
      ? `<outboundRelationship typeCode="SPRT"><priorityNumber value="1"/><relatedInvestigation classCode="INVSTG" moodCode="EVN"><code code="2" codeSystem="2.16.840.1.113883.3.989.2.1.1.22" codeSystemVersion="1.0" displayName="sourceReport"/><subjectOf2 typeCode="SUBJ"><controlActEvent classCode="CACT" moodCode="EVN"><author typeCode="AUT"><assignedEntity classCode="ASSIGNED"><assignedPerson classCode="PSN" determinerCode="INSTANCE">${reporterQual}${reporterCountry}</assignedPerson></assignedEntity></author></controlActEvent></subjectOf2></relatedInvestigation></outboundRelationship>`
      : "";

  const senderBlock = pvCase.senderOrganisation
    ? `<subjectOf1 typeCode="SUBJ"><controlActEvent classCode="CACT" moodCode="EVN"><author typeCode="AUT"><assignedEntity classCode="ASSIGNED"><representedOrganization classCode="ORG" determinerCode="INSTANCE"><assignedEntity classCode="ASSIGNED"><representedOrganization classCode="ORG" determinerCode="INSTANCE"><name>${esc(pvCase.senderOrganisation)}</name></representedOrganization></assignedEntity></representedOrganization></assignedEntity></author></controlActEvent></subjectOf1>`
    : "";

  const reportTypeBlock = pvCase.reportType.present
    ? `<subjectOf2 typeCode="SUBJ"><investigationCharacteristic classCode="OBS" moodCode="EVN"><code code="1" codeSystem="2.16.840.1.113883.3.989.2.1.1.23" codeSystemVersion="1.0" displayName="ichReportType"/><value xsi:type="CE" code="${pvCase.reportType.value}" codeSystem="2.16.840.1.113883.3.989.2.1.1.2" codeSystemVersion="1.0"/></investigationCharacteristic></subjectOf2>`
    : "";

  const otherIdsBlock = pvCase.otherCaseIdentifiersInPreviousTransmissions.present
    ? `<subjectOf2 typeCode="SUBJ"><investigationCharacteristic classCode="OBS" moodCode="EVN"><code code="2" codeSystem="2.16.840.1.113883.3.989.2.1.1.23" codeSystemVersion="1.0" displayName="otherCaseIds"/><value xsi:type="BL" value="true"/></investigationCharacteristic></subjectOf2>${pvCase.otherCaseIdentifiersInPreviousTransmissions.identifiers
        .map(
          (i) =>
            `<subjectOf1 typeCode="SUBJ"><controlActEvent classCode="CACT" moodCode="EVN"><id assigningAuthorityName="${esc(i.source)}" extension="${esc(i.identifier)}" root="2.16.840.1.113883.3.989.2.1.3.3"/></controlActEvent></subjectOf1>`,
        )
        .join("")}`
    : `<subjectOf2 typeCode="SUBJ"><investigationCharacteristic classCode="OBS" moodCode="EVN"><code code="2" codeSystem="2.16.840.1.113883.3.989.2.1.1.23" codeSystemVersion="1.0" displayName="otherCaseIds"/><value xsi:type="BL" nullFlavor="NI"/></investigationCharacteristic></subjectOf2>`;

  // C.1.10.r — Identification Number of the Report Which Is Linked to This
  // Report. Structure confirmed against the official ICH reference
  // instance (regulatory-assets/e2b-r3/official-ich/): a follow-up is
  // represented structurally, by the PRESENCE of this linked-report id —
  // there is no separate "isFollowUp" boolean element in the R-MIM to set.
  // A follow-up with isFollowUp:true but no previousTransmissionRef is a
  // real data problem (see validation.ts's E2B-C1.10-FOLLOWUP-REF-MISSING)
  // and correctly serializes nothing here rather than a broken/empty link.
  const followUpBlock =
    pvCase.followUp.isFollowUp && pvCase.followUp.previousTransmissionRef
      ? `<outboundRelationship typeCode="SPRT"><relatedInvestigation classCode="INVSTG" moodCode="EVN"><code nullFlavor="NA"/><subjectOf2 typeCode="SUBJ"><controlActEvent classCode="CACT" moodCode="EVN"><id extension="${esc(pvCase.followUp.previousTransmissionRef)}" root="2.16.840.1.113883.3.989.2.1.3.2"/></controlActEvent></subjectOf2></relatedInvestigation></outboundRelationship>`
      : "";

  const narrative = esc(pvCase.narrative && pvCase.narrative.trim() ? pvCase.narrative : "No narrative provided.");

  return `<PORR_IN049016UV><id extension="${esc(opts.messageId)}" root="2.16.840.1.113883.3.989.2.1.3.1"/><creationTime value="${toHl7Ts(pvCase.dateOfCreation, true)}"/><interactionId extension="PORR_IN049016UV" root="2.16.840.1.113883.1.6"/><processingCode code="P"/><processingModeCode code="T"/><acceptAckCode code="AL"/><receiver typeCode="RCV"><device classCode="DEV" determinerCode="INSTANCE"><id extension="${esc(opts.receiverId)}" root="2.16.840.1.113883.3.989.2.1.3.12"/></device></receiver><sender typeCode="SND"><device classCode="DEV" determinerCode="INSTANCE"><id extension="${esc(opts.senderId)}" root="2.16.840.1.113883.3.989.2.1.3.11"/></device></sender><controlActProcess classCode="CACT" moodCode="EVN"><code code="PORR_TE049016UV" codeSystem="2.16.840.1.113883.1.18"/><effectiveTime value="${toHl7Ts(pvCase.dateOfCreation, true)}"/><subject typeCode="SUBJ"><investigationEvent classCode="INVSTG" moodCode="EVN"><id extension="${esc(pvCase.sendersCaseId)}" root="2.16.840.1.113883.3.989.2.1.3.1"/><id extension="${esc(pvCase.worldwideUniqueId)}" root="2.16.840.1.113883.3.989.2.1.3.2"/><code code="PAT_ADV_EVNT" codeSystem="2.16.840.1.113883.5.4"/><text>${narrative}</text><statusCode code="active"/><effectiveTime><low value="${toHl7Ts(pvCase.dateFirstReceived)}"/></effectiveTime><availabilityTime value="${toHl7Ts(pvCase.dateMostRecentInfo)}"/><component typeCode="COMP"><adverseEventAssessment classCode="INVSTG" moodCode="EVN"><subject1 typeCode="SBJ"><primaryRole classCode="INVSBJ"><player1 classCode="PSN" determinerCode="INSTANCE">${name}${sex}</player1>${age}${reactionsXml}${drugOrganizer}</primaryRole></subject1>${causalityXml}</adverseEventAssessment></component><component typeCode="COMP"><observationEvent classCode="OBS" moodCode="EVN"><code code="23" codeSystem="2.16.840.1.113883.3.989.2.1.1.19" codeSystemVersion="1.1" displayName="localCriteriaForExpedited"/><value xsi:type="BL" ${c17}/></observationEvent></component><outboundRelationship typeCode="SPRT"><relatedInvestigation classCode="INVSTG" moodCode="EVN"><code code="1" codeSystem="2.16.840.1.113883.3.989.2.1.1.22" codeSystemVersion="1.0" displayName="initialReport"/><subjectOf2 typeCode="SUBJ"><controlActEvent classCode="CACT" moodCode="EVN"><author typeCode="AUT"><assignedEntity classCode="ASSIGNED"><code code="${pvCase.firstSenderOfCase}" codeSystem="2.16.840.1.113883.3.989.2.1.1.3" codeSystemVersion="1.0"/></assignedEntity></author></controlActEvent></subjectOf2></relatedInvestigation></outboundRelationship>${reporterBlock}${followUpBlock}${senderBlock}${reportTypeBlock}${otherIdsBlock}</investigationEvent></subject></controlActProcess></PORR_IN049016UV>`;
}

export interface BatchOptions {
  batchId: string;
  senderId: string;
  receiverId: string;
  transmissionTimestamp: Date;
}

/**
 * cases -> one complete <MCCI_IN200100UV01> XML document (with declaration).
 * All messages are inserted before the batch-level receiver/sender pair —
 * see the module doc comment's finding #1 for why order matters here.
 */
export function serializeBatchToXml(cases: PVCase[], opts: BatchOptions): string {
  const ts = toHl7Ts(opts.transmissionTimestamp.toISOString(), true);
  const messages = cases
    .map((c, i) =>
      serializeCaseToMessage(c, {
        messageId: `${opts.batchId}-MSG${i + 1}`,
        senderId: opts.senderId,
        receiverId: opts.receiverId,
      }),
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<MCCI_IN200100UV01 xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ITSVersion="XML_1.0" xsi:schemaLocation="urn:hl7-org:v3 MCCI_IN200100UV01.xsd"><id extension="${esc(opts.batchId)}" root="2.16.840.1.113883.3.989.2.1.3.22"/><creationTime value="${ts}"/><responseModeCode code="D"/><interactionId extension="MCCI_IN200100UV01" root="2.16.840.1.113883.1.6"/>${messages}<receiver typeCode="RCV"><device classCode="DEV" determinerCode="INSTANCE"><id extension="${esc(opts.receiverId)}" root="2.16.840.1.113883.3.989.2.1.3.14"/></device></receiver><sender typeCode="SND"><device classCode="DEV" determinerCode="INSTANCE"><id extension="${esc(opts.senderId)}" root="2.16.840.1.113883.3.989.2.1.3.13"/></device></sender></MCCI_IN200100UV01>`;
}
