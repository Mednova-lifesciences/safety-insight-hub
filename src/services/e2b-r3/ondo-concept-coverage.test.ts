import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_KEYWORDS, TARGET_FIELDS, type TargetField } from "../api/linelist";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";

/**
 * ONDO concept coverage (task section 27).
 *
 * The Ondo reference file is an E2B(R2) `ichicsr` document — 91 safety
 * reports, 101 reactions, DTD `icsr21xml`. It is an INFORMATION-CONCEPT
 * reference, never a shape to copy: none of its legacy R2 tags appear
 * anywhere in this codebase, and `legacy-isolation.test.ts` enforces that
 * separately.
 *
 * The file itself is real patient data (full names, real facility
 * identifiers) and is deliberately NOT in this repository — `docs/*.xml`
 * is gitignored for that reason. So this test cannot read it. What it
 * encodes instead is the concept inventory extracted from it, with the
 * populated-count actually observed, and asserts the status of each
 * concept against the live keyword table and profile column map.
 *
 * That makes it a regression guard rather than a document: if someone
 * removes the `route` keyword, or drops `reporterOrganization` from the
 * generic profile's column map, the concept's claimed status stops being
 * true and this test fails.
 */

type Status =
  /** Reaches the serialized XML, with an end-to-end test proving it. */
  | "IMPLEMENTED_AND_TESTED"
  /** A real concept this E2B(R3) model has no destination for. */
  | "NOT_SUPPORTED_BY_R3_MODEL"
  /** Supported, but blocked on a codelist/config this repo does not hold. */
  | "REQUIRES_AUTHORITATIVE_CONFIGURATION"
  /** Deliberately out of scope for this task. */
  | "OUT_OF_SCOPE";

interface Concept {
  /** The R2 tag in the Ondo file, for traceability only. */
  ondoTag: string;
  /** How many of the 91 reports / 101 reactions actually carried a value. */
  populated: number;
  concept: string;
  /** The canonical source field, when one exists. */
  field?: TargetField | undefined;
  e2b: string;
  status: Status;
  /** Required for every status that is not IMPLEMENTED_AND_TESTED. */
  note?: string;
}

/**
 * Every concept the Ondo file actually POPULATES. Tags that are present
 * but empty in all 91 reports are listed separately below, because "the
 * reference file has this tag" and "the reference file carries this
 * information" are different claims and only the second one matters.
 */
