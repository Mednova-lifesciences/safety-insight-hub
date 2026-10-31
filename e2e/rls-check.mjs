#!/usr/bin/env node
/**
 * Organisation isolation, checked as real signed-in users of TWO synthetic
 * test organisations (and as an anonymous caller) against the live
 * Supabase REST API — the same path the browser uses.
 *
 *   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… node e2e/rls-check.mjs
 *
 * Exits non-zero if any check fails. Reads only; the one write it tries
 * (org B updating an org A line list) must be refused, and it targets a
 * synthetic job.
 */
const URL_ = (process.env.SUPABASE_URL || "https://rcgiwtuvmczgcctfcrqf.supabase.co").replace(
  /\/$/,
  "",
);
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = process.env.TEST_PASSWORD;
if (!KEY) throw new Error("Set SUPABASE_PUBLISHABLE_KEY.");
if (!PASSWORD) throw new Error("Set TEST_PASSWORD (the synthetic test accounts' password).");

const A = "test.evaluator@test.mednovalife.com";
const B = "test.b.evaluator@test.mednovalife.com";

async function signIn(email) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`sign-in ${email}: ${r.status}`);
  return (await r.json()).access_token;
}

async function rest(token, path, init = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const TABLES = [
  "pv_linelist_jobs",
  "pv_linelist_issues",
  "pv_psur_documents",
  "pv_psur_findings",
  "pv_cases",
  "pv_audit_events",
  "pv_notifications",
  "pv_e2b_regulatory_assessments",
  "pv_regulatory_config",
  "pv_reporter_qualification_mappings",
];

const tokenA = await signIn(A);
const tokenB = await signIn(B);
const me = async (t) =>
  (await rest(t, "profiles?select=organization_id&limit=1")).body?.[0]?.organization_id;
const orgA = await me(tokenA);
const orgB = await me(tokenB);
check("two different organisations", orgA && orgB && orgA !== orgB, `${orgA} / ${orgB}`);

for (const table of TABLES) {
  for (const [who, token, own] of [
    ["A", tokenA, orgA],
    ["B", tokenB, orgB],
  ]) {
    const { status, body } = await rest(token, `${table}?select=organization_id&limit=1000`);
    const foreign = Array.isArray(body) ? body.filter((r) => r.organization_id !== own).length : -1;
    check(
      `${who} reads only its own ${table}`,
      status === 200 && foreign === 0,
      `${Array.isArray(body) ? body.length : status} row(s), ${foreign} foreign`,
    );
  }
  const anon = await rest(null, `${table}?select=organization_id&limit=5`);
  check(
    `anon reads nothing from ${table}`,
    Array.isArray(anon.body) ? anon.body.length === 0 : anon.status >= 400,
    `status ${anon.status}`,
  );
}

// The cross-file loader's own query: validated jobs with their rows.
const loaderA = await rest(
  tokenA,
  "pv_linelist_jobs?select=id,organization_id,parsedRows:data->parsedRows&data->>stage=in.(VALIDATED,E2B_GENERATED)",
);
const loaderB = await rest(
  tokenB,
  "pv_linelist_jobs?select=id,organization_id,parsedRows:data->parsedRows&data->>stage=in.(VALIDATED,E2B_GENERATED)",
);
check(
  "cross-file loader query sees only org A for A",
  Array.isArray(loaderA.body) && loaderA.body.every((r) => r.organization_id === orgA),
  `${loaderA.body.length} job(s)`,
);
check(
  "cross-file loader query sees only org B for B",
  Array.isArray(loaderB.body) && loaderB.body.every((r) => r.organization_id === orgB),
  `${loaderB.body.length} job(s)`,
);

// B cannot read or change one of A's jobs by id.
const aJob = Array.isArray(loaderA.body) && loaderA.body[0]?.id;
if (aJob) {
  const peek = await rest(tokenB, `pv_linelist_jobs?select=id&id=eq.${encodeURIComponent(aJob)}`);
  check("B cannot read A's job by id", Array.isArray(peek.body) && peek.body.length === 0);
  const write = await rest(tokenB, `pv_linelist_jobs?id=eq.${encodeURIComponent(aJob)}`, {
    method: "PATCH",
    body: JSON.stringify({ data: { tampered: true } }),
  });
  check(
    "B cannot change A's job",
    Array.isArray(write.body) ? write.body.length === 0 : write.status >= 400,
    `status ${write.status}`,
  );
} else {
  console.log("  (no validated org A job to try a cross-org read/write on)");
}

// Organisations: names and slugs are public (the reporting link); invite codes are not.
for (const [who, token] of [
  ["anon", null],
  ["A", tokenA],
]) {
  const r = await rest(token, "organizations?select=name,invite_code");
  check(
    `${who} cannot read invite codes`,
    r.status >= 400 || (Array.isArray(r.body) && r.body.every((o) => !o.invite_code)),
    `status ${r.status}`,
  );
}
const pub = await rest(null, "organizations?select=name,slug");
check(
  "anon can still read organisation names and slugs",
  pub.status === 200 && Array.isArray(pub.body) && pub.body.length > 0,
);

// Admin-only AI disclosure log.
const logA = await rest(tokenA, "pv_ai_disclosures?select=organization_id&limit=200");
if (
  logA.status === 404 ||
  (typeof logA.body === "object" && logA.body?.code === "42P01") ||
  logA.body?.code === "PGRST205"
) {
  console.log("  (pv_ai_disclosures not created yet)");
} else {
  check(
    "A reads only its own AI log",
    Array.isArray(logA.body) && logA.body.every((r) => r.organization_id === orgA),
    `${Array.isArray(logA.body) ? logA.body.length : logA.status}`,
  );
  const logAnon = await rest(null, "pv_ai_disclosures?select=organization_id&limit=5");
  check(
    "anon reads no AI log",
    Array.isArray(logAnon.body) ? logAnon.body.length === 0 : logAnon.status >= 400,
  );
}

const anonRpc = await rest(null, "rpc/get_organization_invite_code", {
  method: "POST",
  body: "{}",
});
check(
  "anon cannot call get_organization_invite_code",
  anonRpc.status >= 400 || anonRpc.body === null,
  `status ${anonRpc.status}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
