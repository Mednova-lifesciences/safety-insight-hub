import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapSourceRecordToPVCase } from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";
import type { PVCase } from "./types";

/**
 * End-to-end regression fixture for E.i.7.
 *
 * A realistic AEFI line list — the shape a state programme actually sends,
 * with its own case numbers, real vaccine names, batch numbers, doses,
 * reporter designations and dates — carried through the whole pipeline the
 * product uses: source record -> mapSourceRecordToPVCase -> PVCase ->
 * serializeBatchToXml -> the bytes that would be sent.
 *
 * Between them the ten rows exercise every one of the six ICH E.i.7 values
 * (0-5), each reached by a different route: a plain word ("Recovered"), a
 * synonym ("Improving", "Resolved with residual effects"), an explicit
 * "Unknown", and an empty cell, which is the case that used to emit no
 * E.i.7 element at all.
 *
 * The assertions are on the serialized XML, message by message, not on the
 * intermediate model — the point of this fixture is that the file leaving
 * the system is right.
 */
const ROWS: Record<string, string | undefined>[] = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "outcome-batch-rows.json"), "utf-8"),
);

/** What each row's outcome column must become, in ICH's codelist. */
const EXPECTED_OUTCOME_CODES = [
  "1", // "Recovered"
  "2", // "Recovering"
  "3", // "Not recovered"
  "4", // "Recovered with sequelae"
  "5", // "Fatal"
  "0", // "Unknown"
  "2", // "Improving" — synonym
  "0", // "" — nothing said: the required element is Unknown, never absent
  "1", // "Resolved" — synonym
  "4", // "Resolved with residual effects" — synonym
];

const TRANSMISSION: E2bTransmissionConfig = {
  ...UNCONFIRMED_DEFAULT_CONFIG,
  environment: "uat",
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND-01" },
  receiver: { identifier: "NAFDAC-RCV-01" },
  reportType: "1",
  reportTypeConfirmed: true,
};

