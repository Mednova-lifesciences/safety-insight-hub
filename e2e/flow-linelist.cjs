/**
 * Line list → E2B, as the Review Officer, on synthetic seed file A (and B
 * when FILE_B=1, and C — the signal-screen and quality-flag file — when
 * FILE_C=1): upload, mapping, validate, Fix, Undo/Re-apply,
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
const FILE_C = path.join(SEED, "TEST-surveillance-return-C.csv");

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
        // The issues are re-read just after the toast: wait until the panel
        // no longer says the file is unvalidated, or the Fix button would be
        // looked for before it can exist.
        await page.waitForFunction(
          () => !document.body.innerText.includes("has not been validated yet"),
          null,
          { timeout: 120000 },
        );
        await L.waitNoLoading(page);
      });
      await L.shot(page, "ll-validated");

      const fixBtn = page.getByRole("button", { name: /Fix Issues \(\d+\)/ });
      await fixBtn.waitFor({ timeout: 20000 }).catch(() => {});
      if (await fixBtn.count()) {
        const fixable = async () => {
          const label = (await fixBtn.count()) ? await fixBtn.first().innerText() : "";
          return Number(label.match(/\((\d+)\)/)?.[1] ?? 0);
        };
        const before = await fixable();
        console.log(`  fixable before Fix: ${before}`);
        await step("fix issues", async () => {
          await L.expectNewToast(
            page,
            /corrected|Nothing Fix could|Fix failed/,
            () => fixBtn.click(),
            300000,
          );
          if (await page.getByText(/Fix failed/).count()) throw new Error("Fix failed");
          await L.waitNoLoading(page);
          await page.waitForTimeout(2000);
          const after = await fixable();
          console.log(`  fixable after Fix: ${after}`);
          if (after >= before) throw new Error(`Fix corrected nothing (${before} → ${after})`);
        });
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

      // Every decision goes through the case's own row, found by its ID:
      // positions shift as cases move between the kept and decided groups.
      // A dialog or menu still closing blocks clicks, so wait for none first.
      const settle = async () => {
        await page.keyboard.press("Escape");
        await page
          .locator("[role=dialog], [role=menu]")
          .first()
          .waitFor({ state: "detached", timeout: 15000 })
          .catch(() => {});
      };
      const caseRow = (id) => page.locator("tr").filter({ hasText: id }).first();
      const openMenu = async (id) => {
        await settle();
        // Centre the row first: scrolled only just into view it can sit
        // under the sticky top bar, which then takes the click.
        await caseRow(id).evaluate((el) => el.scrollIntoView({ block: "center" }));
        await caseRow(id).getByRole("button", { name: "Decide this case" }).click();
      };
      const pill = (id, text) =>
        caseRow(id).getByText(text, { exact: true }).waitFor({ timeout: 60000 });

      await step("drop a case", async () => {
        await openMenu("TST-A-012");
        await page.getByRole("menuitem", { name: "Drop…" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("radio", { name: "Not an AEFI" }).click();
        await dialog.getByRole("textbox").fill("E2E test: synthetic case dropped as not an AEFI.");
        await L.expectNewToast(page, /Case dropped/, () =>
          dialog.getByRole("button", { name: "Drop case" }).click(),
        );
        await pill("TST-A-012", "Dropped");
      });
      await step("hold a case", async () => {
        await openMenu("TST-A-011");
        await L.expectNewToast(page, /Case held/, () =>
          page.getByRole("menuitem", { name: "Step down" }).click(),
        );
        await pill("TST-A-011", "Held");
      });
      await step("keep it again", async () => {
        await openMenu("TST-A-011");
        await L.expectNewToast(page, /returned to Keep/, () =>
          page.getByRole("menuitem", { name: "Keep" }).click(),
        );
        await pill("TST-A-011", "Keep");
      });
      await step("hold another case", async () => {
        await openMenu("TST-A-007");
        await L.expectNewToast(page, /Case held/, () =>
          page.getByRole("menuitem", { name: "Step down" }).click(),
        );
        await pill("TST-A-007", "Held");
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
      if (process.env.FILE_C === "1") {
        await step("upload C", () => uploadFile(page, FILE_C));
        await step("validate C", () =>
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
    // The job card whose preflight was run (tagged in the step below).
    const jobCard = () =>
      page.locator("li").filter({ has: page.locator('button[data-e2e-preflight="1"]') });
    await step("VigiFlow preflight", async () => {
      // The closest card around the file name that has its own preflight
      // button — not an outer block holding every job's card.
      // Each preflight button belongs to the nearest block that names one
      // file: tag the one whose block names file A, then click it.
      // A seed file that is ready (an enabled preflight button): B when it
      // was uploaded — A still has one case waiting for a MedDRA term
      // choice, which blocks VigiFlow until a person makes it.
      const tagged = await page.evaluate(
        (files) => {
          for (const file of files)
            for (const b of document.querySelectorAll("button")) {
              if (!/Run VigiFlow preflight/.test(b.textContent || "") || b.disabled) continue;
              // Each job is one list item on the page.
              const el = b.closest("li");
              if (el && (el.textContent || "").includes(file)) {
                b.setAttribute("data-e2e-preflight", "1");
                return true;
              }
            }
          return false;
        },
        ["TEST-state-return-B.csv", "TEST-facility-return-A.xlsx"],
      );
      if (!tagged) throw new Error("no seed file is ready for VigiFlow preflight");
      await page.locator('button[data-e2e-preflight="1"]').click();
      // Preflight is done when this job's card offers its XML download.
      await jobCard()
        .getByRole("button", { name: /Download validated E2B\(R3\) XML/ })
        .waitFor({ timeout: 180000 });
      await L.waitNoLoading(page);
    });
    await L.shot(page, "e2b-preflight");
    // The C.1.7 panel loads a moment after preflight; when the rule has
    // recommendations, a person accepts them with a rationale.
    const accept = jobCard()
      .getByRole("button", { name: /Accept the recommendations/ })
      .first();
    await accept.waitFor({ timeout: 30000 }).catch(() => {});
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
      await step("VigiFlow preflight again", async () => {
        // The page refreshes itself after the C.1.7 decisions; run preflight
        // once that has settled, and wait for this card's new verdict.
        const btn = page.locator('button[data-e2e-preflight="1"]');
        await page.waitForTimeout(3000);
        await btn.waitFor({ state: "visible" });
        await page.waitForFunction(
          () => !document.querySelector('button[data-e2e-preflight="1"]')?.hasAttribute("disabled"),
          null,
          { timeout: 60000 },
        );
        await btn.click();
        await jobCard()
          .getByText(/^(READY_FOR_VALIDATED_IMPORT|EXPORTABLE WITH OVERRIDE.*)$/)
          .first()
          .waitFor({ timeout: 180000 });
      });
    } else console.log("  (no C.1.7 recommendations pending)");
    await step("XML download enabled", async () => {
      const ok = await page
        .waitForFunction(
          () => {
            const b = [...document.querySelectorAll("li")]
              .find((li) => li.querySelector('button[data-e2e-preflight="1"]'))
              ?.querySelectorAll("button");
            return [...(b ?? [])].some(
              (x) => /Download validated E2B\(R3\) XML/.test(x.textContent || "") && !x.disabled,
            );
          },
          null,
          { timeout: 60000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!ok) {
        const override = jobCard()
          .getByRole("button", { name: /Override & Export Anyway/ })
          .first();
        if (!(await override.count())) throw new Error("XML download stayed disabled");
        await override.click();
        const dialog = page.getByRole("alertdialog");
        await dialog
          .locator("textarea")
          .fill("E2E (synthetic): export the includable cases for the test run.");
        await dialog.getByRole("button", { name: "Record override" }).click();
      }
    });
    await step("download E2B(R3) XML", () =>
      L.download(page, () =>
        jobCard()
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
