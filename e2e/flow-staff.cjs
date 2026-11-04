/**
 * The staff journey, field associate → coordinator → manager, in the TEST
 * organisation (synthetic data only):
 *   Field associate: New ICSR for a catalog product with channel and branch;
 *     a product not in the catalog; the public QR/link route /r/<org>.
 *   Coordinator: triage, seriousness decision, MedDRA coding (generate,
 *     accept, Choose another term), narrative drafted from the case data,
 *     follow-up request, NAFDAC clock and channel shown, the unlisted
 *     product forwarded to its holder (recorded only — no email is sent),
 *     case advanced to Regulatory ready.
 *   Manager: closes the case (password), PSUR calendar → draft → refresh →
 *     pre-submission check → working Word export, monthly report (Word),
 *     and every manager page loads without an error screen.
 * Reset the test org afterwards: node scripts/seed/reset-test-org.mjs
 */
const L = require("./lib.cjs");

const ORG_SLUG = process.env.TEST_ORG_SLUG || "mednova-test-a";
const RUN = `E2E-STAFF-${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);

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
    return undefined;
  }
}

async function pickOption(page, triggerId, name) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name }).first().click();
}

async function errorScreen(page) {
  const text = await page.locator("body").innerText();
  if (/Something went wrong|Application error|Unexpected error/i.test(text))
    throw new Error(`error screen on ${new URL(page.url()).pathname}`);
  return text;
}

/** Fills the parts of the ICSR form every report needs; returns the case id. */
async function fillAndSubmit(page, { patient, reaction, channel = true, unlisted }) {
  if (channel) {
    await pickOption(page, "intakeChannel", "Branch / store");
    await page.locator("#branch").fill("Lekki Phase 1");
  }
  await page.locator("#reporterName").fill("E2E Reporter");
  await pickOption(page, "reporterQual", "Pharmacist");
  await page.locator("#reporterCountry").fill("Nigeria");
  await page.locator("#patientId").fill(patient);
  await page.locator("#patientAge").fill("34");
  await pickOption(page, "patientSex", "Female");
  if (unlisted) {
    await page.locator("#productName").fill(unlisted.name);
    if (await page.locator("#productHolder").count())
      await page.locator("#productHolder").fill(unlisted.holder);
  }
  await page.locator("#productDose").fill("500 mg");
  await page.locator("#productIndication").fill("headache");
  await page.locator("#therapyStart").fill("2026-10-28");
  await page.locator("#productBatch").fill(`${RUN}-B1`);
  await page.locator("#reactionTerm").fill(reaction);
  await page.locator("#onsetDate").fill("2026-10-29");
  await pickOption(page, "outcome", "Recovered/resolved");
  let caseId;
  await L.expectNewToast(page, /Case \S+ created|report has been sent|Thank you/i, async () => {
    await page.getByRole("button", { name: /Submit ICSR/ }).click();
  });
  const toast = await page.locator("[data-sonner-toast]").last().innerText();
  caseId = (toast.match(/Case (\S+) created/) || [])[1];
  return caseId;
}

async function openCase(page, caseId) {
  await L.openPage(page, `/cases/${encodeURIComponent(caseId)}`);
  await page.getByRole("heading", { name: caseId }).first().waitFor();
}

async function advance(page, to) {
  await L.expectNewToast(page, new RegExp(`Case moved to ${to}`), () =>
    page.getByRole("button", { name: `Advance to ${to}` }).click(),
  );
}

async function main() {
  const browser = await L.launch();
  const found = {};
  try {
    // ---------------- Field associate ----------------
    const field = await L.session(browser, "field");

    found.caseA = await step("field: New ICSR, catalog product, branch channel", async () => {
      await L.openPage(field, "/icsr/new");
      await field.getByPlaceholder("Search drugs…").waitFor();
      const first = field.locator("button:has(p.font-medium)").first();
      found.product = (await first.locator("p.font-medium").innerText()).trim();
      await first.click();
      const id = await fillAndSubmit(field, { patient: `${RUN}-A`, reaction: "Rash" });
      if (!id) throw new Error("no case id in the confirmation");
      console.log(`  case A ${id} (${found.product})`);
      return id;
    });

    found.caseB = await step("field: product not in the drug catalog", async () => {
      await L.openPage(field, "/icsr/new");
      await field.getByRole("button", { name: "Report a product not in the list" }).click();
      await field.getByText("This product is not in the company drug list").waitFor();
      const id = await fillAndSubmit(field, {
        patient: `${RUN}-B`,
        reaction: "Dizziness",
        unlisted: { name: `TEST Unlisted Brand 250 mg ${RUN}`, holder: "Test Holder Ltd" },
      });
      if (!id) throw new Error("no case id in the confirmation");
      console.log(`  case B ${id}`);
      return id;
    });

    await step("public QR/link route reports anonymously with the branch", async () => {
      const pub = await L.newPage(browser, "public");
      await pub.goto(`${L.BASE_URL}/r/${ORG_SLUG}?branch=${encodeURIComponent("Lekki Phase 1")}`, {
        waitUntil: "domcontentloaded",
      });
      await pub.getByRole("button", { name: /Report a medicine not in the list/ }).click();
      await pub
        .getByText(/Branch \/ store — Lekki Phase 1/)
        .first()
        .waitFor();
      await fillAndSubmit(pub, {
        patient: `${RUN}-PUB`,
        reaction: "Nausea",
        channel: false,
        unlisted: { name: `TEST QR Brand ${RUN}`, holder: "Test Holder Ltd" },
      });
      await L.shot(pub, "staff-public-submitted");
      await pub.context().close();
    });

    // ---------------- Coordinator ----------------
    const coord = await L.session(browser, "coordinator");

    if (found.caseA) {
      await step("coordinator: case shows channel, branch and NAFDAC clock", async () => {
        await openCase(coord, found.caseA);
        const text = await errorScreen(coord);
        if (!text.includes("Channel: Branch / store — Lekki Phase 1"))
          throw new Error("channel/branch not shown");
        if (!/NAFDAC/i.test(text)) throw new Error("no NAFDAC clock");
        await L.shot(coord, "staff-case-header");
      });

      await step("coordinator: triage and seriousness decision", async () => {
        await advance(coord, "Triage");
        await coord.getByRole("tab", { name: "Seriousness" }).click();
        const run = coord.getByRole("button", { name: "Run analysis" });
        if (await run.count()) await run.click();
        await coord.getByRole("button", { name: "Accept reported classification" }).click();
        await coord
          .locator("#ser-rationale")
          .fill(`${RUN}: reported classification matches the source.`);
        await L.expectNewToast(coord, /recorded|saved|decision/i, () =>
          coord.getByRole("button", { name: /^Record accept reported classification/ }).click(),
        );
      });

      await step("coordinator: MedDRA coding — generate, choose another term, accept", async () => {
        await advance(coord, "Coding");
        await coord.getByRole("tab", { name: "Coding" }).click();
        const gen = coord.getByRole("button", { name: /Generate coding candidates/ });
        if (await gen.count())
          await L.expectNewToast(coord, /candidate|No dictionary/i, () => gen.click());
        await coord
          .getByRole("button", { name: /Choose another term for Rash/i })
          .first()
          .click();
        const box = coord.getByPlaceholder("e.g. headache, rash, paracetamol");
        if ((await box.inputValue()).trim().toLowerCase() !== "rash")
          throw new Error("search was not pre-filled with the verbatim");
        await coord.getByRole("button", { name: /^Search$/ }).click();
        const results = coord.getByRole("button", { name: /Use this term instead/ });
        await results.first().waitFor({ timeout: 60000 });
        const firstResult = await coord
          .locator("li:has(button:has-text('Use this term instead'))")
          .first()
          .innerText();
        if (!/^\s*Rash\b/m.test(firstResult))
          throw new Error(`exact term not ranked first: ${firstResult.slice(0, 60)}`);
        await L.expectNewToast(coord, /accepted|coded|chosen/i, () => results.first().click());
        const productAccept = coord.getByRole("button", { name: /^Accept$/ }).first();
        if (await productAccept.count()) await productAccept.click();
        await L.shot(coord, "staff-coding");
      });

      await step("coordinator: narrative drafted from case data and saved", async () => {
        await coord.getByRole("tab", { name: "Case data" }).click();
        await coord.getByRole("button", { name: "Edit narrative" }).click();
        await coord.getByRole("button", { name: "Draft from case data" }).click();
        const text = await coord.getByLabel("Case narrative").inputValue();
        for (const want of ["34-year-old female", "Rash", "Lekki Phase 1"])
          if (!text.includes(want)) throw new Error(`draft lacks "${want}"`);
        await L.expectNewToast(coord, /Narrative saved/, () =>
          coord.getByRole("button", { name: "Save narrative" }).click(),
        );
      });

      await step("coordinator: follow-up request", async () => {
        await coord.getByRole("tab", { name: "Follow-up" }).click();
        await coord
          .getByPlaceholder(/What information is needed/)
          .fill(`${RUN}: please confirm the batch number.`);
        await L.expectNewToast(coord, /Follow-up request recorded/, () =>
          coord.getByRole("button", { name: "Send request" }).click(),
        );
      });

      await step("coordinator: advance to Regulatory ready", async () => {
        for (const s of ["Review", "QC", "Regulatory ready"]) await advance(coord, s);
        await coord
          .getByText(/ready to close/)
          .first()
          .waitFor();
      });
    }

    if (found.caseB) {
      await step(
        "coordinator: unlisted product forwarded to its holder (record only)",
        async () => {
          await openCase(coord, found.caseB);
          await coord.getByRole("button", { name: /Record a forward/ }).click();
          await coord.locator("#fwdHolder").fill("Test Holder Ltd");
          await coord.locator("#fwdMethod").click();
          await coord.getByRole("option").first().click();
          await L.expectNewToast(coord, /forward|recorded|saved/i, () =>
            coord.getByRole("button", { name: /Save forward/ }).click(),
          );
          await coord
            .getByText(/Forwarded to Test Holder Ltd/)
            .first()
            .waitFor();
        },
      );
    }

    // ---------------- Manager ----------------
    const mgr = await L.session(browser, "manager");

    if (found.caseA) {
      await step("manager: close the case with the password", async () => {
        await openCase(mgr, found.caseA);
        await mgr.locator("#closure-password").fill(L.passwordFor("manager"));
        await advance(mgr, "Closed");
      });
    }

    for (const [route, heading] of [
      ["/drugs", /Drug Catalog/],
      ["/registrations", /Registrations/],
      ["/branches", /Branches/],
      ["/psur-calendar", /PSUR calendar/],
      ["/psur-drafts", /PSUR drafts?/],
      ["/reports", /Safety reports|Reports/],
      ["/signals", /Signal review/],
      ["/literature", /Literature/],
      ["/oversight", /Oversight/],
      ["/follow-ups", /Follow-ups?/],
      ["/intake", /Inbound intake/],
      ["/audit", /Audit/],
      ["/notifications", /Notifications/],
      ["/ai-log", /AI data log/],
      ["/cases", /Case workbench/],
    ]) {
      await step(`manager page ${route}`, async () => {
        await L.openPage(mgr, route);
        await mgr.getByRole("heading", { name: heading }).first().waitFor();
        const text = await errorScreen(mgr);
        if (/Access restricted/.test(text)) throw new Error("access restricted for the manager");
        const pager = (text.match(/Showing \d+–\d+ of \d+/) || ["one page"])[0];
        console.log(`  ${route}: ${pager}`);
        await L.shot(mgr, `staff-mgr${route.replace(/\//g, "-")}`);
      });
    }

    await step("manager: monthly activity report (Word)", async () => {
      await L.openPage(mgr, "/reports");
      await L.download(
        mgr,
        () => mgr.getByRole("button", { name: /Download monthly report \(Word\)/ }).click(),
        `staff-monthly-${today}.docx`,
      );
    });

    await step("manager: PSUR draft → refresh → check → working Word export", async () => {
      await L.openPage(mgr, "/psur-calendar");
      const start = mgr.getByRole("button", { name: /Start PSUR draft/ }).first();
      if (await start.count()) await start.click();
      else await L.openPage(mgr, "/psur-drafts");
      if (!/\/psur-drafts\/./.test(mgr.url()))
        await mgr.locator("a[href*='/psur-drafts/']").first().click();
      await mgr.waitForURL(/\/psur-drafts\/./);
      await mgr.getByRole("button", { name: /Refresh data from records/ }).click();
      await L.waitNoLoading(mgr);
      await mgr.getByText("Pre-submission check").first().waitFor();
      await L.download(
        mgr,
        () => mgr.getByRole("button", { name: /Working draft \(Word\)/ }).click(),
        `staff-psur-working-${today}.docx`,
      );
      await L.shot(mgr, "staff-psur-draft");
    });
  } finally {
    const failed = steps.filter((s) => !s.ok);
    console.log(`\n${steps.length - failed.length}/${steps.length} steps passed`);
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.error}`);
    L.report({ run: RUN, steps, found });
    await browser.close();
    if (failed.length) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
