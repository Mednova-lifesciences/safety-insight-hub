/** Signs in as each admin role and lists the buttons on its pages — used
 *  to build and maintain the flow scripts. */
const { launch, newPage, signIn, openPage, shot, report } = require("./lib.cjs");

const PAGES = {
  officer: ["/dashboard", "/screening", "/line-list", "/e2b"],
  evaluator: ["/dashboard", "/psur"],
  peer: ["/dashboard", "/psur"],
};

(async () => {
  const browser = await launch();
  try {
    for (const [who, routes] of Object.entries(PAGES)) {
      const page = await newPage(browser, who);
      await signIn(page, who);
      for (const r of routes) {
        await openPage(page, r);
        await shot(page, `probe-${who}${r.replace(/\//g, "-")}`);
        const buttons = await page.getByRole("button").allInnerTexts();
        const tabs = await page.getByRole("tab").allInnerTexts();
        console.log(
          `\n[${who}] ${r}\n  buttons: ${[...new Set(buttons.map((b) => b.trim()).filter(Boolean))].join(" | ")}\n  tabs: ${tabs.join(" | ")}`,
        );
      }
      await page.context().close();
    }
  } finally {
    report();
    await browser.close();
  }
})();
