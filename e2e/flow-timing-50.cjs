/**
 * Times one 50-case line list end to end, as the Review Officer, on the
 * synthetic sample-linelist-50-cases.csv: upload, column mapping, validate,
 * Fix (when anything is fixable), and the fixed-CSV download. Then checks
 * the stored job against the file — 50 cases, the same case IDs in order —
 * so the timing is of a correct read, not just a fast one.
 *
 *   PW_DIR=… CHROME_PATH=… OUT_DIR=… TEST_PASSWORD=… SUPABASE_URL=…
 *   SUPABASE_SERVICE_ROLE_KEY=… node e2e/flow-timing-50.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");

const FILE = path.join(__dirname, "..", "sample-linelist-50-cases.csv");
const steps = [];
const times = {};
async function step(name, fn) {
  console.log(`▶ ${name}`);
  const t0 = Date.now();
  try {
    const out = await fn();
    times[name] = Date.now() - t0;
    console.log(`  ⏱ ${name}: ${times[name]} ms`);
    steps.push({ name, ok: true, ms: times[name] });
    return out;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message.split("\n")[0]}`);
    steps.push({ name, ok: false, error: e.message.split("\n")[0] });
    throw e;
  }
}

/** The case IDs in the file, in order (first column after the title line). */
function fileCaseIds() {
  const lines = fs.readFileSync(FILE, "utf8").trim().split(/\r?\n/).slice(2);
  return lines.map((l) => l.split(",")[0]);
}

async function storedCaseIds(filename) {
  const url = process.env.SUPABASE_URL.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const orgs = await (
    await fetch(`${url}/rest/v1/organizations?slug=eq.mednova-test-a&select=id`, { headers })
  ).json();
  const jobs = await (
    await fetch(
      `${url}/rest/v1/pv_linelist_jobs?organization_id=eq.${orgs[0].id}&data->>filename=eq.${encodeURIComponent(filename)}&select=created_at,rows:data->parsedRows&order=created_at.desc&limit=1`,
      { headers },
    )
  ).json();
  return (jobs[0]?.rows ?? []).map((r) => r.case_id);
}

async function main() {
  const browser = await L.launch();
  const t0 = Date.now();
  try {
    const page = await L.session(browser, "officer");
    await step("open /line-list", () =>
      L.nav(page, "Line-list processing", /^Line-list processing$/),
    );
    await step("upload 50 cases", async () => {
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /Generic line list/ }).click();
      await L.expectNewToast(
        page,
        /File uploaded/,
        () => page.locator('input[type="file"]').setInputFiles(FILE),
        180000,
      );
      await page
        .getByRole("heading", { name: /Validation issues — sample-linelist-50-cases\.csv/ })
        .waitFor({ timeout: 120000 });
    });
    await step("column mapping shown", () =>
      page
        .getByText(/Column in file/)
        .first()
        .waitFor({ timeout: 60000 }),
    );
    await step("validate 50 cases", async () => {
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
    });
    const fixBtn = page.getByRole("button", { name: /Fix Issues \(\d+\)/ });
    await fixBtn.waitFor({ timeout: 15000 }).catch(() => {});
    if (await fixBtn.count()) {
      const label = await fixBtn.first().innerText();
      console.log(`  fixable: ${label}`);
      await step("fix issues", () =>
        L.expectNewToast(
          page,
          /corrected|Nothing Fix could|Fix failed/,
          () => fixBtn.click(),
          300000,
        ),
      );
    } else console.log("  (nothing fixable)");
    await step("download fixed CSV", () =>
      L.download(page, () => page.getByRole("button", { name: /Download Fixed CSV/ }).click()),
    );
    times.total = Date.now() - t0;
    console.log(`  ⏱ total (sign-in to fixed CSV): ${times.total} ms`);

    const want = fileCaseIds();
    const got = await storedCaseIds("sample-linelist-50-cases.csv");
    console.log(`  cases in file: ${want.length}, stored: ${got.length}`);
    if (want.length !== 50) throw new Error(`the sample file has ${want.length} cases, not 50`);
    if (JSON.stringify(got) !== JSON.stringify(want))
      throw new Error("the stored case IDs differ from the file's");
    console.log("  accuracy: all 50 case IDs stored, in the file's order");
    await L.shot(page, "timing-50-validated");
  } finally {
    L.report({ flow: "timing-50", steps, times });
    await browser.close();
  }
}

main();