async function buildBatch(): Promise<{ cases: PVCase[]; xml: string }> {
  const cases = await Promise.all(
    ROWS.map(async (row, i) => {
      const { pvCase } = await mapSourceRecordToPVCase(
        row,
        genericVerbatimProfile,
        TRANSMISSION,
        {
          jobId: "job-outcome-fixture",
          sourceFile: "ogun_aefi_august_2026.csv",
          sourceRow: i + 1,
          processedAt: "2026-08-27T09:15:00Z",
        },
        { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
      );
      return pvCase;
    }),
  );
  const xml = serializeBatchToXml(cases, {
    batchId: "MEDNOVA-OGUN-202608-0001",
    senderId: TRANSMISSION.sender.identifier,
    receiverId: TRANSMISSION.receiver.identifier,
    transmissionTimestamp: new Date("2026-08-27T09:15:00Z"),
  });
  return { cases, xml };
}

/** The ICSR messages, in document order, each as its own slice of XML. */
function messages(xml: string): string[] {
  return xml
    .split("<PORR_IN049016UV>")
    .slice(1)
    .map((part) => part.split("</PORR_IN049016UV>")[0]!);
}

const OUTCOME_ELEMENT =
  /<code code="27" codeSystem="2\.16\.840\.1\.113883\.3\.989\.2\.1\.1\.19"[^>]*displayName="outcome"\/><value xsi:type="CE" code="(\d+)" codeSystem="([\d.]+)" codeSystemVersion="([\d.]+)"\/>/g;

function outcomesIn(message: string): { code: string; codeSystem: string }[] {
  return [...message.matchAll(OUTCOME_ELEMENT)].map((m) => ({
    code: m[1]!,
    codeSystem: m[2]!,
  }));
}

describe("end-to-end: a realistic batch carrying all six E.i.7 outcomes", () => {
  it("gives every case the outcome its own source row states", async () => {
    const { xml } = await buildBatch();
    const perMessage = messages(xml).map((m) => outcomesIn(m)[0]?.code);
    expect(perMessage).toEqual(EXPECTED_OUTCOME_CODES);
  });

  it("covers all six ICH values, and nothing outside them", async () => {
    const { xml } = await buildBatch();
    const codes = messages(xml).flatMap((m) => outcomesIn(m).map((o) => o.code));
    expect(new Set(codes)).toEqual(new Set(["0", "1", "2", "3", "4", "5"]));
    expect(codes.every((c) => ["0", "1", "2", "3", "4", "5"].includes(c))).toBe(true);
    expect(codes).not.toContain("6");
  });

  it("emits exactly one E.i.7 per reaction, including the case with two", async () => {
    const { cases, xml } = await buildBatch();
    const msgs = messages(xml);
    expect(msgs).toHaveLength(ROWS.length);
    msgs.forEach((message, i) => {
      expect(outcomesIn(message)).toHaveLength(cases[i]!.reactions.length);
    });
    // Row 7 ("Fever, Rash") is the two-reaction case; both carry the same
    // source outcome, because the source states one for the case.
    expect(cases[6]!.reactions).toHaveLength(2);
    expect(outcomesIn(msgs[6]!).map((o) => o.code)).toEqual(["2", "2"]);
  });

  it("never omits the element, even where the source said nothing", async () => {
    const { xml } = await buildBatch();
    // Row 8's outcome cell is empty — the defect this fixture pins.
    const message = messages(xml)[7]!;
    expect(outcomesIn(message)).toHaveLength(1);
    expect(outcomesIn(message)[0]!.code).toBe("0");
  });

  it("uses the ICH E.i.7 code system on every one of them", async () => {
    const { xml } = await buildBatch();
    const systems = messages(xml).flatMap((m) => outcomesIn(m).map((o) => o.codeSystem));
    expect(new Set(systems)).toEqual(new Set(["2.16.840.1.113883.3.989.2.1.1.11"]));
  });

  it("keeps each case's identity intact around the outcome", async () => {
    const { cases, xml } = await buildBatch();
    const msgs = messages(xml);
    msgs.forEach((message, i) => {
      const id = cases[i]!.caseSafetyReportId;
      // N.2.r.1 opens the message; C.1.1 opens the investigationEvent.
      expect(
        message.startsWith(`<id extension="${id}" root="2.16.840.1.113883.3.989.2.1.3.1"/>`),
      ).toBe(true);
      expect(message).toContain(
        `<investigationEvent classCode="INVSTG" moodCode="EVN"><id extension="${id}" root="2.16.840.1.113883.3.989.2.1.3.1"/>`,
      );
    });
    // The Kenyan row reports from KE about an event in NG. C.2.r.3 and
    // E.i.9 record those two separate facts; C.1.1 records neither of
    // them, because it is the identifier the source itself issued —
    // slashes and all.
    expect(cases[8]!.reporter.country).toBe("KE");
    expect(cases[8]!.caseSafetyReportId).toBe("KE/AEFI/2026/0088");
    expect(msgs[8]).toContain('<code code="NG" codeSystem="1.0.3166.1.2.2"/>');
  });

  it("keeps every root attribute a valid HL7 uid, whatever the case number looks like", async () => {
    // These rows use the case numbers an AEFI programme actually issues —
    // "OG/AEFI/2026/0413". The ids minted from them reach `root`, which is
    // typed uid: an OID, a UUID, or an ruid ([A-Za-z][A-Za-z0-9-]*). Before
    // this fixture existed the slashes went straight through and made the
    // whole document schema-invalid.
    const { xml } = await buildBatch();
    const roots = [...xml.matchAll(/root="([^"]+)"/g)].map((m) => m[1]!);
    const oid = /^[0-2](\.(0|[1-9][0-9]*))*$/;
    const uuid = /^[0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}$/;
    const ruid = /^[A-Za-z][A-Za-z0-9-]*$/;
    expect(roots.length).toBeGreaterThan(0);
    const invalid = roots.filter((r) => !oid.test(r) && !uuid.test(r) && !ruid.test(r));
    expect(invalid).toEqual([]);
  });

  it("still points each causality assessment at its own product", async () => {
    const { xml } = await buildBatch();
    for (const message of messages(xml)) {
      const productIds = [
        ...message.matchAll(/<substanceAdministration[^>]*><id root="([^"]+)"/g),
      ].map((m) => m[1]!);
      const referenced = [
        ...message.matchAll(/<productUseReference[^>]*><id root="([^"]+)"\/>/g),
      ].map((m) => m[1]!);
      expect(referenced.length).toBeGreaterThan(0);
      for (const reference of referenced) expect(productIds).toContain(reference);
    }
  });

  it("writes the fixture out for schema validation outside the test process", async () => {
    const { xml } = await buildBatch();
    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "test-outcome-batch.xml"), xml, "utf-8");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<name code="1" codeSystem="2.16.840.1.113883.3.989.2.1.1.1"/>');
  });
});