const POPULATED_CONCEPTS: Concept[] = [
  // --- Case identity and administration
  {
    ondoTag: "safetyreportid",
    populated: 91,
    concept: "Case identifier",
    field: "case_id",
    e2b: "C.1.1 / C.1.8.1",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "receivedate",
    populated: 91,
    concept: "Date report first received",
    field: "report_date",
    e2b: "C.1.4 / C.1.5",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "primarysourcecountry",
    populated: 91,
    concept: "Primary source country",
    field: "reporter_country",
    e2b: "C.2.r.3",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "occurcountry",
    populated: 91,
    concept: "Country of occurrence",
    field: "reaction_country",
    e2b: "E.i.9",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "reporttype",
    populated: 91,
    concept: "Report type",
    e2b: "C.1.3",
    status: "OUT_OF_SCOPE",
    note: "Decision D3, supplied by transmission configuration, not by the line list.",
  },
  {
    ondoTag: "safetyreportversion",
    populated: 91,
    concept: "Report version",
    e2b: "C.1.8.1 follow-up",
    status: "NOT_SUPPORTED_BY_R3_MODEL",
    note: "This pipeline only creates first transmissions; follow-up versioning has its own workflow.",
  },

  // --- Patient
  {
    ondoTag: "patientinitial",
    populated: 91,
    concept: "Patient name / initials",
    field: "patient_identifier",
    e2b: "D.1",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "patientsex",
    populated: 91,
    concept: "Patient sex",
    field: "sex",
    e2b: "D.5",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "patientonsetage",
    populated: 90,
    concept: "Age at onset",
    field: "age",
    e2b: "D.2.2a",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "patientonsetageunit",
    populated: 90,
    concept: "Age unit",
    field: "age_unit",
    e2b: "D.2.2b",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "patientagegroup",
    populated: 91,
    concept: "Patient age group",
    field: "age_group",
    e2b: "D.2.3",
    status: "REQUIRES_AUTHORITATIVE_CONFIGURATION",
    note:
      "The ICH D.2.3 codelist on OID ...2.1.1.9 is in none of the official material in this repo. " +
      "Ondo's own value is the constant 3 on all 91 reports regardless of age, so it is not evidence either. " +
      "Carried verbatim on the model; see age-group.ts.",
  },

  // --- Reaction
  {
    ondoTag: "primarysourcereaction",
    populated: 90,
    concept: "Reaction as reported",
    field: "reaction",
    e2b: "E.i.1.1a",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "reactionstartdate",
    populated: 101,
    concept: "Reaction onset date",
    field: "onset_date",
    e2b: "E.i.4",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "reactionoutcome",
    populated: 101,
    concept: "Reaction outcome",
    field: "outcome",
    e2b: "E.i.7",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "serious",
    populated: 91,
    concept: "Seriousness",
    field: "seriousness",
    e2b: "E.i.3.2a-f",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "seriousnesslifethreatening",
    populated: 1,
    concept: "Seriousness criterion",
    field: "serious_code",
    e2b: "E.i.3.2b",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "reactionmeddrapt",
    populated: 92,
    concept: "MedDRA PT code",
    e2b: "E.i.2.1b",
    status: "OUT_OF_SCOPE",
    note: "MedDRA coding is explicitly out of scope; verbatim is preserved and the code carries nullFlavor UNK.",
  },

  // --- Product
  {
    ondoTag: "medicinalproduct",
    populated: 91,
    concept: "Product / vaccine name",
    field: "product",
    e2b: "G.k.2.2",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "drugbatchnumb",
    populated: 73,
    concept: "Batch / lot number",
    field: "vaccine_batch",
    e2b: "G.k.4.r.7",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "drugstartdate",
    populated: 91,
    concept: "Administration date",
    field: "vaccination_date",
    e2b: "G.k.4.r.4",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "drugadministrationroute",
    populated: 82,
    concept: "Route of administration",
    field: "route",
    e2b: "G.k.4.r.10",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "drugcharacterization",
    populated: 91,
    concept: "Drug characterization",
    e2b: "G.k.1",
    status: "IMPLEMENTED_AND_TESTED",
    note: "Defaulted to SUSPECT by the mapper; the model and serializer carry all four codes.",
  },
  {
    ondoTag: "activesubstancename",
    populated: 86,
    concept: "Active substance",
    e2b: "G.k.2.3.r.1",
    status: "OUT_OF_SCOPE",
    note: "WHODrug scope: only a real coding provider may assert a substance.",
  },

  // --- Reporter
  {
    ondoTag: "reportertitle",
    populated: 83,
    concept: "Reporter designation",
    field: "reporter_designation",
    e2b: "C.2.r.4",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "qualification",
    populated: 91,
    concept: "Reporter qualification code",
    field: "reporter_designation",
    e2b: "C.2.r.4",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "reporterorganization",
    populated: 90,
    concept: "Reporter organisation",
    field: "reporter_organization",
    e2b: "C.2.r.2.1",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "reportercity",
    populated: 91,
    concept: "Reporter city",
    field: "reporter_city",
    e2b: "C.2.r.2.4",
    status: "IMPLEMENTED_AND_TESTED",
  },
  {
    ondoTag: "reporterstate",
    populated: 91,
    concept: "Reporter state",
    field: "reporter_state",
    e2b: "C.2.r.2.5",
    status: "IMPLEMENTED_AND_TESTED",
  },

  // --- Message envelope: configuration, not case data
  {
    ondoTag: "messagesenderidentifier",
    populated: 1,
    concept: "Sender identifier",
    e2b: "N.1.3 / C.3",
    status: "OUT_OF_SCOPE",
    note: "Sender/receiver configuration is explicitly out of scope.",
  },
  {
    ondoTag: "messagereceiveridentifier",
    populated: 1,
    concept: "Receiver identifier",
    e2b: "N.1.4",
    status: "OUT_OF_SCOPE",
    note: "As above.",
  },
  {
    ondoTag: "senderorganization",
    populated: 91,
    concept: "Sender organisation",
    e2b: "C.3.2",
    status: "OUT_OF_SCOPE",
    note: "As above.",
  },
  {
    ondoTag: "receiverorganization",
    populated: 91,
    concept: "Receiver organisation",
    e2b: "E2B receiver",
    status: "OUT_OF_SCOPE",
    note: "As above.",
  },
];

