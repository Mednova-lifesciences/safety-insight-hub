import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeBatchToXml, toHl7Ts } from "./serializer";
import type { PVCase } from "./types";

function baseCase(overrides: Partial<PVCase> = {}): PVCase {
  return {
    internalCaseId: "job-1",
    sendersCaseId: "NG-MEDNOVA-000001",
    caseSafetyReportId: "NG-MEDNOVA-000001",
    worldwideUniqueId: "NG-MEDNOVA-000001",
    firstSenderOfCase: "2",
    reportType: { present: true, value: "1" },
    dateOfCreation: "2026-09-09T08:19:00Z",
    dateFirstReceived: "2026-09-03T00:00:00Z",
    dateMostRecentInfo: "2026-09-09T00:00:00Z",
    additionalDocumentsAvailable: false,
    fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" },
    otherCaseIdentifiersInPreviousTransmissions: { present: false, nullFlavor: "NI" },
    followUp: { isFollowUp: false },
    patient: {
      identity: { present: true, value: { kind: "INITIALS", initials: "A.E." } },
      sex: "FEMALE",
      age: "5",
      ageUnit: "801",
    },
    reporter: {
      name: { present: false, nullFlavor: "NASK" },
      country: "NG",
      qualificationVerbatim: "CHEW",
    },
    senderOrganisation: "MEDNOVA",
    reactions: [
      {
        id: "r1",
        sourceDecoding: {
          status: "DECODED",
          localCode: "19",
          sourceTerm: "19",
          sourceProfileId: "test-profile",
        },
        reaction: { sourceValue: "19", status: "UNMAPPED", mappingMethod: "NONE" },
        onsetDate: "2026-09-04",
        outcome: "RECOVERED",
        seriousnessCriteria: {
          resultsInDeath: false,
          lifeThreatening: false,
          hospitalization: false,
          disabling: false,
          congenitalAnomaly: false,
          otherMedicallyImportant: false,
        },
      },
    ],
    products: [
      {
        id: "p1",
        characterization: "SUSPECT",
        product: { sourceValue: "PENTA", status: "UNMAPPED", mappingMethod: "NONE" },
        batchNumber: "LOT-2026-0091",
        dose: "0.5ml",
        startDate: "2026-09-03",
      },
    ],
    narrative:
      "5-year-old female (initials A.E.) developed fever following PENTA vaccination administered 2026-09-03; reported recovered.",
    sourceInformation: {
      sourceFile: "ondo_aefi_linelist.xlsx",
      sourceRow: 2,
      jobId: "job-1",
      sourceProfileId: "test-profile",
    },
    ...overrides,
  };
}

describe("serializeBatchToXml", () => {
  it.each([
    ["RECOVERED", "1"],
    ["RECOVERING", "2"],
    ["NOT_RECOVERED", "3"],
    ["RECOVERED_WITH_SEQUELAE", "4"],
    ["FATAL", "5"],
    ["UNKNOWN", "0"],
  ] as const)(
    "serializes ICH E.i.7 %s as %s without administrator configuration",
    (outcome, code) => {
      const xml = serializeBatchToXml(
        [baseCase({ reactions: [{ ...baseCase().reactions[0]!, outcome }] })],
        {
          batchId: "B",
          senderId: "S",
          receiverId: "R",
          transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
          outcomeCodes: { UNKNOWN: "6" },
        },
      );
      expect(xml).toContain(`code="${code}"`);
      if (outcome === "UNKNOWN") expect(xml).not.toContain('code="6"');
    },
  );

  it("serializes a structured numeric dose as doseQuantity when a known unit is present", () => {
    const xml = serializeBatchToXml(
      [
        baseCase({
          products: [{ ...baseCase().products[0]!, dose: "1 mL" }],
        }),
      ],
      {
        batchId: "B",
        senderId: "S",
        receiverId: "R",
        transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
      },
    );

    expect(xml).toContain('<doseQuantity value="1" unit="mL"/>');
    expect(xml).not.toContain("<text>1 mL</text>");
  });

  it("serializes unitless numeric dose as G.k.4.r.8 text instead of doseQuantity", () => {
    const xml = serializeBatchToXml(
      [
        baseCase({
          products: [{ ...baseCase().products[0]!, dose: "1" }],
        }),
      ],
      {
        batchId: "B",
        senderId: "S",
        receiverId: "R",
        transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
      },
    );

    expect(xml).toContain("<text>1</text>");
    expect(xml).not.toContain('<doseQuantity value="1"');
    expect(xml).not.toContain('<doseQuantity nullFlavor="UNK"');
  });

  it("serializes nonnumeric dose text as G.k.4.r.8 text and never inside doseQuantity", () => {
    const xml = serializeBatchToXml(
      [
        baseCase({
          products: [{ ...baseCase().products[0]!, dose: "booster" }],
        }),
      ],
      {
        batchId: "B",
        senderId: "S",
        receiverId: "R",
        transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
      },
    );

    expect(xml).toContain("<text>booster</text>");
    expect(xml).not.toContain('<doseQuantity nullFlavor="UNK"');
    expect(xml).not.toContain('<doseQuantity value="booster"');
  });
});

