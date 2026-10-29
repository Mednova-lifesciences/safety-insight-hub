#!/usr/bin/env node
/**
 * Loads the SYNTHETIC demo PSURs (psur-seed-data.mjs) into the test
 * organisation through the REST API — the alternative to pasting the SQL
 * from generate-psurs.mjs. Needs the service role key; refuses any
 * organisation that is not the synthetic test one.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed/load-psurs.mjs [YYYY-MM-DD]
 */
import { buildPsurSeed } from "./psur-seed-data.mjs";

const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const orgs = await (
  await fetch(`${url}/rest/v1/organizations?slug=eq.mednova-test-a&select=id,name`, { headers })
).json();
const org = orgs[0];
if (!org || !/synthetic data only/i.test(org.name))
  throw new Error("Synthetic test organisation not found.");

const today = process.argv[2] ? new Date(`${process.argv[2]}T00:00:00Z`) : new Date();
const rows = buildPsurSeed(today).map((d) => ({ id: d.id, organization_id: org.id, data: d }));
const r = await fetch(`${url}/rest/v1/pv_psur_documents?on_conflict=id`, {
  method: "POST",
  headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(rows),
});
if (!r.ok) throw new Error(`Load failed: ${r.status} ${await r.text()}`);
console.log(`Loaded ${rows.length} synthetic PSURs into ${org.name}.`);
