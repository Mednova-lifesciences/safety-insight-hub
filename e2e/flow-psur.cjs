/**
 * PSUR / PBRER end to end, on the synthetic sample PSUR:
 *   Review Officer — upload on /screening, the 16-item checklist, Proceed to
 *     scientific review (password);
 *   Evaluator — open on /psur, wait for the AI scientific review, work a
 *     finding, save Sections 9–12, Section 13 conclusion, sign (password);
 *   Peer Reviewer — countersign (password);
 *   downloads — V4 report, assessment memo, executive summary, MAH feedback
 *     letter, and the screening directive/letter from /screening.
 */
const path = require("node:path");
const L = require("./lib.cjs");

const PDF = path.join(__dirname, "..", "sample-psur-complete.pdf");
const PASSWORD = process.env.TEST_PASSWORD;

const steps = [];
async function step(name, fn, { critical = true } = {}) {
  console.log(`▶ ${name}`);
  try {
    const out = await L.timed(name, fn);
    steps.push({ name, ok: true });
    return out;
  } catch (e) {
    steps.push({ name, ok: false, error: e.message.split("\n")[0] });
    console.log(`  ✗ ${name}: ${e.message.split("\n")[0]}`);
    if (critical) throw e;
    return undefined;
  }
}

async function confirmPassword(page, confirmLabel) {
  await page.locator('input[type="password"]').last().fill(PASSWORD);
  await page.getByRole("button", { name: confirmLabel }).click();
}

async function openDoc(page, filename) {
  // The document list: open the newest row for this file.
  const row = page.locator("tr, li, div[role='button']").filter({ hasText: filename }).first();
  await row.waitFor({ timeout: 90000 });
  const open = row.getByRole("button", { name: /Open review|Open|View/ }).first();
  if (await open.count()) await open.click();
  else await row.click();
}