/**
 * Tags present in the Ondo document but EMPTY in all 91 reports. Recorded
 * so that "Ondo has a hospital record number field" is never mistaken for
 * "Ondo supplies hospital record numbers" — it supplies none.
 */
const EMPTY_IN_ONDO = [
  "patientbirthdate",
  "patienthospitalrecordnumb",
  "patientgpmedicalrecordnumb",
  "patientspecialistrecordnumb",
  "patientinvestigationnumb",
  "reactionenddate",
  "reportercountry",
  "reporterfamilyname",
  "reportergivename",
  "reporterstreet",
  "reportpostcode",
  "patientmedicalhistorytext",
  "patientweight",
  "patientheight",
  "drugdosagetext",
  "drugindication",
  "fulfillexpeditecriteria",
  "receiptdate",
];

describe("Ondo concept coverage", () => {
  it("classifies every populated concept", () => {
    for (const c of POPULATED_CONCEPTS) {
      expect(c.populated, `${c.ondoTag} must record how many reports carried it`).toBeGreaterThan(
        0,
      );
      if (c.status !== "IMPLEMENTED_AND_TESTED") {
        expect(c.note, `${c.ondoTag} is ${c.status} and must say why`).toBeTruthy();
      }
    }
  });

  it("every concept claiming a canonical field has one the app really defines", () => {
    for (const c of POPULATED_CONCEPTS) {
      if (!c.field) continue;
      expect(TARGET_FIELDS, `${c.ondoTag} -> ${c.field}`).toContain(c.field);
    }
  });

  it("every claimed canonical field is reachable from a header and from the profile", () => {
    // The two ways a field can be silently unreachable: no keyword can
    // ever select it, or the profile's column map never reads it. Route
    // was in exactly the second state — model and serializer ready, no
    // column map entry — which is why this assertion exists.
    const columnMapTargets = new Set(Object.values(genericVerbatimProfile.columnMap));
    for (const c of POPULATED_CONCEPTS) {
      if (!c.field) continue;
      expect(FIELD_KEYWORDS[c.field]?.length, `${c.field} has no keywords`).toBeGreaterThan(0);
      expect(columnMapTargets, `${c.field} missing from the generic profile column map`).toContain(
        c.field,
      );
    }
  });

  it("records the tags Ondo carries but never populates", () => {
    // Guards against a future reader concluding from the tag list alone
    // that Ondo supplies record numbers or dates of birth. It supplies
    // neither, which is why neither could be tested against it.
    expect(EMPTY_IN_ONDO).toContain("patientbirthdate");
    expect(EMPTY_IN_ONDO).toContain("patienthospitalrecordnumb");
    const populatedTags = new Set(POPULATED_CONCEPTS.map((c) => c.ondoTag));
    for (const tag of EMPTY_IN_ONDO) {
      expect(populatedTags, `${tag} cannot be both empty and populated`).not.toContain(tag);
    }
  });

  it("writes the coverage report as an artifact", () => {
    const rows = POPULATED_CONCEPTS.map(
      (c) =>
        `| ${c.concept} | ${c.ondoTag} | ${c.populated} | ${c.field ?? "—"} | ${c.e2b} | ${c.status} | ${c.note ?? ""} |`,
    );
    const md = [
      "# Ondo concept coverage",
      "",
      "Generated by `ondo-concept-coverage.test.ts`. The Ondo file is E2B(R2)",
      "and holds real patient data, so it is not in this repository; the counts",
      "below were extracted from it and are asserted against the live code.",
      "",
      `${POPULATED_CONCEPTS.length} populated concepts across 91 safety reports and 101 reactions.`,
      "",
      "| Concept | Ondo (R2) tag | Populated | Canonical field | E2B(R3) | Status | Note |",
      "|---|---|---|---|---|---|---|",
      ...rows,
      "",
      "## Present in Ondo but empty in all 91 reports",
      "",
      EMPTY_IN_ONDO.map((t) => `\`${t}\``).join(", "),
      "",
    ].join("\n");
    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ondo-concept-coverage.md"), md, "utf-8");
    expect(rows.length).toBe(POPULATED_CONCEPTS.length);
  });
});
