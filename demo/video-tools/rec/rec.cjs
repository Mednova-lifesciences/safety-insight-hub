/**
 * Recording helpers for the demo video: a signed-in page that records its
 * own video at 1920x1080, a visible cursor with a click ripple, smooth mouse
 * moves, and time marks (seconds from the start of that page's video).
 * Test organisation only — the e2e accounts hold synthetic data.
 */
const fs = require("node:fs");
const path = require("node:path");
const L = require(require("node:path").join(__dirname, "../../../e2e/lib.cjs"));

const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const CURSOR = `
(() => {
  if (window.__cursor) return;
  window.__cursor = true;
  const add = () => {
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.8 L11.6 14 L18 14 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {position:'fixed', left:'-40px', top:'-40px', zIndex:2147483647, pointerEvents:'none', transition:'none', filter:'drop-shadow(0 2px 3px rgba(0,0,0,.35))'});
    document.documentElement.appendChild(c);
    window.addEventListener('mousemove', e => { c.style.left = (e.clientX - 4) + 'px'; c.style.top = (e.clientY - 2) + 'px'; }, true);
    window.addEventListener('mousedown', e => {
      const r = document.createElement('div');
      Object.assign(r.style, {position:'fixed', left:(e.clientX-18)+'px', top:(e.clientY-18)+'px', width:'36px', height:'36px', borderRadius:'50%', border:'3px solid rgba(37,99,235,.85)', background:'rgba(37,99,235,.18)', zIndex:2147483646, pointerEvents:'none', transform:'scale(.4)', opacity:'1', transition:'transform .45s ease-out, opacity .45s ease-out'});
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.6)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
})();`;

/** A recording page for this role, signed in from a saved session (the
 *  sign-in itself is not recorded). */
async function recorder(browser, who, name) {
  const warm = await L.session(browser, who);
  await warm.context().close();
  const state = path.join(L.OUT_DIR, `session-${who}.json`);
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1.2,
    acceptDownloads: true,
    storageState: state,
  });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(90000);
  // Frames straight from Chrome at device resolution (1600x900 CSS x 1.2 =
  // 1920x1080), each with its own timestamp; assembled by ffmpeg later.
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `${String(frames.length).padStart(6, "0")}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, "base64"));
    frames.push({ file, ts: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 88,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });
  const t0 = Date.now();
  const marks = [];
  let mouse = { x: 800, y: 450 };
  const r = {
    page,
    mark(label) {
      const t = (Date.now() - t0) / 1000;
      marks.push({ label, t: Math.round(t * 100) / 100, epoch: Date.now() / 1000 });
      console.log(`  [${t.toFixed(1)}s] ${label}`);
    },
    pause: (ms) => page.waitForTimeout(ms),
    async moveTo(x, y, steps = 28) {
      await page.mouse.move(x, y, { steps });
      mouse = { x, y };
    },
    async point(loc) {
      await loc.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      const b = await loc.boundingBox();
      if (!b) throw new Error("nothing to point at");
      await r.moveTo(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(300);
    },
    async click(loc, opts = {}) {
      await r.point(loc);
      await loc.click(opts);
      await page.waitForTimeout(400);
    },
    async type(loc, text) {
      await r.click(loc);
      await loc.pressSequentially(text, { delay: 28 });
      await page.waitForTimeout(300);
    },
    /** Scrolls the page smoothly by dy pixels. */
    async scroll(dy, ms = 1200) {
      const n = Math.max(1, Math.round(ms / 40));
      for (let i = 0; i < n; i++) {
        await page.mouse.wheel(0, dy / n);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(300);
    },
    /** Smoothly brings an element to the middle of the screen. */
    async reveal(loc, ms = 1200) {
      const b = await loc.boundingBox();
      if (!b) return loc.scrollIntoViewIfNeeded();
      const dy = b.y + b.height / 2 - 450;
      if (Math.abs(dy) > 40) await r.scroll(dy, ms);
    },
    async finish() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await page.waitForTimeout(500);
      await page.context().close();
      fs.writeFileSync(path.join(OUT, `${name}.frames.json`), JSON.stringify(frames));
      fs.writeFileSync(path.join(OUT, `${name}.marks.json`), JSON.stringify(marks, null, 1));
      console.log(`saved ${frames.length} frames to ${dir}`);
    },
    /** Waits for any toast to leave, so it does not cover what comes next. */
    async noToasts() {
      await page
        .locator("[data-sonner-toast]")
        .first()
        .waitFor({ state: "detached", timeout: 12000 })
        .catch(() => {});
    },
  };
  return r;
}

module.exports = { recorder, L, OUT };