/**
 * The batch wrapper (N.1) and the message header (N.2.r), checked against
 * the structure ICH itself publishes: MCCI_MT200100UV.Batch's content model
 * in ICH_ICSR_XML_Schema_Set_v2.5, and the field-to-element mapping spelled
 * out in ICH_ICSR_Reference_Instances_v3.1 — both under
 * regulatory-assets/e2b-r3/official-ich/.
 */
describe("batch wrapper (N.1) and message header (N.2.r)", () => {
  const batchOf = (cases: PVCase[]) =>
    serializeBatchToXml(cases, {
      batchId: "MEDNOVA-BATCH-0001",
      senderId: "MEDNOVA-SENDER",
      receiverId: "NAFDAC-RECEIVER",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });

  it("carries N.1.1 as the coded Type of Messages in Batch, once", () => {
    const xml = batchOf([baseCase(), baseCase({ caseSafetyReportId: "NG-MEDNOVA-000002" })]);
    const n11 = '<name code="1" codeSystem="2.16.840.1.113883.3.989.2.1.1.1"/>';
    expect(xml).toContain(n11);
    expect(xml.split(n11).length - 1).toBe(1);
    // "ichicsr" is E2B(R2)'s <messagetype> literal; R3 codes it as 1.
    expect(xml).not.toContain(">ichicsr<");
  });

  it("puts every N.1 element where the ICH schema's sequence puts it", () => {
    const xml = batchOf([baseCase()]);
    const at = (fragment: string) => xml.indexOf(fragment);
    const id = at('root="2.16.840.1.113883.3.989.2.1.3.22"'); // N.1.2
    const creationTime = at("<creationTime"); // N.1.5
    const interactionId = at('extension="MCCI_IN200100UV01"');
    const name = at('codeSystem="2.16.840.1.113883.3.989.2.1.1.1"'); // N.1.1
    const firstMessage = at("<PORR_IN049016UV>");
    const receiver = xml.lastIndexOf('root="2.16.840.1.113883.3.989.2.1.3.14"'); // N.1.4
    const sender = xml.lastIndexOf('root="2.16.840.1.113883.3.989.2.1.3.13"'); // N.1.3
    expect(id).toBeLessThan(creationTime);
    expect(creationTime).toBeLessThan(interactionId);
    expect(interactionId).toBeLessThan(name);
    expect(name).toBeLessThan(firstMessage);
    // MCCI_MT200100UV.Batch: ... choice(PORR_IN049016UV)[1..*], receiver,
    // respondTo?, sender. The batch's own sender/receiver follow the
    // messages — moving them ahead of the messages, as looks natural,
    // makes the document schema-invalid.
    expect(firstMessage).toBeLessThan(receiver);
    expect(receiver).toBeLessThan(sender);
  });

  it("uses one identifier for N.2.r.1 and C.1.1, so they cannot drift apart", () => {
    const cases = [
      baseCase({ caseSafetyReportId: "NG-MEDNOVA-000001" }),
      baseCase({ caseSafetyReportId: "NG-MEDNOVA-000002" }),
      baseCase({ caseSafetyReportId: "NG-MEDNOVA-000003" }),
    ];
    const xml = batchOf(cases);
    const messageIds = [...xml.matchAll(/<PORR_IN049016UV><id extension="([^"]+)"/g)].map(
      (m) => m[1],
    );
    const c11 = [
      ...xml.matchAll(
        /<investigationEvent classCode="INVSTG" moodCode="EVN"><id extension="([^"]+)"/g,
      ),
    ].map((m) => m[1]);
    expect(messageIds).toEqual(["NG-MEDNOVA-000001", "NG-MEDNOVA-000002", "NG-MEDNOVA-000003"]);
    expect(messageIds).toEqual(c11);
  });

  it("gives N.2.r.1 and C.1.1 the same ICH namespace OID", () => {
    const xml = batchOf([baseCase()]);
    expect(xml).toContain(
      '<PORR_IN049016UV><id extension="NG-MEDNOVA-000001" root="2.16.840.1.113883.3.989.2.1.3.1"/>',
    );
    expect(xml).toContain(
      '<investigationEvent classCode="INVSTG" moodCode="EVN"><id extension="NG-MEDNOVA-000001" root="2.16.840.1.113883.3.989.2.1.3.1"/>',
    );
  });

  it("routes the message to the configured sender and receiver, not to each other", () => {
    const xml = batchOf([baseCase()]);
    // N.2.r.2 sender ...3.11, N.2.r.3 receiver ...3.12 (message level);
    // N.1.3 sender ...3.13, N.1.4 receiver ...3.14 (batch level).
    expect(xml).toContain(
      '<id extension="MEDNOVA-SENDER" root="2.16.840.1.113883.3.989.2.1.3.11"/>',
    );
    expect(xml).toContain(
      '<id extension="NAFDAC-RECEIVER" root="2.16.840.1.113883.3.989.2.1.3.12"/>',
    );
    expect(xml).toContain(
      '<id extension="NAFDAC-RECEIVER" root="2.16.840.1.113883.3.989.2.1.3.14"/>',
    );
    expect(xml).toContain(
      '<id extension="MEDNOVA-SENDER" root="2.16.840.1.113883.3.989.2.1.3.13"/>',
    );
  });

  it("carries C.1.8.1 and C.1.8.2 on every case", () => {
    const xml = batchOf([baseCase()]);
    // C.1.8.1 — worldwide unique id, its own namespace OID ...3.2.
    expect(xml).toContain(
      '<id extension="NG-MEDNOVA-000001" root="2.16.840.1.113883.3.989.2.1.3.2"/>',
    );
    // C.1.8.2 — first sender of this case (1 = Regulator, 2 = Other).
    expect(xml).toMatch(
      /<code code="2" codeSystem="2\.16\.840\.1\.113883\.3\.989\.2\.1\.1\.3" codeSystemVersion="1\.0"\/>/,
    );
  });
});

