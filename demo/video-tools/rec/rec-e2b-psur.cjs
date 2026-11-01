// Recording 3 — Review Officer: E2B(R3) for the demo file (C.1.7, VigiFlow
// preflight, XML), PSUR upload and AI screening with the signed outcome,
// and the AI data log. Recording 4 — Evaluator: the PSUR's AI scientific
// review. Runs after recordings 1 and 2.
const path = require("node:path");
const { recorder, L } = require("./rec.cjs");
const DEMO = "DEMO-ondo-aefi-line-list-25-cases.xlsx";
const PDF = path.join(__dirname, "../../../sample-psur-complete.pdf");
const ONLY = process.env.ONLY || "";

async function officer(browser) {
  const r = await recorder(browser, "officer", process.env.REC_NAME || "03-e2b-psur");
  const p = r.page;
  const sidebar = (name) => p.getByRole("link", { name }).first();
  try {
    await p.goto(`${L.BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await L.waitNoLoading(p);
    await r.moveTo(800, 450, 10);
    await r.pause(1500);
    if (!ONLY || ONLY.includes("e2b")) {
      await r.click(sidebar(/E2B\(R3\) preparation/));
      await p.getByRole("heading", { name: /E2B/ }).first().waitFor();
      await L.waitNoLoading(p);
      r.mark("e2b page");
      await r.pause(3000);
      const card = p
        .locator("li")
        .filter({ hasText: DEMO })
        .filter({ has: p.getByRole("button", { name: /Run VigiFlow preflight/ }) })
        .last();
      await card.waitFor({ timeout: 60000 });
      await r.reveal(card, 1800);
      const pre = card.getByRole("button", { name: /Run VigiFlow preflight/ });
      r.mark("preflight");
      await r.click(pre);
      await p
        .waitForFunction(() => !document.body.innerText.includes("Running preflight"), null, {
          timeout: 180000,
        })
        .catch(() => {});
      await L.waitNoLoading(p);
      await r.pause(2500);
      r.mark("preflight result");
      await r.reveal(card, 1500);
      await r.pause(4000);
      const accept = card.getByRole("button", { name: /Accept the recommendations/ }).first();
      await accept.waitFor({ timeout: 30000 }).catch(() => {});
      if (await accept.count()) {
        await r.reveal(accept, 1500);
        r.mark("c17");
        await r.pause(3000);
        await r.click(accept);
        const dialog = p.getByRole("alertdialog");
        await r.type(
          dialog.locator("textarea"),
          "Reviewed: the rule's C.1.7 recommendations are correct for these cases.",
        );
        await L.expectNewToast(p, /C\.1\.7 finalized/, () =>
          r.click(dialog.getByRole("button", { name: "Accept and finalize" })),
        );
        r.mark("c17 finalized");
        await r.pause(3000);
        await p
          .waitForFunction(
            () =>
              [...document.querySelectorAll("button")].some(
                (b) => /Run VigiFlow preflight/.test(b.textContent || "") && !b.disabled,
              ),
            null,
            { timeout: 60000 },
          )
          .catch(() => {});
        await r.reveal(card, 1200);
        await r.click(card.getByRole("button", { name: /Run VigiFlow preflight/ }));
        await card
          .getByText(/^(READY_FOR_VALIDATED_IMPORT|EXPORTABLE WITH OVERRIDE.*)$/)
          .first()
          .waitFor({ timeout: 180000 })
          .catch(() => {});
        await L.waitNoLoading(p);
        r.mark("preflight again");
        await r.pause(3500);
      }
      const xml = card.getByRole("button", { name: /Download validated E2B\(R3\) XML/ }).first();
      if ((await xml.count()) && (await xml.isEnabled())) {
        await r.reveal(xml, 1200);
        r.mark("xml");
        const dl = p.waitForEvent("download", { timeout: 60000 }).catch(() => null);
        await r.click(xml);
        await dl;
        r.mark("xml downloaded");
        await r.pause(3500);
      } else {
        r.mark("xml not enabled");
        await r.pause(2000);
      }
    }

    if (!ONLY || ONLY.includes("psur")) {
      await r.noToasts();
      await r.click(sidebar(/Report screening/));
      await p.getByRole("heading", { name: /^Report screening$/ }).waitFor();
      await L.waitNoLoading(p);
      r.mark("screening page");
      await r.pause(3000);
      r.mark("psur upload");
      await L.expectNewToast(
        p,
        /Received\. The screening checklist|Could not receive/,
        () => p.getByLabel("Choose a PSUR/PBRER file").setInputFiles(PDF),
        420000,
      );
      await p.getByText("B. Screening checks").first().waitFor({ timeout: 60000 });
      await L.waitNoLoading(p);
      r.mark("psur screened");
      await r.pause(2500);
      await r.reveal(p.getByText("B. Screening checks").first(), 1800);
      r.mark("checklist");
      await r.pause(3000);
      await r.scroll(600, 3000);
      await r.pause(2500);
      await r.scroll(600, 3000);
      await r.pause(2500);
      const concl = p.locator("#screening-conclusions");
      await r.reveal(concl, 2000);
      r.mark("outcome");
      await r.type(concl, "Administratively complete. Proceed to scientific assessment.");
      await r.type(p.locator("#screening-officer"), "Review Officer");
      await r.click(p.getByRole("button", { name: /Proceed to scientific review/ }));
      await r.pause(800);
      await r.type(p.locator('input[type="password"]').last(), process.env.TEST_PASSWORD);
      await r.click(p.getByRole("button", { name: /Confirm — proceed to scientific review/ }));
      await p
        .getByText("Sent to the evaluators for scientific review.")
        .waitFor({ timeout: 120000 });
      r.mark("signed");
      await r.pause(3500);
    }

    if (!ONLY || ONLY.includes("log")) {
      await r.noToasts();
      await r.click(sidebar(/AI data log/));
      await p.getByRole("heading", { name: /^AI data log$/ }).waitFor();
      await L.waitNoLoading(p);
      r.mark("ai log");
      await r.pause(3500);
      await r.scroll(400, 2500);
      await r.pause(3000);
    }
  } catch (e) {
    console.log("ERROR", e.message.split("\n")[0]);
    await p.screenshot({ path: path.join(__dirname, "out", "03-error.png") }).catch(() => {});
  } finally {
    await r.finish();
  }
}

async function evaluator(browser) {
  const r = await recorder(browser, "evaluator", "04-psur-review");
  const p = r.page;
  try {
    await p.goto(`${L.BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await L.waitNoLoading(p);
    await r.moveTo(800, 450, 10);
    await r.pause(1500);
    await r.click(p.getByRole("link", { name: /PSUR \/ PBRER scientific review/ }).first());
    await p
      .getByRole("heading", { name: /PSUR \/ PBRER review/ })
      .first()
      .waitFor();
    await L.waitNoLoading(p);
    r.mark("psur list");
    await r.pause(3000);
    const row = p
      .locator("tr, li, div[role='button']")
      .filter({ hasText: "sample-psur-complete" })
      .first();
    await row.waitFor({ timeout: 90000 });
    const open = row.getByRole("button", { name: /Open review|Open|View/ }).first();
    r.mark("open psur");
    const target = (await open.count()) ? open : row;
    await L.expectNewToast(
      p,
      /AI scientific review (completed|could not be completed)/,
      () => r.click(target),
      900000,
    );
    await L.waitNoLoading(p, 120000);
    r.mark("ai review done");
    await r.pause(2500);
    const real = p.getByRole("button", { name: /Yes, it's a real gap/ }).first();
    if (await real.count()) {
      const finding = real.locator("xpath=ancestor::li[1]");
      await r.reveal(finding, 2000);
      r.mark("finding");
      await r.pause(5000);
      await L.expectNewToast(p, /Accepted as a real gap/, () => r.click(real));
      r.mark("finding accepted");
      await r.pause(3500);
    }
    await r.scroll(500, 3000);
    await r.pause(3000);
  } catch (e) {
    console.log("ERROR", e.message.split("\n")[0]);
    await p.screenshot({ path: path.join(__dirname, "out", "04-error.png") }).catch(() => {});
  } finally {
    await r.finish();
  }
}

(async () => {
  const browser = await L.launch();
  try {
    if (!process.env.SKIP_OFFICER) await officer(browser);
    if (!process.env.SKIP_EVALUATOR) await evaluator(browser);
  } finally {
    await browser.close();
  }
})();
