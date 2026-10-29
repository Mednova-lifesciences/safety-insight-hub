/**
 * Line list → E2B, as the Review Officer, on synthetic seed file A (and B
 * when FILE_B=1): upload, mapping, validate, Fix, Undo/Re-apply,
 * Keep/Drop/Hold, the three downloads, then VigiFlow preflight, C.1.7 and
 * the XML export on /e2b.
 *
 *   PW_DIR=… CHROME_PATH=… OUT_DIR=… node e2e/flow-linelist.cjs
 */
const path = require("node:path");
const L = require("./lib.cjs");

const SEED = path.join(__dirname, "..", "scripts", "seed", "out");
const FILE_A = path.join(SEED, "TEST-facility-return-A.xlsx");
const FILE_B = path.join(SEED, "TEST-state-return-B.csv");

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
    throw e;
  }
}

async function uploadFile(page, file) {
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Generic line list/ }).click();
  await L.expectNewToast(
    page,
    /File uploaded/,
    () => page.locator('input[type="file"]').setInputFiles(file),
    180000,
  );
  // The new job is opened: its issues section names the file.
  await page
    .getByRole("heading", {
      name: new RegExp(`Validation issues — ${path.basename(file).replace(/[.]/g, "\\.")}`),
    })
    .waitFor({ timeout: 120000 });
}

