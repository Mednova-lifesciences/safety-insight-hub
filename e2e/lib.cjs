/**
 * Shared helpers for the live end-to-end runs (headed Playwright).
 *
 * Playwright is not a project dependency: point PW_DIR at a folder where
 * `npm i playwright` has been run. BASE_URL picks the deployment
 * (production by default, or a Vercel preview URL).
 *
 * Every run signs in as the TEST organisation's accounts, which hold
 * synthetic data only. Never point these at a real organisation's users.
 */
const path = require("node:path");
const fs = require("node:fs");

const PW_DIR = process.env.PW_DIR;
if (!PW_DIR) throw new Error("Set PW_DIR to a folder with playwright installed.");
const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));

const BASE_URL = (process.env.BASE_URL || "https://pv-assist.mednovalife.com").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), "e2e-out");
fs.mkdirSync(OUT_DIR, { recursive: true });

// The test accounts' password is never written in the repo.
const TEST_PASSWORD = process.env.TEST_PASSWORD;
if (!TEST_PASSWORD) throw new Error("Set TEST_PASSWORD (the synthetic test accounts' password).");
const ACCOUNTS = {
  officer: "test.officer@test.mednovalife.com",
  evaluator: "test.evaluator@test.mednovalife.com",
  peer: "test.peer@test.mednovalife.com",
  coordinator: "test.coordinator@test.mednovalife.com",
  manager: "test.manager@test.mednovalife.com",
  field: "test.field@test.mednovalife.com",
  orgB: "test.b.evaluator@test.mednovalife.com",
};
const ADMIN_ROLES = new Set(["officer", "evaluator", "peer", "orgB"]);

const timings = [];
const consoleErrors = [];

async function launch() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS === "1",
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    slowMo: Number(process.env.SLOWMO || 60),
  });
  return browser;
}

const statePath = (who) => path.join(OUT_DIR, `session-${who}.json`);
/** A saved session is reused only while its access token is surely still
 *  valid: an older one would have to refresh, and a refresh token another
 *  run already rotated is refused (seen as a 401 and a bounce to sign-in). */
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const freshState = (who) =>
  fs.existsSync(statePath(who)) &&
  Date.now() - fs.statSync(statePath(who)).mtimeMs < SESSION_MAX_AGE_MS;

async function newPage(browser, label, who) {
  const cached = who && freshState(who) ? statePath(who) : undefined;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    ...(cached ? { storageState: cached } : {}),
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(60000);
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ label, url: page.url(), text: msg.text() });
  });
  page.on("pageerror", (err) => consoleErrors.push({ label, url: page.url(), text: String(err) }));
  return page;
}

/** Time one step and keep it for the timing report. */
async function timed(name, fn) {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - t0;
    timings.push({ name, ms });
    console.log(`  ⏱ ${name}: ${ms} ms`);
  }
}

/** A signed-in page for this role: reuses the saved session when it is
 *  still accepted, otherwise signs in and saves it. */
async function session(browser, who) {
  const page = await newPage(browser, who, who);
  if (freshState(who)) {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    const ok = await page
      .locator("h1")
      .first()
      .waitFor({ timeout: 45000 })
      .then(() => !/sign-in|\/auth$/.test(new URL(page.url()).pathname))
      .catch(() => false);
    if (ok) return page;
  }
  await signIn(page, who);
  await page.context().storageState({ path: statePath(who) });
  return page;
}

/** In-app navigation through the sidebar, the way a person moves around. */
async function nav(page, linkText, headingRe) {
  return timed(`nav ${linkText}`, async () => {
    await page.getByRole("link", { name: linkText }).first().click();
    await page.getByRole("heading", { name: headingRe }).first().waitFor({ timeout: 90000 });
    await waitNoLoading(page);
  });
}

/** Visible button labels — for working out what to click next. */
async function buttons(page) {
  const all = await page.getByRole("button").allInnerTexts();
  return [...new Set(all.map((b) => b.trim().replace(/\s+/g, " ")).filter(Boolean))];
}

async function signIn(page, who) {
  const email = ACCOUNTS[who];
  const admin = ADMIN_ROLES.has(who);
  await timed(`sign-in ${who}`, async () => {
    await page.goto(`${BASE_URL}${admin ? "/admin/sign-in" : "/auth"}`, {
      waitUntil: "domcontentloaded",
    });
    const emailBox = admin
      ? page.locator("#admin-email")
      : page.locator('input[type="email"]').first();
    const pwBox = admin
      ? page.locator("#admin-password")
      : page.locator('input[type="password"]').first();
    await emailBox.fill(email);
    await pwBox.fill(TEST_PASSWORD);
    await page
      .getByRole("button", { name: /sign in/i })
      .first()
      .click();
    // The Render backend can be cold: its first sign-in takes ~20-60 s.
    await page.waitForURL((u) => !/sign-in|\/auth$/.test(u.pathname), {
      timeout: 120000,
      waitUntil: "commit",
    });
  });
}

/** Page load: navigate and wait until no "Loading" placeholder is left. */
async function openPage(page, route, readyText) {
  return timed(`load ${route}`, async () => {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
    if (readyText) await page.getByText(readyText).first().waitFor({ timeout: 60000 });
    await waitNoLoading(page);
  });
}

async function waitNoLoading(page, timeout = 90000) {
  await page
    .waitForFunction(
      () => !/Loading…|Loading\.\.\.|Analysing document…/.test(document.body.innerText),
      null,
      { timeout },
    )
    .catch(() => {});
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

/** Count matching toasts, run the action, then wait for a NEW one. */
/** Run the action, then wait for a toast matching `re` that was NOT on
 *  screen before it. Toasts already showing are marked first — counting
 *  them was wrong whenever an older toast faded out during the action. */
async function expectNewToast(page, re, action, timeout = 120000) {
  await page.evaluate(() => {
    for (const t of document.querySelectorAll("[data-sonner-toast]"))
      t.setAttribute("data-e2e-seen", "1");
  });
  await action();
  await page.waitForFunction(
    ({ src, flags }) => {
      const r = new RegExp(src, flags);
      return [...document.querySelectorAll("[data-sonner-toast]:not([data-e2e-seen])")].some((t) =>
        r.test(t.textContent || ""),
      );
    },
    { src: re.source, flags: re.flags },
    { timeout },
  );
}

async function download(page, action, name) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), action()]);
  const target = path.join(OUT_DIR, name || dl.suggestedFilename());
  await dl.saveAs(target);
  const size = fs.statSync(target).size;
  console.log(`  ⬇ ${path.basename(target)} (${size} bytes)`);
  if (size === 0) throw new Error(`Empty download: ${target}`);
  return target;
}

function report(extra = {}) {
  const file = path.join(OUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ baseUrl: BASE_URL, timings, consoleErrors, ...extra }, null, 2),
  );
  console.log(`\nReport: ${file}`);
  console.log(`Console errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 20))
    console.log(`  [${e.label}] ${e.url} :: ${e.text.slice(0, 200)}`);
  return file;
}

module.exports = {
  BASE_URL,
  OUT_DIR,
  ACCOUNTS,
  launch,
  newPage,
  session,
  nav,
  buttons,
  timed,
  signIn,
  openPage,
  waitNoLoading,
  shot,
  expectNewToast,
  download,
  report,
  timings,
  consoleErrors,
};