describe("E.i.3.2a-f — the six seriousness criteria", () => {
  const CRITERION_CODES = ["34", "21", "33", "35", "12", "26"];
  const batchOf = (c: PVCase) =>
    serializeBatchToXml([c], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
  const criterion = (xml: string, code: string) =>
    xml.match(
      new RegExp(
        `code="${code}" codeSystem="[^"]+" codeSystemVersion="1.1"[^>]*/><value xsi:type="BL" ([^/]+)/>`,
      ),
    )?.[1];

  const withCriteria = (criteria: PVCase["reactions"][number]["seriousnessCriteria"]) => {
    const c = baseCase();
    return { ...c, reactions: [{ ...c.reactions[0]!, seriousnessCriteria: criteria }] } as PVCase;
  };

  it("represents all six on every reaction", () => {
    const xml = batchOf(withCriteria({}));
    for (const code of CRITERION_CODES) expect(criterion(xml, code)).toBeDefined();
  });

  it("says NI — not NASK — for a criterion the case never establishes", () => {
    const xml = batchOf(withCriteria({}));
    for (const code of CRITERION_CODES) expect(criterion(xml, code)).toBe('nullFlavor="NI"');
    // Scoped to these six on purpose. C.1.7 is a different element with a
    // different rule (the spec restricts NI there to R2 retransmissions),
    // and export blocks on an undecided C.1.7 anyway.
    const reactionBlock = xml.slice(
      xml.indexOf('displayName="reaction"'),
      xml.indexOf('displayName="drugInformation"'),
    );
    expect(reactionBlock).not.toContain("NASK");
  });

  it("says true for a criterion the source records as met, and NI for the rest", () => {
    const xml = batchOf(withCriteria({ hospitalization: true }));
    expect(criterion(xml, "33")).toBe('value="true"');
    for (const code of ["34", "21", "35", "12", "26"]) {
      expect(criterion(xml, code)).toBe('nullFlavor="NI"');
    }
  });

  it("says false only where the source positively rules a criterion out", () => {
    const xml = batchOf(withCriteria({ resultsInDeath: false }));
    expect(criterion(xml, "34")).toBe('value="false"');
  });

  it("never invents a criterion from a case-level seriousness word", () => {
    const c = withCriteria({});
    const xml = batchOf({ ...c, aggregateSeriousnessAsReported: "Serious" } as PVCase);
    for (const code of CRITERION_CODES) expect(criterion(xml, code)).toBe('nullFlavor="NI"');
  });
});

describe("serializeBatchToXml — existing behaviour", () => {
  it("produces well-formed XML with the real E2B(R3) root, not the old flat <ichicsr> shape", () => {
    const xml = serializeBatchToXml([baseCase()], {
      batchId: "MEDNOVA-BATCH-TEST",
      senderId: "MEDNOVA",
      receiverId: "NAFDAC",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    expect(xml).toContain("<MCCI_IN200100UV01");
    expect(xml).toContain('xmlns="urn:hl7-org:v3"');
    expect(xml).toContain("<PORR_IN049016UV>");
    expect(xml).not.toContain("<ichicsr>");
    expect(xml).not.toContain("<safetyreport>");
    expect(xml).not.toContain("<serious_verbatim>");
  });

  it("never emits an unparseable malformed timestamp like the old generator's bug", () => {
    expect(() => toHl7Ts("not-a-date")).toThrow();
    const xml = serializeBatchToXml([baseCase()], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    expect(xml).not.toMatch(/value="\d{8}T\d+"/); // never the old "20260909T08191" shape
  });

  it("never emits a raw source reaction/product code as if it were a MedDRA/WHODrug code", () => {
    const xml = serializeBatchToXml([baseCase()], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    // sourceValue "19" and "PENTA" must appear only as originalText/name (verbatim), never as a coded value
    expect(xml).toMatch(/<originalText>19<\/originalText>/);
    expect(xml).not.toMatch(/code="19" codeSystem="2\.16\.840\.1\.113883\.6\.163"/);
  });

  it("writes the required test artifact for the E2B(R3) audit", () => {
    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    const single = serializeBatchToXml([baseCase()], {
      batchId: "MEDNOVA-BATCH-0001",
      senderId: "MEDNOVA",
      receiverId: "NAFDAC",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    writeFileSync(join(dir, "test-valid-icSR.xml"), single, "utf-8");

    const multi = serializeBatchToXml(
      [
        baseCase(),
        baseCase({
          internalCaseId: "job-2",
          sendersCaseId: "NG-MEDNOVA-000002",
          caseSafetyReportId: "NG-MEDNOVA-000002",
          worldwideUniqueId: "NG-MEDNOVA-000002",
          patient: {
            identity: { present: true, value: { kind: "INITIALS", initials: "E.T." } },
            sex: "MALE",
            age: "2",
            ageUnit: "801",
          },
          reactions: [
            {
              id: "r2a",
              sourceDecoding: {
                status: "DECODED",
                localCode: "8",
                sourceTerm: "8",
                sourceProfileId: "test-profile",
              },
              reaction: { sourceValue: "8", status: "UNMAPPED", mappingMethod: "NONE" },
              onsetDate: "2026-09-05",
              outcome: "RECOVERING",
              seriousnessCriteria: { hospitalization: true },
            },
            {
              id: "r2b",
              sourceDecoding: {
                status: "DECODED",
                localCode: "21",
                sourceTerm: "21",
                sourceProfileId: "test-profile",
              },
              reaction: { sourceValue: "21", status: "UNMAPPED", mappingMethod: "NONE" },
              seriousnessCriteria: {},
            },
          ],
          products: [
            {
              id: "p2a",
              characterization: "SUSPECT",
              product: { sourceValue: "IPV", status: "UNMAPPED", mappingMethod: "NONE" },
              batchNumber: "LOT-2026-0044",
            },
            {
              id: "p2b",
              characterization: "SUSPECT",
              product: { sourceValue: "PCV", status: "UNMAPPED", mappingMethod: "NONE" },
              batchNumber: "LOT-2026-0055",
            },
          ],
        }),
        baseCase({
          internalCaseId: "job-3",
          sendersCaseId: "NG-MEDNOVA-000003",
          caseSafetyReportId: "NG-MEDNOVA-000003",
          worldwideUniqueId: "NG-MEDNOVA-000003",
          followUp: { isFollowUp: true, previousTransmissionRef: "NG-MEDNOVA-000003-MSG1" },
        }),
      ],
      {
        batchId: "MEDNOVA-BATCH-0002",
        senderId: "MEDNOVA",
        receiverId: "NAFDAC",
        transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
      },
    );
    writeFileSync(join(dir, "test-multi-case.xml"), multi, "utf-8");

    expect(single.length).toBeGreaterThan(0);
    expect(multi).toMatch(/NG-MEDNOVA-000001[\s\S]*NG-MEDNOVA-000002[\s\S]*NG-MEDNOVA-000003/);
  });
});

/**
 * E.i.7 — Outcome of Reaction/Event at the Time of Last Observation.
 * Required; ICH codelist OID 2.16.840.1.113883.3.989.2.1.1.11, values
 * 0 Unknown, 1 Recovered/Resolved, 2 Recovering/Resolving, 3 Not
 * recovered/Not resolved/Ongoing, 4 Recovered/Resolved with sequelae,
 * 5 Fatal. There is no 6.
 */
describe("E.i.7 — outcome", () => {
  const E17 = /displayName="outcome"\/><value xsi:type="CE" code="(\d+)" codeSystem="([\d.]+)"/;
  const outcomeOf = (c: PVCase) =>
    serializeBatchToXml([c], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    }).match(E17);

  const withOutcome = (outcome: PVCase["reactions"][number]["outcome"]) => {
    const c = baseCase();
    const reaction = { ...c.reactions[0]! };
    if (outcome) reaction.outcome = outcome;
    else delete reaction.outcome;
    return { ...c, reactions: [reaction] } as PVCase;
  };

  it.each([
    ["RECOVERED", "1"],
    ["RECOVERING", "2"],
    ["NOT_RECOVERED", "3"],
    ["RECOVERED_WITH_SEQUELAE", "4"],
    ["FATAL", "5"],
    ["UNKNOWN", "0"],
  ] as const)("serializes %s as %s", (outcome, code) => {
    expect(outcomeOf(withOutcome(outcome))?.[1]).toBe(code);
  });

  it("is emitted even when the case carries no outcome at all, as Unknown", () => {
    // E.i.7 is required: a missing outcome is 0, never a missing element.
    const match = outcomeOf(withOutcome(undefined));
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("0");
  });

  it("uses the ICH E.i.7 code system", () => {
    expect(outcomeOf(withOutcome("RECOVERED"))?.[2]).toBe("2.16.840.1.113883.3.989.2.1.1.11");
  });

  it("can only ever emit one of the six ICH values", () => {
    for (const outcome of [
      "RECOVERED",
      "RECOVERING",
      "NOT_RECOVERED",
      "RECOVERED_WITH_SEQUELAE",
      "FATAL",
      "UNKNOWN",
      undefined,
    ] as const) {
      const code = outcomeOf(withOutcome(outcome))?.[1];
      expect(["0", "1", "2", "3", "4", "5"]).toContain(code);
    }
  });

  it("never emits 6 for Unknown, whatever a caller passes", () => {
    const xml = serializeBatchToXml([withOutcome("UNKNOWN")], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
      // The legacy per-call override is ignored: E.i.7 is ICH's codelist,
      // not configuration.
      outcomeCodes: { UNKNOWN: "6" },
    });
    expect(xml).toMatch(/displayName="outcome"\/><value xsi:type="CE" code="0"/);
    expect(xml).not.toMatch(/displayName="outcome"\/><value xsi:type="CE" code="6"/);
  });

  it("is not decided by seriousness, hospitalisation, causality or drug action", () => {
    const c = withOutcome(undefined);
    const loaded = {
      ...c,
      aggregateSeriousnessAsReported: "Serious",
      narrative: "Patient was hospitalised and later died; suspect drug withdrawn.",
      reactions: [
        {
          ...c.reactions[0]!,
          seriousnessCriteria: { hospitalization: true, resultsInDeath: true },
        },
      ],
    } as PVCase;
    // Every one of those would tempt an inference. None of them is an
    // outcome, so the answer stays Unknown.
    expect(outcomeOf(loaded)?.[1]).toBe("0");
  });
});

/**
 * E.i.9 — Identification of the Country Where the Reaction/Event Occurred.
 * ICH E2B(R3) Q&A: E.i.9 is not an alternative to the reporter's country
 * code (C.2.r.3), and a change of E.i.9 never changes C.1.1.
 */
describe("E.i.9 — country of occurrence", () => {
  const batchOf = (c: PVCase) =>
    serializeBatchToXml([c], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
  const withReactionCountry = (country: string | undefined) => {
    const c = baseCase();
    const reaction = { ...c.reactions[0]! };
    if (country) reaction.countryOfOccurrence = country;
    return { ...c, reactions: [reaction] } as PVCase;
  };

  it("is emitted with the ISO 3166-1 code system when the source supplied it", () => {
    expect(batchOf(withReactionCountry("GH"))).toContain(
      '<locatedPlace classCode="COUNTRY" determinerCode="INSTANCE"><code code="GH" codeSystem="1.0.3166.1.2.2"/></locatedPlace>',
    );
  });

  it("is absent when the source never said where the reaction happened", () => {
    expect(batchOf(withReactionCountry(undefined))).not.toContain("locatedPlace");
  });

  it("is not copied from the reporter's country", () => {
    // The case reports from NG (C.2.r.3) with no reaction country: nothing
    // invents E.i.9 = NG from it.
    const xml = batchOf(withReactionCountry(undefined));
    expect(xml).toContain('<code code="NG" codeSystem="1.0.3166.1.2.2"/>'); // C.2.r.3
    expect(xml).not.toContain("locatedPlace");
  });

  it("never changes C.1.1 — the ICH Q&A rule", () => {
    const c11 = (xml: string) =>
      xml.match(
        /<investigationEvent classCode="INVSTG" moodCode="EVN"><id extension="([^"]+)"/,
      )?.[1];
    const noCountry = c11(batchOf(withReactionCountry(undefined)));
    const inGhana = c11(batchOf(withReactionCountry("GH")));
    const inKenya = c11(batchOf(withReactionCountry("KE")));
    expect(inGhana).toBe(noCountry);
    expect(inKenya).toBe(noCountry);
    expect(noCountry).toBe("NG-MEDNOVA-000001");
  });
});