async function main() {
  const browser = await L.launch();
  const page = await L.session(browser, "officer");
  try {
    if (process.env.SKIP_LL !== "1") {
      await step("open /line-list", () =>
        L.nav(page, "Line-list processing", /^Line-list processing$/),
      );
      await step("upload A", () => uploadFile(page, FILE_A));
      await L.shot(page, "ll-uploaded");

      await step("column mapping shown", async () => {
        await page
          .getByText(/Column in file/)
          .first()
          .waitFor({ timeout: 60000 });
      });

      await step("validate", async () => {
        await L.expectNewToast(
          page,
          /Validated/,
          () => page.getByRole("button", { name: /Re-run validation/ }).click(),
          300000,
        );
        await L.waitNoLoading(page);
      });
      await L.shot(page, "ll-validated");

      const fixBtn = page.getByRole("button", { name: /Fix Issues \(\d+\)/ });
      if (await fixBtn.count()) {
        await step("fix issues", () =>
          L.expectNewToast(
            page,
            /corrected|Nothing Fix could|Fix failed/,
            () => fixBtn.click(),
            300000,
          ),
        );
        await L.shot(page, "ll-fixed");
        const undo = page.getByRole("button", { name: /^Undo$/ }).first();
        await undo.waitFor({ timeout: 30000 }).catch(() => {});
        if (await undo.count()) {
          await step("undo a change", () =>
            L.expectNewToast(page, /Change undone/, () => undo.click()),
          );
          await step("re-apply it", () =>
            L.expectNewToast(page, /Change re-applied/, () =>
              page
                .getByRole("button", { name: /^Re-apply$/ })
                .first()
                .click(),
            ),
          );
        } else console.log("  (no change to undo)");
      } else console.log("  (no Fix button: nothing fixable)");

      await step("drop a case", async () => {
        await page.getByRole("button", { name: "Decide this case" }).nth(0).click();
        await page.getByRole("menuitem", { name: "Drop…" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("radio", { name: "Not an AEFI" }).click();
        await dialog.getByRole("textbox").fill("E2E test: synthetic case dropped as not an AEFI.");
        await L.expectNewToast(page, /Case dropped/, () =>
          dialog.getByRole("button", { name: "Drop case" }).click(),
        );
      });
      await step("hold a case", async () => {
        // A different case, found by its ID: positions shift as cases move
        // between the kept and decided groups.
        const row = page.locator("tr").filter({ hasText: "TST-A-007" }).first();
        await row.getByRole("button", { name: "Decide this case" }).click();
        await L.expectNewToast(page, /Case held/, () =>
          page.getByRole("menuitem", { name: "Step down" }).click(),
        );
      });
      // A held case moves under the "not counted" divider, so it is found by
      // its pill rather than by position.
      const heldRow = () =>
        page
          .locator("tr")
          .filter({ has: page.getByText("Held", { exact: true }) })
          .first();
      await step("keep it again", async () => {
        await heldRow().getByRole("button", { name: "Decide this case" }).click();
        await L.expectNewToast(page, /returned to Keep/, () =>
          page.getByRole("menuitem", { name: "Keep" }).click(),
        );
      });
      await step("hold it once more", async () => {
        await page.keyboard.press("Escape");
        await page
          .locator("[data-radix-popper-content-wrapper]")
          .waitFor({ state: "detached", timeout: 10000 })
          .catch(() => {});
        await page.getByRole("button", { name: "Decide this case" }).nth(1).click();
        await L.expectNewToast(page, /Case held/, () =>
          page.getByRole("menuitem", { name: "Step down" }).click(),
        );
      });

      await step("download fixed CSV", () =>
        L.download(
          page,
          () => page.getByRole("button", { name: /Download Fixed CSV/ }).click(),
          "fixed-A.csv",
        ),
      );
      await step("download dropped & held", () =>
        L.download(
          page,
          () => page.getByRole("button", { name: /Download dropped/ }).click(),
          "dropped-held-A.csv",
        ),
      );
      await step("download executive summary", () =>
        L.download(page, () => page.getByRole("button", { name: /Executive Summary/ }).click()),
      );

      if (process.env.FILE_B === "1") {
        await step("upload B", () => uploadFile(page, FILE_B));
        await step("validate B", () =>
          L.expectNewToast(
            page,
            /Validated/,
            () => page.getByRole("button", { name: /Re-run validation/ }).click(),
            300000,
          ),
        );
      }
    }

    // ---- E2B ----
    await step("open /e2b", () => L.nav(page, "E2B(R3) preparation", /E2B/));
    await L.shot(page, "e2b-open");
    await step("VigiFlow preflight", async () => {
      const card = page
        .locator("div")
        .filter({ hasText: /TEST-facility-return-A\.xlsx/ })
        .filter({
          has: page.getByRole("button", { name: /Run VigiFlow preflight/ }),
        })
        .last();
      await card.getByRole("button", { name: /Run VigiFlow preflight/ }).click();
      await page
        .getByText(
          /READY_FOR_VALIDATED_IMPORT|NOT_READY|case\(s\) (pass|ready|blocked)|Preflight (passed|failed|complete)/i,
        )
        .first()
        .waitFor({ timeout: 180000 });
      await L.waitNoLoading(page);
    });
    await L.shot(page, "e2b-preflight");
    const accept = page.getByRole("button", { name: /Accept the recommendations/ }).first();
    if (await accept.count()) {
      await step("finalize C.1.7 as recommended", async () => {
        await accept.click();
        const dialog = page.getByRole("alertdialog");
        await dialog
          .locator("textarea")
          .fill("E2E (synthetic): the rule's C.1.7 recommendation is accepted.");
        await L.expectNewToast(page, /C\.1\.7 finalized/, () =>
          dialog.getByRole("button", { name: "Accept and finalize" }).click(),
        );
      });
    } else console.log("  (no C.1.7 recommendations pending)");
    const override = page.getByRole("button", { name: /Override & Export Anyway/ }).first();
    if (await override.count()) {
      await step("record export override", async () => {
        await override.click();
        const dialog = page.getByRole("alertdialog");
        await dialog
          .locator("textarea")
          .fill("E2E (synthetic): export the includable cases for the test run.");
        await dialog.getByRole("button", { name: "Record override" }).click();
        await dialog.waitFor({ state: "detached", timeout: 60000 }).catch(() => {});
      });
    }
    await step("download E2B(R3) XML", () =>
      L.download(page, () =>
        page
          .getByRole("button", { name: /Download validated E2B\(R3\) XML/ })
          .first()
          .click(),
      ),
    );
    console.log("E2B buttons after preflight:", (await L.buttons(page)).join(" | "));
    console.log("E2B headings:", (await page.getByRole("heading").allInnerTexts()).join(" | "));
  } catch (e) {
    await L.shot(page, "ll-failure");
    console.log("BUTTONS NOW:", (await L.buttons(page).catch(() => [])).join(" | "));
  } finally {
    L.report({ flow: "linelist", steps });
    await browser.close();
  }
}

main();
