/**
 * The three new admin features and the AI data log, as each role sees them:
 *   - Review Officer: "PSURs due and overdue" on the dashboard and as a tab on
 *     /screening (seeded PSURs: overdue, due now, due in N, cannot forecast);
 *   - Evaluator: "Batch and facility flags for review" on the dashboard;
 *   - /line-list: possible duplicates for seed file B against A, Not a
 *     duplicate and Drop as duplicate;
 *   - /ai-log for an administrator.
 * Needs the two seed files uploaded and validated (flow-linelist.cjs with
 * FILE_B=1) for the line-list part.
 */
const L = require("./lib.cjs");

const steps = [];
async function step(name, fn) {
  console.log(`▶ ${name}`);
  try {
    const out = await L.timed(name, fn);
    steps.push({ name, ok: true });
    return out;
  } catch (e) {
    steps.push({ name, ok: false, error: e.message.split("\n")[0] });
    console.log(`  ✗ ${name}: ${e.message.split("\n")[0]}`);
    return undefined;
  }
}

async function main() {
  const browser = await L.launch();
  try {
    // ---- Review Officer ----
    const officer = await L.session(browser, "officer");
    await step("officer dashboard: PSURs due and overdue", async () => {
      await L.nav(officer, "Dashboard", /Screening queue/);
      const card = officer
        .locator("section, div")
        .filter({ has: officer.getByText("PSURs due and overdue", { exact: true }) })
        .last();
      await card
        .getByText(/Overdue by \d+ day/)
        .first()
        .waitFor({ timeout: 60000 });
      await L.shot(officer, "feat-officer-dashboard");
      const text = await card.innerText();
      for (const want of [
        "TEST Amlodipine",
        "Overdue",
        "Due now",
        "Cannot forecast",
        "2 of 3 late",
      ])
        if (!text.includes(want)) throw new Error(`forecast card lacks "${want}"`);
      if (text.indexOf("Overdue") > text.indexOf("Due now"))
        throw new Error("overdue is not listed first");
    });
    await step("screening: PSURs due tab", async () => {
      await L.nav(officer, "Report screening", /^Report screening$/);
      await officer.getByRole("tab", { name: "PSURs due and overdue" }).click();
      await officer.getByText("TEST Ceftriaxone 1 g injection").first().waitFor({ timeout: 60000 });
      await officer
        .getByText(/as recorded/)
        .first()
        .waitFor();
      await L.shot(officer, "feat-screening-due-tab");
    });

    // ---- Evaluator ----
    const evaluator = await L.session(browser, "evaluator");
    await step("evaluator dashboard: batch and facility flags", async () => {
      await L.nav(evaluator, "Dashboard", /Scientific review queue/);
      await evaluator
        .getByText("Batch and facility flags for review")
        .first()
        .waitFor({ timeout: 60000 });
      await L.waitNoLoading(evaluator);
      await L.shot(evaluator, "feat-evaluator-dashboard");
      if (process.env.EXPECT_FLAGS === "1") {
        await evaluator.getByText("Batch PCV-7781").first().waitFor({ timeout: 60000 });
        await evaluator.getByText("Flag for review").first().waitFor();
      }
    });

    // ---- Line list: duplicates ----
    if (process.env.EXPECT_FLAGS === "1") {
      await step("line list: possible duplicates for file B", async () => {
        await L.nav(officer, "Line-list processing", /^Line-list processing$/);
        const row = officer.locator("tr").filter({ hasText: "TEST-state-return-B.csv" }).first();
        await row.getByRole("button", { name: "Review issues" }).click();
        await officer
          .getByText("Possible duplicates in other files")
          .first()
          .scrollIntoViewIfNeeded();
        await officer
          .getByRole("button", { name: /Drop row \d+ as duplicate/ })
          .first()
          .waitFor({ timeout: 90000 });
        const n = await officer.getByRole("button", { name: /Drop row \d+ as duplicate/ }).count();
        console.log(`  pairs shown: ${n}`);
        if (n !== 6) throw new Error(`expected 6 duplicate pairs, saw ${n}`);
        await L.shot(officer, "feat-duplicates");
      });
      await step("line list: not a duplicate", () =>
        L.expectNewToast(officer, /not a duplicate/i, () =>
          officer.getByRole("button", { name: "Not a duplicate" }).last().click(),
        ),
      );
      await step("line list: drop as duplicate", () =>
        L.expectNewToast(officer, /dropped as a duplicate/, () =>
          officer
            .getByRole("button", { name: /Drop row \d+ as duplicate/ })
            .first()
            .click(),
        ),
      );
      await step("line list: 4 pairs left", async () => {
        await officer.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].filter((b) =>
              /Drop row \d+ as duplicate/.test(b.textContent || ""),
            ).length === 4,
          null,
          { timeout: 60000 },
        );
      });
    }

    // ---- AI data log ----
    await step("AI data log page", async () => {
      await L.nav(officer, "AI data log", /^AI data log$/);
      await officer
        .getByText(/Recent AI requests/)
        .first()
        .waitFor();
      await L.waitNoLoading(officer);
      await L.shot(officer, "feat-ai-log");
    });
  } finally {
    L.report({ flow: "features", steps });
    await browser.close();
  }
}

main();
