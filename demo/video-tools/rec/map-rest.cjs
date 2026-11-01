// Maps the demo files' remaining reporter designations in Settings (every
// page), as a Review Officer would. Test organisation only; not recorded.
const { L } = require("./rec.cjs");
const CODES = {
  "Pharm. Tech": /^3 /,
  "Nursing Sister": /^3 /,
  "RN/RM": /^3 /,
  SMO: /^1 /,
  "Mother of child": /^5 /,
  DSNO: /^3 /,
  LIO: /^3 /,
  Matron: /^3 /,
  Pharm: /^2 /,
  "Patient's mother": /^5 /,
  CHEW: /^3 /,
  "Community volunteer": /^5 /,
  Consumer: /^5 /,
  Doctor: /^1 /,
};
(async () => {
  const browser = await L.launch();
  const p = await L.session(browser, "officer");
  await p.goto(`${L.BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
  const des = p.locator("#reporter-designations");
  await des.waitFor({ timeout: 60000 });
  await L.waitNoLoading(p);
  for (let page = 1; page <= 4; page++) {
    for (const [name, code] of Object.entries(CODES)) {
      const row = des
        .locator("div")
        .filter({ has: p.getByText(name, { exact: true }) })
        .filter({ has: p.getByRole("combobox") })
        .last();
      if (!(await row.count()) || !(await row.getByText("Not configured", { exact: true }).count()))
        continue;
      await row.getByRole("combobox").click();
      await p.getByRole("option", { name: code }).click();
      await row
        .getByText("Configured", { exact: true })
        .waitFor({ timeout: 30000 })
        .catch(() => {});
      console.log(`  mapped ${name}`);
      await p.waitForTimeout(800);
    }
    const next = des.getByRole("button", { name: "Next" });
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
    await p.waitForTimeout(1000);
  }
  const left = await des.getByText("Not configured", { exact: true }).count();
  console.log(`  still not configured on the last page: ${left}`);
  await browser.close();
})();
