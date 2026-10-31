/**
 * The coded line lists (reactions, serious code and outcome written as the
 * form's codes, explained by the legend under the table — the format of
 * real state AEFI returns), through every line-list feature:
 *   - Review Officer: upload the 25-case demo with the coded form, validate;
 *     the file's own code list is read, no reaction is left undecoded,
 *     MedDRA suggestions are offered and one is accepted, the unmapped
 *     reporter designations are listed in Settings, Fix corrects what it
 *     can, a case is held and a duplicated EPID dropped, the fixed CSV
 *     downloads; then the 8-case LGA return, whose 4 repeated cases are
 *     found as duplicates across the two files;
 *   - Evaluator: batch MR-7712 flagged with its vaccine failure as a warning
 *     sign and referred to post-market surveillance; observed vs expected
 *     counts the coded febrile seizure after MR; the signal screen shows
 *     Pentavalent × persistent crying, which is accepted as a signal.
 * Runs after the other flows (it adds a candidate and observed cases they
 * do not expect); reset-test-org clears it, and the demo's term and
 * designation choices, at the start of the next run.
 */
const path = require("node:path");
const L = require("./lib.cjs");

const SEED = path.join(__dirname, "..", "scripts", "seed", "out");
const DEMO = path.join(SEED, "DEMO-ondo-aefi-line-list-25-cases.xlsx");
const LGA = path.join(SEED, "DEMO-ondo-aefi-lga-return-8-cases.xlsx");

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

async function uploadCoded(page, file) {
  await L.nav(page, "Line-list processing", /^Line-list processing$/);
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Coded line list/ }).click();
  await L.expectNewToast(
    page,
    /File uploaded/,
    () => page.locator('input[type="file"]').setInputFiles(file),
    180000,
  );
  await page
    .getByRole("heading", {
      name: new RegExp(`Validation issues — ${path.basename(file).replace(/[.]/g, "\\.")}`),
    })
    .waitFor({ timeout: 120000 });
  await L.expectNewToast(
    page,
    /Validated/,
    () => page.getByRole("button", { name: /Re-run validation/ }).click(),
    300000,
  );
  await page.waitForFunction(
    () => !document.body.innerText.includes("has not been validated yet"),
    null,
    { timeout: 120000 },
  );
  await L.waitNoLoading(page);
}

