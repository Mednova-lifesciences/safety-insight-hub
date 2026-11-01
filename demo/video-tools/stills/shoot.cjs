const path = require("node:path");
const { chromium } = require(path.join(process.env.PW_DIR, "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch({
    args: ["--disable-gpu"],
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const { pathToFileURL } = require("node:url");
  const url = (f) => pathToFileURL(path.join(__dirname, f)).href;
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(url("cards.html"));
  await p.waitForTimeout(400);
  await p.screenshot({ path: "title.png" });
  await p.goto(url("cards.html") + "#close");
  await p.reload();
  await p.waitForTimeout(400);
  await p.screenshot({ path: "close.png" });
  for (const n of ["plain", "marked"]) {
    await p.goto(url(`sheet-${n}.html`));
    await p.waitForTimeout(300);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    await p.setViewportSize({ width: Math.max(1920, w + 10), height: 1080 });
    await p.screenshot({ path: `sheet-${n}.png`, fullPage: true });
    console.log(n, "width", w);
    await p.setViewportSize({ width: 1920, height: 1080 });
  }
  await b.close();
})();
