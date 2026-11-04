import { describe, expect, it } from "vitest";
import type { CaseDetail } from "@/types/pv";
import { draftNarrative } from "./narrative";

const base = {
  id: "MN-1",
  patientIdentifier: "PT-1",
  product: "Paracetamol",
  reaction: "Rash",
  seriousness: "SERIOUS",
  outcome: "RECOVERED",
  workflowStep: "TRIAGE",
  assignedTo: "x",
  receivedDate: "2026-10-01",
  dueDate: "2026-10-16",
  priority: "HIGH",
  flags: [],
  source: "MANUAL",
  intakeChannel: "BRANCH",
  branch: "Lekki Phase 1",
  reporter: { name: "R", qualification: "Pharmacist", country: "Nigeria" },
  patient: { identifier: "PT-1", age: "34", sex: "FEMALE" },
  suspectProducts: [
    {
      reportedName: "Paracetamol 500 mg",
      dose: "1 g",
      route: "oral",
      indication: "headache",
      therapyStart: "2026-09-28",
      action: "Drug withdrawn",
      batchNumber: "PX-1",
    },
  ],
  reactions: [
    {
      reportedTerm: "itchy rash",
      onsetDate: "2026-09-29",
      outcome: "RECOVERED",
      codedTerm: {
        term: "Rash pruritic",
        code: "10037884",
        dictionary: "MedDRA",
        dictionaryVersion: "29.1",
      },
    },
  ],
  narrative: "",
  reportedSeriousnessCriteria: ["Requires hospitalisation"],
  followUpRequests: [],
  workflowState: {},
} as unknown as CaseDetail;

describe("draftNarrative", () => {
  it("states the recorded facts in order, with the MedDRA code", () => {
    const text = draftNarrative(base);
    expect(text).toContain(
      "Pharmacist in Nigeria reported this case on 2026-10-01 (source: Branch / store — Lekki Phase 1).",
    );
    expect(text).toContain(
      "A 34-year-old female patient received Paracetamol 500 mg 1 g oral for headache from 2026-09-28.",
    );
    expect(text).toContain(
      "On 2026-09-29, the patient experienced itchy rash (MedDRA 29.1 LLT: Rash pruritic, 10037884).",
    );
    expect(text).toContain("Action taken with Paracetamol 500 mg: drug withdrawn.");
    expect(text).toContain("Batch PX-1.");
    expect(text).toContain("reported as serious (requires hospitalisation)");
    expect(text).not.toContain("Not reported");
  });

  it("lists what is missing instead of guessing", () => {
    const text = draftNarrative({
      ...base,
      seriousness: "UNASSESSED",
      patient: { identifier: "PT-1" },
      suspectProducts: [{ reportedName: "Paracetamol" }],
      reactions: [{ reportedTerm: "rash", outcome: "UNKNOWN" }],
    });
    expect(text).toContain("A patient received Paracetamol.");
    expect(text).toContain("The patient experienced rash.");
    expect(text).toContain("Seriousness has not yet been assessed.");
    expect(text).toContain(
      "Not reported: patient age, patient sex, indication, therapy start date, onset date, action taken with the product.",
    );
  });
});