async function main() {
  const browser = await L.launch();
  try {
    // ---- Review Officer: the 25-case coded demo ----
    const officer = await L.session(browser, "officer");
    await step("coded: upload and validate the 25-case demo", () => uploadCoded(officer, DEMO));
    await L.shot(officer, "coded-validated");

    await step("coded: the file's own code list is read", async () => {
      await officer
        .getByText(/This file carries its own code list/)
        .first()
        .waitFor({ timeout: 30000 });
      const text = await officer
        .getByText(/This file carries its own code list/)
        .first()
        .innerText();
      console.log(`  ${text.trim().slice(0, 120)}`);
      if (!/\(13\)/.test(text)) throw new Error(`expected 13 reaction codes: ${text}`);
      if (await officer.getByText(/cannot be decoded/).count())
        throw new Error("a reaction code was left undecoded");
    });

    await step("coded: MedDRA suggestions offered, one accepted", async () => {
      const use = officer.getByRole("button", { name: "Use this term" });
      await use.first().waitFor({ timeout: 60000 });
      const n = await use.count();
      console.log(`  suggestions to accept: ${n}`);
      if (n < 5) throw new Error(`expected at least 5 MedDRA suggestions, saw ${n}`);
      await use.first().scrollIntoViewIfNeeded();
      await use.first().click();
      await officer.waitForFunction(
        (before) =>
          [...document.querySelectorAll("button")].filter(
            (b) => (b.textContent || "").trim() === "Use this term",
          ).length < before,
        n,
        { timeout: 60000 },
      );
    });

    await step("coded: unmapped designations listed in Settings", async () => {
      await officer.goto(`${L.BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
      const section = officer.locator("#reporter-designations");
      await section.waitFor({ timeout: 60000 });
      for (const d of ["Nursing Sister", "RN/RM", "SMO", "Pharm. Tech", "Mother of child"]) {
        const row = section.locator("tr, li, div").filter({ hasText: d }).last();
        await row.waitFor({ timeout: 30000 });
        if (!(await row.getByText("Not configured").count()))
          throw new Error(`"${d}" is not shown as Not configured`);
      }
    });

    await L.nav(officer, "Line-list processing", /^Line-list processing$/);
    await officer
      .locator("tr")
      .filter({ hasText: path.basename(DEMO) })
      .first()
      .getByRole("button", { name: "Review issues" })
      .click();
    await L.waitNoLoading(officer);

    const fixBtn = officer.getByRole("button", { name: /Fix Issues \(\d+\)/ });
    const fixable = async () => {
      const label = (await fixBtn.count()) ? await fixBtn.first().innerText() : "";
      return Number(label.match(/\((\d+)\)/)?.[1] ?? 0);
    };
    await step("coded: Fix corrects the fixable issues", async () => {
      await fixBtn.waitFor({ timeout: 60000 });
      const before = await fixable();
      console.log(`  fixable before Fix: ${before}`);
      if (before < 3) throw new Error(`expected at least 3 fixable issues, saw ${before}`);
      await L.expectNewToast(
        officer,
        /corrected|Nothing Fix could|Fix failed/,
        () => fixBtn.click(),
        300000,
      );
      if (await officer.getByText(/Fix failed/).count()) throw new Error("Fix failed");
      await L.waitNoLoading(officer);
      await officer.waitForTimeout(2000);
      const after = await fixable();
      console.log(`  fixable after Fix: ${after}`);
      if (after >= before) throw new Error(`Fix corrected nothing (${before} → ${after})`);
    });

    // Decisions go through a case's own row; the duplicated EPID has two.
    const settle = async () => {
      await officer.keyboard.press("Escape");
      await officer
        .locator("[role=dialog], [role=menu]")
        .first()
        .waitFor({ state: "detached", timeout: 15000 })
        .catch(() => {});
      await officer.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    };
    const caseRows = (id) =>
      officer
        .locator("tr")
        .filter({ has: officer.getByRole("button", { name: "Decide this case" }) })
        .filter({ hasText: id });
    const openMenu = async (row) => {
      await settle();
      for (let attempt = 1; attempt <= 3; attempt++) {
        await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
        const btn = row.getByRole("button", { name: "Decide this case" });
        await btn.click({ timeout: 15000 }).catch(async () => {
          await btn.focus();
          await officer.keyboard.press("Enter");
        });
        if (
          await officer
            .getByRole("menuitem")
            .first()
            .waitFor({ timeout: 5000 })
            .then(() => true)
            .catch(() => false)
        )
          return;
        await officer.waitForTimeout(2000);
      }
      throw new Error("the decision menu would not stay open");
    };
    await step("coded: hold the anaphylaxis with no seriousness or onset", async () => {
      const row = caseRows("ON/OWO/26/024").first();
      await openMenu(row);
      await L.expectNewToast(officer, /Case held/, () =>
        officer.getByRole("menuitem", { name: "Step down" }).click(),
      );
      await row.getByText("Held", { exact: true }).waitFor({ timeout: 60000 });
    });
    await step("coded: drop the EPID entered twice", async () => {
      const rows = caseRows("ON/OWE/26/014");
      if ((await rows.count()) < 2) throw new Error("expected two rows for ON/OWE/26/014");
      const second = rows.nth(1);
      await openMenu(second);
      await officer.getByRole("menuitem", { name: "Drop…" }).click();
      const dialog = officer.getByRole("dialog");
      await dialog.getByRole("radio", { name: "Duplicate" }).click();
      await dialog.getByRole("textbox").fill("E2E demo: the same case entered twice (row 14).");
      await L.expectNewToast(officer, /Case dropped/, () =>
        dialog.getByRole("button", { name: "Drop case" }).click(),
      );
      await caseRows("ON/OWE/26/014")
        .getByText("Dropped", { exact: true })
        .first()
        .waitFor({ timeout: 60000 });
    });
    await step("coded: download the fixed CSV", () =>
      L.download(
        officer,
        () => officer.getByRole("button", { name: /Download Fixed CSV/ }).click(),
        "fixed-demo-25.csv",
      ),
    );

    // ---- The LGA return: duplicates across two coded files ----
    await step("coded: upload and validate the 8-case LGA return", () => uploadCoded(officer, LGA));
    await step("coded: the 4 repeated cases found across the two files", async () => {
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
      if (n !== 4) throw new Error(`expected 4 duplicate pairs, saw ${n}`);
      await L.shot(officer, "coded-duplicates");
    });
    await step("coded: drop one as a duplicate", async () => {
      await L.expectNewToast(officer, /dropped as a duplicate/, () =>
        officer
          .getByRole("button", { name: /Drop row \d+ as duplicate/ })
          .first()
          .click(),
      );
      await officer.waitForFunction(
        () =>
          [...document.querySelectorAll("button")].filter((b) =>
            /Drop row \d+ as duplicate/.test(b.textContent || ""),
          ).length === 3,
        null,
        { timeout: 60000 },
      );
    });

    // ---- Evaluator: flags, referral, observed vs expected, signal screen ----
    const evaluator = await L.session(browser, "evaluator");
    const mr = () =>
      evaluator.locator("li[data-e2e-flag]").filter({ hasText: "Batch MR-7712" }).first();
    await step("coded: batch MR-7712 flagged with its vaccine failure", async () => {
      await L.nav(evaluator, "Dashboard", /Scientific review queue/);
      await mr().waitFor({ timeout: 60000 });
      await mr().getByText("Possible product quality concern", { exact: true }).waitFor();
      await mr()
        .getByText(/Lack of effect \/ vaccine failure/)
        .waitFor();
      await L.shot(evaluator, "coded-flag");
    });
    await step("coded: refer MR-7712 to post-market surveillance", async () => {
      await mr().getByRole("button", { name: "Refer to post-market surveillance" }).click();
      await mr()
        .locator("textarea")
        .fill("E2E demo: 3 serious cases at 3 facilities, one vaccine failure.");
      await L.download(
        evaluator,
        () => mr().getByRole("button", { name: "Record referral and download note" }).click(),
        "referral-MR-7712.docx",
      );
      await mr()
        .getByText(/Referred to PMS · PMS-\d{4}-\d{4}/)
        .waitFor({ timeout: 60000 });
    });
    await step("coded: observed vs expected counts the coded febrile seizure", async () => {
      await L.nav(evaluator, "Dashboard", /Scientific review queue/);
      const card = evaluator
        .locator("section, div")
        .filter({
          has: evaluator.getByText("Observed vs expected (screening check)", { exact: true }),
        })
        .last();
      await card.scrollIntoViewIfNeeded();
      await card.getByRole("combobox").first().click();
      await evaluator.getByRole("option", { name: /Febrile seizures/ }).click();
      await evaluator.getByLabel("Doses administered").fill("50000");
      await evaluator.getByRole("button", { name: /Run check/ }).click();
      const result = evaluator.getByText(/Observed\s*\d+\s*·\s*expected/).first();
      await result.waitFor({ timeout: 60000 });
      const text = await result.innerText();
      console.log(`  ${text.trim()}`);
      if (/Observed\s*0\s*·/.test(text))
        throw new Error("the coded febrile seizure was not counted");
    });
    await step("coded: signal screen shows Pentavalent × persistent crying", async () => {
      await L.nav(evaluator, "Signal screening", /^Signal screening$/);
      const penta = evaluator
        .locator("li[data-e2e-candidate]")
        .filter({ hasText: "Pentavalent" })
        .filter({ hasText: "Persistent cries" })
        .first();
      await penta.waitFor({ timeout: 60000 });
      await penta
        .getByText(/DEMO-ondo-aefi-line-list-25-cases\.xlsx/)
        .first()
        .waitFor();
      await L.shot(evaluator, "coded-signal");
    });
    await step("coded: accept it as a signal", async () => {
      const penta = evaluator
        .locator("li[data-e2e-candidate]")
        .filter({ hasText: "Pentavalent" })
        .filter({ hasText: "Persistent cries" })
        .first();
      await penta.getByRole("button", { name: /Accept as a signal/ }).click();
      await penta
        .locator("textarea")
        .fill("E2E demo: 4 reports in one month across 3 facilities; for signal evaluation.");
      await L.expectNewToast(evaluator, /recorded/i, () =>
        penta.getByRole("button", { name: /^Record/ }).click(),
      );
      await penta
        .getByText("Accepted as a signal", { exact: true })
        .first()
        .waitFor({ timeout: 30000 });
    });
  } finally {
    L.report({ flow: "coded", steps });
    await browser.close();
  }
  if (steps.some((s) => !s.ok)) process.exitCode = 1;
}

main();