async function main() {
  const browser = await L.launch();
  const filename = path.basename(PDF);
  try {
    const fromPeer = process.env.START === "peer";
    // ---- Review Officer ----
    const officer = await L.session(browser, "officer");
    if (!fromPeer) {
      await step("open /screening", () => L.nav(officer, "Report screening", /^Report screening$/));
      await step("upload PSUR + AI screening", async () => {
        await L.expectNewToast(
          officer,
          /Received\. The screening checklist|Could not receive/,
          () => officer.locator('input[type="file"]').setInputFiles(PDF),
          420000,
        );
        await officer.getByText("B. Screening checks").first().waitFor({ timeout: 60000 });
      });
      await L.shot(officer, "psur-checklist");
      await step(
        "16 checks shown",
        async () => {
          const n = await officer.locator("text=/^\\s*(1[0-6]|[1-9])\\.\\s/").count();
          console.log(`  numbered items visible: ${n}`);
        },
        { critical: false },
      );
      await step(
        "save checklist",
        () =>
          L.expectNewToast(officer, /saved|Saved/, () =>
            officer.getByRole("button", { name: /Save checklist/ }).click(),
          ),
        { critical: false },
      );
      await step("record outcome: proceed (signed)", async () => {
        await officer
          .locator("#screening-conclusions")
          .fill("E2E (synthetic): administratively complete; proceed to scientific assessment.");
        await officer.locator("#screening-officer").fill("TEST Review Officer");
        await officer.getByRole("button", { name: /Proceed to scientific review/ }).click();
        await confirmPassword(officer, /Confirm — proceed to scientific review/);
        await officer
          .getByText("Sent to the evaluators for scientific review.")
          .waitFor({ timeout: 120000 });
      });

      // ---- Evaluator ----
      const evaluator = await L.session(browser, "evaluator");
      await step("open /psur", () =>
        L.nav(evaluator, "PSUR / PBRER scientific review", /PSUR \/ PBRER review/),
      );
      await step("open the report + AI scientific review", async () => {
        await L.expectNewToast(
          evaluator,
          /AI scientific review (completed|could not be completed)/,
          () => openDoc(evaluator, filename.replace(/\.pdf$/, "")),
          900000,
        );
        const failed = await evaluator
          .getByText(/AI scientific review could not be completed/)
          .count();
        if (failed) throw new Error("AI scientific review could not be completed");
        await L.waitNoLoading(evaluator, 120000);
      });
      await L.shot(evaluator, "psur-evaluator");
      console.log("EVALUATOR buttons:", (await L.buttons(evaluator)).slice(0, 60).join(" | "));
      const acceptBtn = () =>
        evaluator.getByRole("button", { name: /Yes, it's a real gap/ }).first();
      await step("AI review returned findings", async () => {
        await acceptBtn().waitFor({ timeout: 60000 });
        const n = await evaluator.getByRole("button", { name: /Yes, it's a real gap/ }).count();
        console.log(`  findings awaiting a decision: ${n}`);
        if (n < 2) throw new Error(`expected at least 2 findings to decide, saw ${n}`);
      });
      await step("dismiss a finding", async () => {
        await evaluator
          .getByRole("button", { name: /No, dismiss it/ })
          .last()
          .click();
        await evaluator
          .getByLabel("Reason for dismissing")
          .fill("E2E (synthetic): covered elsewhere in the PSUR.");
        await L.expectNewToast(evaluator, /Dismissed\./, () =>
          evaluator.getByRole("button", { name: /^Dismiss$/ }).click(),
        );
      });
      // Run Full Fix only writes what the report itself supports: a missing
      // section with no source facts stays unresolved, with its reason. So
      // accept a finding the report CAN answer — the benefit-risk narrative
      // that should be a table — and, beside it, one more that may not be.
      await step("accept a finding", async () => {
        const tableGap = evaluator
          .locator("li")
          .filter({ hasText: /narrative rather than|evidence-and-uncertainty table/ })
          .filter({ has: evaluator.getByRole("button", { name: /Yes, it's a real gap/ }) })
          .last();
        const target = (await tableGap.count())
          ? tableGap.getByRole("button", { name: /Yes, it's a real gap/ })
          : acceptBtn();
        await L.expectNewToast(evaluator, /Accepted as a real gap/, () => target.click());
      });
      await step("Run Full Fix resolves accepted findings", async () => {
        const fix = evaluator.getByRole("button", { name: /Run Full Fix \(\d+\)/ }).first();
        await fix.waitFor({ timeout: 30000 });
        await L.expectNewToast(
          evaluator,
          /finding\(s\) resolved|AI fix unavailable|Run Full Fix failed/,
          () => fix.click(),
          300000,
        );
        const toast = (await evaluator.locator("[data-sonner-toast]").allInnerTexts()).join(" ");
        console.log(`  Run Full Fix: ${toast.slice(0, 160)}`);
        if (/AI fix unavailable|Run Full Fix failed/.test(toast))
          throw new Error(`Run Full Fix did not run: ${toast.slice(0, 120)}`);
        // Every accepted finding must come back with an outcome: resolved
        // from the report's own content, or left unresolved WITH a reason.
        // It may not invent what the report lacks, so "0 resolved" is a
        // correct answer for a gap the submission cannot fill.
        const resolved = Number(toast.match(/(\d+) finding\(s\) resolved/)?.[1] ?? 0);
        const unresolved = Number(toast.match(/(\d+) left unresolved/)?.[1] ?? 0);
        if (resolved + unresolved < 1)
          throw new Error("Run Full Fix returned no outcome for the accepted finding");
        await L.waitNoLoading(evaluator);
      });
      for (const label of [
        /Save special populations/,
        /Save benefit-risk assessment/,
        /Save uncertainties/,
      ]) {
        await step(
          `save ${label.source}`,
          () =>
            L.expectNewToast(
              evaluator,
              /saved|Saved/,
              () => evaluator.getByRole("button", { name: label }).first().click(),
              60000,
            ),
          { critical: false },
        );
      }
      await step("assessment memo inputs (evaluator)", async () => {
        // "Generate memo" opens the memo (the AI drafts it); its Word
        // download appears once the draft is there.
        const open = evaluator.getByRole("button", { name: /^(Generate memo|Show memo)$/ });
        if (await open.count()) await open.first().click();
        // The memo is generated only from what a person confirms: reference,
        // signatory, at least one reaction in the matrix, efficacy band,
        // verdict and conclusion.
        const memo = evaluator.locator("#assessment-memo");
        await memo.getByLabel("Reference number").fill("TEST/001");
        await memo.getByLabel(/^Signatory \(printed/).fill("TEST Director (PV)");
        if (!(await memo.getByLabel("Adverse reaction 1").count()))
          await memo.getByRole("button", { name: /Add adverse reaction column/ }).click();
        await memo.getByLabel("Adverse reaction 1").fill("Diarrhoea");
        await memo.getByLabel("Efficacy band").fill("Medium");
        await memo.getByLabel("Benefit-risk verdict").fill("Positive Benefit-Risk Balance");
        await memo
          .getByLabel("Conclusion")
          .fill("E2E (synthetic): positive benefit-risk balance; routine pharmacovigilance.");
        await evaluator.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some(
              (b) => /Generate memo \(Word\)/.test(b.textContent || "") && !b.disabled,
            ),
          null,
          { timeout: 60000 },
        );
        // The memo autosaves; let the save land before the report is locked.
        await evaluator.waitForTimeout(5000);
      });
      await step("section 13 + evaluator sign-off", async () => {
        const s13 = evaluator.locator("#v4-S13_CONCLUSION_SIGNOFF");
        await s13.scrollIntoViewIfNeeded();
        await s13
          .locator("textarea")
          .first()
          .fill("E2E (synthetic): benefit-risk remains favourable; routine pharmacovigilance.");
        await s13.locator("input").first().fill("TEST Evaluator");
        await s13.getByRole("button", { name: /Sign off and submit for peer review/ }).click();
        await confirmPassword(evaluator, /^Sign off and submit$/);
        // A signed report leaves the evaluator's desk: confirm it by its new stage.
        await evaluator
          .getByText(
            /Signed \d{4}-\d{2}-\d{2}|Awaiting peer review|Evaluated, awaiting peer review/i,
          )
          .first()
          .waitFor({ timeout: 120000 });
      });
    }

    // ---- Peer Reviewer ----
    const peer = await L.session(browser, "peer");
    await step("peer: open the report", async () => {
      await L.nav(peer, "PSUR / PBRER scientific review", /PSUR \/ PBRER review/);
      await openDoc(peer, filename.replace(/\.pdf$/, ""));
      await peer.locator("#v4-S13_CONCLUSION_SIGNOFF").waitFor({ timeout: 120000 });
    });
    await step("peer: countersign", async () => {
      const s13 = peer.locator("#v4-S13_CONCLUSION_SIGNOFF");
      await s13.scrollIntoViewIfNeeded();
      if (await s13.getByText(/signed off by both the evaluator and the peer reviewer/).count()) {
        console.log("  (already countersigned)");
        return;
      }
      await s13.locator("input").nth(1).fill("TEST Peer Reviewer");
      await s13.getByRole("button", { name: /Countersign and complete/ }).click();
      await confirmPassword(peer, /^Countersign and complete$/);
      await s13
        .getByText(/signed off by both the evaluator and the peer reviewer/)
        .waitFor({ timeout: 120000 });
    });
    await L.shot(peer, "psur-countersigned");

    // ---- Downloads ----
    await step(
      "download V4 report",
      () =>
        L.download(peer, () =>
          peer
            .getByRole("button", { name: /Generate V4 Evaluation Report/ })
            .first()
            .click(),
        ),
      { critical: false },
    );
    await step(
      "download executive summary",
      () =>
        L.download(peer, () =>
          peer
            .getByRole("button", { name: /Download Executive Summary \(Word\)/ })
            .first()
            .click(),
        ),
      { critical: false },
    );
    await step(
      "download MAH feedback letter",
      () =>
        L.download(peer, () =>
          peer
            .getByRole("button", { name: /Download MAH Feedback Letter \(Word\)/ })
            .first()
            .click(),
        ),
      { critical: false },
    );
    await step(
      "download assessment memo",
      async () => {
        const open = peer.getByRole("button", { name: /^(Generate memo|Show memo)$/ });
        if (await open.count()) await open.first().click();
        await peer.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some(
              (b) => /Generate memo \(Word\)/.test(b.textContent || "") && !b.disabled,
            ),
          null,
          { timeout: 60000 },
        );
        await L.download(peer, () =>
          peer
            .getByRole("button", { name: /Generate memo \(Word\)/ })
            .first()
            .click(),
        );
      },
      { critical: false },
    );
    await step(
      "download screening letter (officer)",
      async () => {
        // The officer's tab has sat on this page since screening, and the
        // list it shows predates the peer review that adds the letter. A
        // person coming back refocuses the tab, which refreshes the list; a
        // headless background tab never regains focus, so reload it.
        await officer.reload({ waitUntil: "domcontentloaded" });
        await L.nav(officer, "Report screening", /^Report screening$/);
        // The report's own row in "Already screened": a bordered row with
        // its own "View checklist" button.
        const row = officer
          .locator("div.rounded-md.border")
          .filter({ has: officer.getByRole("button", { name: "View checklist" }) })
          .filter({ hasText: filename.replace(/\.pdf$/, "") })
          .filter({
            has: officer.getByRole("button", {
              name: /(Screening Directive|MAH Feedback Letter) \(Word\)/,
            }),
          })
          .first();
        await L.download(officer, () =>
          row
            .getByRole("button", { name: /(Screening Directive|MAH Feedback Letter) \(Word\)/ })
            .click(),
        );
      },
      { critical: false },
    );
  } catch (e) {
    console.log("FLOW STOPPED:", e.message.split("\n")[0]);
  } finally {
    L.report({ flow: "psur", steps });
    await browser.close();
  }
}

main();
