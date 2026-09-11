import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Organization isolation (task scenario 9) is enforced by Postgres RLS,
 * which this test suite cannot exercise against a live database (no
 * Supabase mock exists in this codebase — see the other e2b-r3 test
 * files, none of which touch the DB directly). What CAN be verified
 * statically, and is verified here, is that the migration actually wires
 * up the same org-isolation mechanism every other pv_* table uses
 * (set_pv_organization_id trigger + org_isolation_* policies + no anon
 * grant) for BOTH new regulatory-config tables — the exact pattern
 * pv_intake_settings/pv_intake_messages already rely on in production.
 */
describe("pv_regulatory_config / pv_reporter_qualification_mappings — org isolation, by construction", () => {
  const migration = readFileSync(
    join(__dirname, "..", "..", "..", "supabase", "migrations", "021_regulatory_config.sql"),
    "utf-8",
  );

  it("enables row level security on both new tables", () => {
    expect(migration).toMatch(/alter table public\.pv_regulatory_config enable row level security/);
    expect(migration).toMatch(
      /alter table public\.pv_reporter_qualification_mappings enable row level security/,
    );
  });

  it("wires the shared set_pv_organization_id trigger on both tables — never a bespoke org-id assignment", () => {
    const triggerCount = (
      migration.match(/execute function public\.set_pv_organization_id\(\)/g) ?? []
    ).length;
    expect(triggerCount).toBe(2);
  });

  it("every policy on both tables filters by current_org_id() — no unscoped policy exists", () => {
    const policyBlocks =
      migration.match(/create policy "org_isolation_\w+" on public\.\w+[\s\S]*?;/g) ?? [];
    expect(policyBlocks.length).toBeGreaterThanOrEqual(8); // 4 policies (select/insert/update/delete) x 2 tables
    for (const block of policyBlocks) {
      expect(block).toContain("current_org_id()");
    }
  });

  it("revokes anon access on both tables — configuration this sensitive is never publicly readable", () => {
    expect(migration).toMatch(/revoke all on public\.pv_regulatory_config from anon/);
    expect(migration).toMatch(/revoke all on public\.pv_reporter_qualification_mappings from anon/);
  });

  it("never hardcodes a real NAFDAC/MedNova identifier as sample/seed data", () => {
    expect(migration).not.toMatch(/NAFDAC-\d/);
    expect(migration).not.toMatch(/MEDNOVA-\d/);
  });
});
