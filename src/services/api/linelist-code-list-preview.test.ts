import { beforeEach, describe, expect, it, vi } from "vitest";

const readCodeList = vi.fn();
// A plain function stands in when the AI must fail: Vitest's mock records
// a rejected call as an unhandled error even when the caller catches it.
let failWith: Error | null = null;
vi.mock("./ai", () => ({
  ai: {
    linelist: {
      readCodeList: async (...a: unknown[]) => {
        if (failWith) throw failWith;
        return readCodeList(...a);
      },
    },
  },
}));

const { previewCodeList } = await import("./linelist-code-list");

const job = {
  mapping: {
    SEX: "sex",
    "Outcome (Codes-see 3 below)": "outcome",
    "Colour of card": "card_colour",
  },
  parsedRows: [
    { sex: "1", outcome: "1" },
    { sex: "2", outcome: "4" },
    { sex: "3", outcome: "2" },
  ],
  discardedRows: [
    { row: 250, text: "3) OUTCOME: 1= Recovered, 2=Hospitalized, 3=Disability, 4=Died" },
  ],
};

beforeEach(() => readCodeList.mockReset());

describe("previewing a code list before a person confirms it", () => {
  it("does not call the AI when the rules read everything", async () => {
    const p = await previewCodeList(job, "Sex: 1=Male, 2=Female");
    expect(readCodeList).not.toHaveBeenCalled();
    expect(p.entries.map((e) => `${e.field}|${e.sourceCode}|${e.meaning}|${e.readBy}`)).toEqual([
      "sex|1|Male|rule",
      "sex|2|Female|rule",
    ]);
  });

  it("names codes the file uses that the list does not define", async () => {
    const p = await previewCodeList(job, "Sex: 1=Male, 2=Female");
    expect(p.uncovered).toEqual([{ field: "sex", codes: ["3"] }]);
  });

  it("shows where the list disagrees with the file's own legend", async () => {
    const p = await previewCodeList(job, "Outcome: 1=Recovered, 2=Admitted, 3=Disability, 4=Died");
    expect(p.differsFromFile).toEqual([
      { field: "outcome", sourceCode: "2", inFile: "Hospitalized", inList: "Admitted" },
    ]);
  });

  it("shows a code given two meanings", async () => {
    const p = await previewCodeList(job, "Sex\n1 = Male\n1 = Female");
    expect(p.conflicts).toEqual([{ field: "sex", sourceCode: "1", meanings: ["Male", "Female"] }]);
  });

  it("sends only what the rules could not place to the AI, with the file's columns and fields", async () => {
    readCodeList.mockResolvedValue({
      entries: [{ field: "card_colour", code: "1", meaning: "Red" }],
      unplaced: [],
      ai_used: true,
      prompt_version: "x",
    });
    const p = await previewCodeList(job, "Sex: 1=Male, 2=Female\nfor the card we write 1 for red");
    expect(readCodeList).toHaveBeenCalledTimes(1);
    const body = readCodeList.mock.calls[0]![0] as { text: string; fields: { name: string }[] };
    expect(body.text).toBe("for the card we write 1 for red");
    expect(body.fields.map((f) => f.name)).toContain("card_colour");
    expect(p.entries.find((e) => e.readBy === "ai")).toEqual({
      field: "card_colour",
      sourceCode: "1",
      meaning: "Red",
      readBy: "ai",
    });
    expect(p.aiUsed).toBe(true);
  });

  it("an AI failure keeps what the rules read and says so", async () => {
    failWith = new Error("network");
    const p = await previewCodeList(job, "Sex: 1=Male\nfor the card we write 1 for red");
    failWith = null;
    expect(p.entries).toHaveLength(1);
    expect(p.unplaced).toEqual(["for the card we write 1 for red"]);
    expect(p.aiError).toBe("network");
  });
});
