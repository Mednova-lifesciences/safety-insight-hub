#!/usr/bin/env node
/**
 * Clears the SYNTHETIC test organisation's line lists, issues, PSURs and E2B
 * assessments through the REST API (the same as reset-test-org.sql), then
 * reloads the demo PSURs. Refuses any organisation whose name does not say
 * it holds synthetic data only. Configuration and the audit trail are kept.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed/reset-test-org.mjs
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const orgs = await (
  await fetch(`${url}/rest/v1/organizations?slug=eq.mednova-test-a&select=id,name`, { headers })
).json();
const org = orgs[0];
if (!org || !/synthetic data only/i.test(org.name))
  throw new Error("Synthetic test organisation not found — nothing deleted.");

for (const table of [
  "pv_linelist_issues",
  "pv_linelist_jobs",
  "pv_psur_findings",
  "pv_psur_documents",
  "pv_e2b_c17_ai_assessments",
  "pv_e2b_regulatory_assessments",
]) {
  const r = await fetch(`${url}/rest/v1/${table}?organization_id=eq.${org.id}`, {
    method: "DELETE",
    headers,
  });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  console.log(`cleared ${table}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(here, "load-psurs.mjs")], { stdio: "inherit" });
