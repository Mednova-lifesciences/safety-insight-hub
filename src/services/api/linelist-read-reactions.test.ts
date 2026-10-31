import { describe, expect, it } from "vitest";
import { readRowsWithSeriousness } from "./linelist";

// A coded state return: the reaction column holds the form's codes and the
// legend under the table says what they mean.
const LEGEND = [
  { row: 30, text: "KEY TO SUMMARY FINDINGS:" },
  {
    row: 31,
    text: "1) REACTION TYPE : 1=Anaphylaxis, 2=Fainting/Syncope, 4=Hotness of body, 5=Persistent cries (more than 3 hours), 12=Vaccine failure",
  },
  { row: 32, text: "3) OUTCOME: 1= Recovered, 2=Recovering, 4=Died" },
];

const reactionsOf = (job: Parameters<typeof readRowsWithSeriousness>[0]) =>
  readRowsWithSeriousness(job).map((r) => r.reactions);

describe("readRowsWithSeriousness — reactions", () => {
  it("decodes a coded file's reaction-code column through its own legend", () => {
    expect(
      reactionsOf({
        filename: "coded.xlsx",
        sourceProfileId: "ondo-aefi",
        discardedRows: LEGEND,
        parsedRows: [
          { reaction_code: "5, 4", product: "Pentavalent" },
          { reaction_code: "12", product: "Measles-Rubella" },
        ],
      }),
    ).toEqual([["Persistent cries (more than 3 hours)", "Hotness of body"], ["Vaccine failure"]]);
  });

  it("decodes codes written in the reaction column itself", () => {
    expect(
      reactionsOf({
        filename: "coded.xlsx",
        sourceProfileId: "ondo-aefi",
        discardedRows: LEGEND,
        parsedRows: [{ reaction: "2", product: "HPV" }],
      }),
    ).toEqual([["Fainting/Syncope"]]);
  });

  it("keeps a code the legend does not define as written", () => {
    expect(
      reactionsOf({
        filename: "coded.xlsx",
        sourceProfileId: "ondo-aefi",
        discardedRows: LEGEND,
        parsedRows: [{ reaction_code: "99", product: "BCG" }],
      }),
    ).toEqual([["99"]]);
  });

  it("splits a text file's reactions on its separators, as before", () => {
    expect(
      reactionsOf({
        filename: "text.csv",
        sourceProfileId: "generic-verbatim",
        parsedRows: [{ reaction: "Fever, Rash" }, { reaction: "Fever / Vomiting" }, {}],
      }),
    ).toEqual([["Fever", "Rash"], ["Fever / Vomiting"], []]);
  });
});
