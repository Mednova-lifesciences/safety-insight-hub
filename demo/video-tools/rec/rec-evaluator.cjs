// Recording 2 — Evaluator: batch MR-7712 quality flag and PMS referral,
// observed vs expected, and the signal screen. Runs after recording 1.
const path = require("node:path");
const { recorder, L } = require("./rec.cjs");
const CRYING = /Persistent cries|Crying/;

async function main() {
  const browser = await L.launch();
  const r = await recorder(browser, "evaluator", "02-evaluator");
  const p = r.page;
  const sidebar = (name) => p.getByRole("link", { name }).first();
  try {
    await p.goto(`${L.BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await p
      .getByRole("heading", { name: /Scientific review queue/ })
      .first()
      .waitFor({ timeout: 90000 });
    await L.waitNoLoading(p);
    await r.moveTo(900, 450, 10);
    r.mark("evaluator dashboard");
    await r.pause(3000);

    // Quality flag: batch MR-7712.
    const mr = p.locator("li[data-e2e-flag]").filter({ hasText: "Batch MR-7712" }).first();
    await mr.waitFor({ timeout: 90000 });
    await r.reveal(mr, 2000);
    await r.point(mr.getByText("Possible product quality concern", { exact: true }));
    r.mark("quality flag");
    await r.pause(4000);
    // A flag is one line until expanded.
    await r.click(mr.getByRole("button", { name: /Show details for Batch MR-7712/ }));
    await r.pause(1200);
    const warn = mr.getByText(/Lack of effect \/ vaccine failure/).first();
    if (await warn.count()) {
      await r.point(warn);
      r.mark("warning sign");
      await r.pause(3500);
    }
    if (!(await mr.getByText(/Referred to PMS/).count())) {
      r.mark("refer");
      await r.click(mr.getByRole("button", { name: "Refer to post-market surveillance" }));
      await r.type(
        mr.locator("textarea"),
        "3 serious cases at 3 facilities in one batch, one vaccine failure. Please sample and test.",
      );
      await r.pause(800);
      const dl = p.waitForEvent("download", { timeout: 60000 }).catch(() => null);
      await r.click(mr.getByRole("button", { name: "Record referral and download note" }));
      await dl;
      await mr.getByText(/Referred to PMS · PMS-\d{4}-\d{4}/).waitFor({ timeout: 60000 });
      r.mark("referred");
      await r.point(mr.getByText(/Referred to PMS · PMS-\d{4}-\d{4}/));
      await r.pause(4000);
    }

    // Observed vs expected.
    const pick = p.getByRole("combobox", { name: "Vaccine and event" });
    await r.reveal(pick, 1800);
    r.mark("observed vs expected");
    await r.click(pick);
    await r.pause(700);
    await r.click(p.getByRole("option", { name: /Febrile seizures/ }));
    await r.type(p.getByLabel("Doses administered"), "50000");
    await r.click(p.getByRole("button", { name: /Run check/ }));
    const result = p.getByText(/Observed\s*\d+\s*·\s*expected/).first();
    await result.waitFor({ timeout: 60000 });
    await r.point(result);
    r.mark("observed result");
    await r.pause(5000);

    // Signal screen.
    await r.noToasts();
    await r.click(sidebar(/Signal screening/));
    await p.getByRole("heading", { name: /^Signal screening$/ }).waitFor();
    await L.waitNoLoading(p);
    r.mark("signal screen");
    await r.pause(3500);
    const penta = p
      .locator("li[data-e2e-candidate]")
      .filter({ hasText: "Pentavalent" })
      .filter({ hasText: CRYING })
      .first();
    await penta.waitFor({ timeout: 90000 });
    await r.reveal(penta, 2000);
    r.mark("candidate");
    await r.pause(5000);
    await r.scroll(300, 1800);
    await r.pause(3000);
    if (!(await penta.getByText("Accepted as a signal", { exact: true }).count())) {
      r.mark("accept signal");
      await r.click(penta.getByRole("button", { name: /Accept as a signal/ }));
      await r.type(
        penta.locator("textarea"),
        "4 reports in one month across 3 facilities; for signal evaluation.",
      );
      await L.expectNewToast(p, /recorded/i, () =>
        r.click(penta.getByRole("button", { name: /^Record/ })),
      );
      await penta
        .getByText("Accepted as a signal", { exact: true })
        .first()
        .waitFor({ timeout: 30000 });
      r.mark("signal accepted");
      await r.pause(4000);
    }
  } catch (e) {
    console.log("ERROR", e.message.split("\n")[0]);
    await p.screenshot({ path: path.join(__dirname, "out", "02-error.png") }).catch(() => {});
  } finally {
    await r.finish();
    await browser.close();
  }
}
main();
