// Recording 1 — Review Officer: the 25-case coded demo through the line list,
// MedDRA terms, Fix, case decisions, Settings, then the LGA return's
// duplicates across files. Run right after reset-test-org.
const path = require("node:path");
const { recorder, L } = require("./rec.cjs");
const SEED = path.join(__dirname, "../../../scripts/seed/out");
const DEMO = path.join(SEED, "DEMO-ondo-aefi-line-list-25-cases.xlsx");
const LGA = path.join(SEED, "DEMO-ondo-aefi-lga-return-8-cases.xlsx");
const ONLY = process.env.ONLY || "";

async function main() {
  const browser = await L.launch();
  const r = await recorder(browser, "officer", "01-linelist");
  const p = r.page;
  const sidebar = (name) => p.getByRole("link", { name }).first();
  const upload = async (file, label) => {
    r.mark(`${label}: choose coded form`);
    await r.click(p.getByRole("combobox").first());
    await r.pause(600);
    await r.click(p.getByRole("option", { name: /Coded line list/ }));
    await r.pause(800);
    r.mark(`${label}: file chosen`);
    await L.expectNewToast(
      p,
      /File uploaded/,
      () => p.locator('input[type="file"]').setInputFiles(file),
      180000,
    );
    await p.getByRole("heading", { name: /Validation issues — / }).waitFor({ timeout: 120000 });
    r.mark(`${label}: uploaded`);
    await r.pause(1500);
    const rerun = p.getByRole("button", { name: /Re-run validation/ });
    await r.point(rerun);
    r.mark(`${label}: validation started`);
    await L.expectNewToast(p, /Validated/, () => rerun.click(), 300000);
    await p.waitForFunction(
      () => !document.body.innerText.includes("has not been validated yet"),
      null,
      { timeout: 120000 },
    );
    await L.waitNoLoading(p);
    r.mark(`${label}: validated`);
    await r.pause(2500);
  };

  try {
    await p.goto(`${L.BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await L.waitNoLoading(p);
    await r.moveTo(900, 500, 10);
    r.mark("dashboard");
    await r.pause(3500);
    await r.click(sidebar(/Line-list processing/));
    await p.getByRole("heading", { name: /^Line-list processing$/ }).waitFor();
    await L.waitNoLoading(p);
    r.mark("line-list page");
    await r.pause(3000);

    await upload(DEMO, "demo");

    // The file's own code list.
    const codes = p.getByText(/This file carries its own code list/).first();
    await r.reveal(codes);
    await r.point(codes);
    r.mark("code list");
    await r.pause(5000);

    // The issues found.
    r.mark("issues");
    await r.scroll(500, 2500);
    await r.pause(2500);
    await r.scroll(500, 2500);
    await r.pause(2500);

    // MedDRA: accept one on camera, the rest quickly.
    const use = p.getByRole("button", { name: "Use this term" });
    await use.first().waitFor({ timeout: 60000 });
    await r.reveal(use.first());
    await r.point(use.first().locator("xpath=ancestor::*[self::li or self::tr or self::div][1]"));
    r.mark("meddra suggestion");
    await r.pause(3500);
    await r.click(use.first());
    r.mark("meddra accepted");
    await p
      .getByText(/Coded as /)
      .first()
      .waitFor({ timeout: 30000 })
      .catch(() => {});
    await r.pause(3500);
    r.mark("meddra rest");
    for (let i = 0; i < 20 && (await use.count()); i++) {
      const n = await use.count();
      await use.first().scrollIntoViewIfNeeded();
      await use.first().click();
      await p
        .waitForFunction(
          (b) =>
            [...document.querySelectorAll("button")].filter(
              (x) => (x.textContent || "").trim() === "Use this term",
            ).length < b,
          n,
          { timeout: 60000 },
        )
        .catch(() => {});
      await r.pause(400);
    }
    r.mark("meddra done");
    await L.waitNoLoading(p);
    await r.pause(1500);

    // Fix.
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await r.pause(1200);
    const fix = p.getByRole("button", { name: /Fix Issues \(\d+\)/ });
    await fix.waitFor({ timeout: 60000 });
    await r.point(fix);
    r.mark("fix");
    await r.pause(2500);
    await L.expectNewToast(p, /corrected|Nothing Fix could|Fix failed/, () => fix.click(), 300000);
    await L.waitNoLoading(p);
    r.mark("fixed");
    await r.pause(3000);
    const changes = p.getByText(/Changes|changed|Undo/).first();
    if (await changes.count()) {
      await r.reveal(changes);
      r.mark("fix changes");
      await r.pause(5000);
    }

    // Hold a case, drop the duplicated EPID.
    const caseRows = (id) =>
      p
        .locator("tr")
        .filter({ has: p.getByRole("button", { name: "Decide this case" }) })
        .filter({ hasText: id });
    const hold = caseRows("ON/OWO/26/024").first();
    await r.reveal(hold);
    r.mark("hold");
    await r.click(hold.getByRole("button", { name: "Decide this case" }));
    await r.pause(900);
    await L.expectNewToast(p, /Case held/, () =>
      p.getByRole("menuitem", { name: "Step down" }).click(),
    );
    await r.pause(2500);
    const dup = caseRows("ON/OWE/26/014").nth(1);
    await r.reveal(dup);
    r.mark("drop duplicate");
    await r.click(dup.getByRole("button", { name: "Decide this case" }));
    await r.pause(700);
    await r.click(p.getByRole("menuitem", { name: "Drop…" }));
    const dialog = p.getByRole("dialog");
    await r.click(dialog.getByRole("radio", { name: "Duplicate" }));
    await r.type(dialog.getByRole("textbox"), "Same case entered twice (row 14).");
    await L.expectNewToast(p, /Case dropped/, () =>
      r.click(dialog.getByRole("button", { name: "Drop case" })),
    );
    r.mark("dropped");
    await r.pause(3000);

    // Settings: map the reporter designations this file used.
    await r.noToasts();
    await r.click(p.getByRole("button", { name: /Review Officer/ }).first());
    await r.pause(800);
    await r.click(p.getByRole("menuitem", { name: /Settings/ }));
    await p.locator("#reporter-designations").waitFor({ timeout: 60000 });
    await L.waitNoLoading(p);
    const des = p.locator("#reporter-designations");
    await r.reveal(des.getByText("Not configured").first(), 1800);
    r.mark("settings designations");
    await r.pause(3000);
    const codesFor = {
      "Pharm. Tech": /^3 /,
      "Nursing Sister": /^3 /,
      "RN/RM": /^3 /,
      SMO: /^1 /,
      "Mother of child": /^5 /,
      DSNO: /^3 /,
      LIO: /^3 /,
    };
    let first = true;
    for (const [name, code] of Object.entries(codesFor)) {
      const row = des
        .locator("div")
        .filter({ has: p.getByText(name, { exact: true }) })
        .filter({ has: p.getByRole("combobox") })
        .last();
      if (!(await row.count())) continue;
      if (first) r.mark("map designation");
      await r.click(row.getByRole("combobox"));
      await r.pause(first ? 900 : 300);
      await r.click(p.getByRole("option", { name: code }));
      await row
        .getByText("Configured", { exact: true })
        .waitFor({ timeout: 30000 })
        .catch(() => {});
      await r.pause(first ? 3000 : 700);
      first = false;
    }
    r.mark("designations done");
    await r.pause(2000);
    // The outcome code the file uses that E2B has no word for.
    const pick = p.getByRole("combobox", { name: "Outcome for Still on admission" });
    if (await pick.count()) {
      await r.reveal(pick, 1500);
      r.mark("map outcome");
      await r.click(pick);
      await r.pause(700);
      await r.click(p.getByRole("option", { name: /Not recovered/ }));
      const orow = pick.locator("xpath=ancestor::*[.//button[normalize-space()='Save']][1]");
      await L.expectNewToast(p, /Still on admission/, () =>
        r.click(orow.getByRole("button", { name: /^Save$/ })),
      );
      await r.pause(2500);
    }
    // Back to the line list: what blocked VigiFlow is now settled.
    await r.noToasts();
    await r.click(sidebar(/Line-list processing/));
    await p.getByRole("heading", { name: /^Line-list processing$/ }).waitFor();
    await L.waitNoLoading(p);
    const demoRow = p
      .locator("tr")
      .filter({ hasText: path.basename(DEMO) })
      .first();
    await r.click(demoRow.getByRole("button", { name: "Review issues" }));
    await L.waitNoLoading(p);
    await p
      .getByText(/Updating this line list/)
      .first()
      .waitFor({ state: "detached", timeout: 120000 })
      .catch(() => {});
    await r.reveal(p.getByText(/Validation issues — /).first(), 1500);
    r.mark("line list after settings");
    await r.pause(4500);

    // The LGA return: duplicates across two files.
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await r.pause(1500);
    await upload(LGA, "lga");
    const across = p.getByText("Possible duplicates in other files").first();
    await across.waitFor({ timeout: 90000 });
    await r.reveal(across, 1800);
    r.mark("duplicates across files");
    await r.pause(3000);
    await r.scroll(350, 2000);
    await r.pause(3000);
    const dropDup = p.getByRole("button", { name: /Drop row \d+ as duplicate/ }).first();
    await r.point(dropDup);
    await r.pause(1000);
    await L.expectNewToast(p, /dropped as a duplicate/, () => dropDup.click());
    r.mark("duplicate dropped");
    await r.pause(3500);
  } catch (e) {
    console.log("ERROR", e.message.split("\n")[0]);
    await p.screenshot({ path: path.join(__dirname, "out", "01-error.png") }).catch(() => {});
  } finally {
    await r.finish();
    await browser.close();
  }
}
main();
