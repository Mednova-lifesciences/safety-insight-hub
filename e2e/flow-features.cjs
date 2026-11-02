/**
 * The three new admin features and the AI data log, as each role sees them:
 *   - Review Officer: "PSURs due and overdue" on the dashboard and as a tab on
 *     /screening (seeded PSURs: overdue, due now, due in N, cannot forecast);
 *   - Evaluator: "Batch and facility flags for review" on the dashboard;
 *   - /line-list: possible duplicates for seed file B against A, Not a
 *     duplicate and Drop as duplicate;
 *   - the batch BCG-0420 flag: its pattern note and quality warning signs,
 *     and a referral to post-market surveillance with the note downloaded;
 *   - /signal-screen as the Review Officer, Evaluator and Peer Reviewer: the
 *     one candidate (HPV × Syncope), the small-numbers warning, a pair
 *     under N = 3, a load time under 3 s, and a Monitor decision;
 *   - /ai-log for an administrator.
 * Needs the three seed files uploaded and validated (flow-linelist.cjs with
 * FILE_B=1 FILE_C=1) for the line-list part.
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
      await officer
        .getByText("PSURs due and overdue", { exact: true })
        .first()
        .waitFor({ timeout: 60000 });
      await officer
        .getByText(/Overdue by \d+ day/)
        .first()
        .waitFor({ timeout: 90000 });
      // Each reminder is a compact row; its MAH record shows when expanded.
      await officer
        .getByRole("button", { name: /Show details for TEST Amlodipine/ })
        .first()
        .click();
      await officer.getByText("MAH record").first().waitFor();
      await L.shot(officer, "feat-officer-dashboard");
      const text = await officer.locator("main, body").first().innerText();
      for (const want of ["TEST Amlodipine", "Due now", "2 of 3 late"])
        if (!text.includes(want)) throw new Error(`forecast card lacks "${want}"`);
      if (text.indexOf("Overdue by") > text.indexOf("Due now"))
        throw new Error("overdue is not listed first");
    });
    await step("screening: PSURs due tab", async () => {
      await L.nav(officer, "Report screening", /^Report screening$/);
      await officer.getByRole("tab", { name: "PSURs due and overdue" }).click();
      await officer.getByText("TEST Ceftriaxone 1 g injection").first().waitFor({ timeout: 60000 });
      await officer
        .getByRole("button", { name: /Show details for TEST Ceftriaxone/ })
        .first()
        .click();
      await officer
        .getByText(/as recorded/)
        .first()
        .waitFor();
      await L.shot(officer, "feat-screening-due-tab");
    });

    // ---- Evaluator ----
    const evaluator = await L.session(browser, "evaluator");
    // Every Supabase request on this visit, with start and end, so a slow
    // flags card shows which request it was waiting on.
    const trace = [];
    let traceT0 = Date.now();
    const traced = (u) => /\/rest\/v1\/|\/auth\/v1\//.test(u);
    const short = (u) => u.replace(/^https?:\/\/[^/]+/, "").slice(0, 70);
    evaluator.on(
      "request",
      (r) => traced(r.url()) && trace.push(`+${Date.now() - traceT0} start ${short(r.url())}`),
    );
    evaluator.on(
      "requestfinished",
      (r) => traced(r.url()) && trace.push(`+${Date.now() - traceT0} done  ${short(r.url())}`),
    );
    evaluator.on(
      "requestfailed",
      (r) =>
        traced(r.url()) &&
        trace.push(`+${Date.now() - traceT0} FAIL  ${short(r.url())} ${r.failure()?.errorText}`),
    );
    await step("evaluator dashboard: batch and facility flags", async () => {
      traceT0 = Date.now();
      trace.length = 0;
      await L.nav(evaluator, "Dashboard", /Scientific review queue/);
      await evaluator
        .getByText("Batch and facility flags for review")
        .first()
        .waitFor({ timeout: 60000 });
      await L.waitNoLoading(evaluator);
      await L.shot(evaluator, "feat-evaluator-dashboard");
      if (process.env.EXPECT_FLAGS === "1") {
        try {
          await evaluator.getByText("Batch PCV-7781").first().waitFor({ timeout: 60000 });
        } catch (e) {
          console.log("  request trace for this visit:");
          for (const t of trace.slice(0, 60)) console.log(`    ${t}`);
          throw e;
        }
        await evaluator.getByText("Flag for review").first().waitFor();
      }
    });

    // ---- Observed vs expected (Phase 3) ----
    if (process.env.EXPECT_FLAGS === "1") {
      await step("evaluator: observed vs expected, HPV anaphylaxis", async () => {
        await L.nav(evaluator, "Dashboard", /Scientific review queue/);
        const card = evaluator
          .locator("section, div")
          .filter({
            has: evaluator.getByText("Observed vs expected (screening check)", { exact: true }),
          })
          .last();
        await card.scrollIntoViewIfNeeded();
        await evaluator.getByLabel("Doses administered").fill("50000");
        await evaluator.getByRole("button", { name: /Run check/ }).click();
        // A3 and B2 are the same case reported twice: counted once.
        await evaluator
          .getByText(/Observed\s*1\s*·\s*expected\s*0\.085/)
          .first()
          .waitFor({ timeout: 60000 });
        await evaluator.getByText("Higher than expected, within chance").first().waitFor();
        await L.shot(evaluator, "feat-observed-expected");
      });
    }

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

    // ---- Quality flag: pattern note and PMS referral (seed file C) ----
    if (process.env.EXPECT_FLAGS === "1") {
      const bcg = () =>
        evaluator.locator("li[data-e2e-flag]").filter({ hasText: "Batch BCG-0420" }).first();
      await step("evaluator: pattern note on batch BCG-0420", async () => {
        await L.nav(evaluator, "Dashboard", /Scientific review queue/);
        await bcg().waitFor({ timeout: 90000 });
        await bcg().getByText("Possible product quality concern", { exact: true }).waitFor();
        // A flag is one line until expanded; its warning signs and cases open below.
        await bcg()
          .getByRole("button", { name: /Show details for Batch BCG-0420/ })
          .click();
        for (const sign of ["Lack of effect / vaccine failure", "Injection-site abscess"])
          await bcg()
            .getByText(new RegExp(sign.replace(/[/]/g, "\\/")))
            .first()
            .waitFor();
        const text = await bcg().innerText();
        if (/fake|counterfeit/i.test(text)) throw new Error("flag text says fake/counterfeit");
        await bcg().scrollIntoViewIfNeeded();
        await L.shot(evaluator, "feat-quality-flag");
      });
      await step("evaluator: refer BCG-0420 to post-market surveillance", async () => {
        await bcg().getByRole("button", { name: "Refer to post-market surveillance" }).click();
        await bcg()
          .locator("textarea")
          .fill("E2E (synthetic): abscess and lack of effect at three facilities on one batch.");
        await L.download(evaluator, () =>
          bcg().getByRole("button", { name: "Record referral and download note" }).click(),
        );
        await bcg()
          .getByText(/Referred to PMS · PMS-\d{4}-\d{4}/)
          .waitFor({ timeout: 60000 });
        await L.shot(evaluator, "feat-pms-referral");
      });
    }

    // ---- Signal screen, as each assessor ----
    if (process.env.EXPECT_FLAGS === "1") {
      const peer = await L.session(browser, "peer");
      const roles = [
        ["officer", officer],
        ["evaluator", evaluator],
        ["peer", peer],
      ];
      for (const [who, page] of roles) {
        await step(`signal screen as ${who}`, async () => {
          const t0 = Date.now();
          await L.nav(page, "Signal screening", /^Signal screening$/);
          const candidate = page.locator("li[data-e2e-candidate]").first();
          await candidate.waitFor({ timeout: 60000 });
          const ms = Date.now() - t0;
          console.log(`  signal screen loaded in ${ms} ms`);
          await candidate.getByText("HPV").first().waitFor();
          await candidate.getByText("Syncope").first().waitFor();
          await page.getByText("Small numbers — interpret with caution").waitFor();
          await page.getByText("Statistical screen, not a confirmed signal").first().waitFor();
          const n = await page.locator("li[data-e2e-candidate]").count();
          if (n !== 1) throw new Error(`expected 1 candidate, saw ${n}`);
          await page
            .locator("tr[data-e2e-other-pair]")
            .filter({ hasText: "Thrombocytopenia" })
            .getByText(/N 2 < 3/)
            .waitFor();
          if (who === "officer") await L.shot(page, "feat-signal-screen");
          if (ms > 3000) throw new Error(`signal screen took ${ms} ms (limit 3000)`);
        });
      }
      await step("signal screen: evaluator records Monitor", async () => {
        const candidate = evaluator.locator("li[data-e2e-candidate]").first();
        // A candidate is one line until expanded.
        await candidate.getByRole("button", { name: /Show details for/ }).click();
        await candidate.getByRole("button", { name: /Keep monitoring/ }).click();
        await candidate
          .locator("textarea")
          .fill("E2E (synthetic): school-age vaccination syncope; monitor at the next screen.");
        await L.expectNewToast(evaluator, /Recorded: Monitor/, () =>
          candidate.getByRole("button", { name: /Record/ }).click(),
        );
        await candidate.getByText("Monitor", { exact: true }).first().waitFor({ timeout: 30000 });
      });
      await step("signal screen: peer sees the Monitor decision", async () => {
        await peer.reload({ waitUntil: "domcontentloaded" });
        const candidate = peer.locator("li[data-e2e-candidate]").first();
        await candidate.getByRole("button", { name: /Show details for/ }).click();
        await candidate.getByText("Decision recorded").waitFor({ timeout: 60000 });
        await candidate.getByText("Monitor", { exact: true }).first().waitFor();
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
