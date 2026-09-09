import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  UNCONFIRMED_DEFAULT_CONFIG,
  UNCONFIRMED_SENTINEL,
  isTransmissionConfigConfirmed,
  describeUnconfirmedTransmissionConfig,
  type E2bTransmissionConfig,
} from "./transmission-config";

describe("transmission configuration (sender/receiver/environment)", () => {
  it("the shipped default is honestly unconfirmed — never a working configuration", () => {
    expect(isTransmissionConfigConfirmed(UNCONFIRMED_DEFAULT_CONFIG)).toBe(false);
    expect(UNCONFIRMED_DEFAULT_CONFIG.sender.organization).toBe(UNCONFIRMED_SENTINEL);
    expect(UNCONFIRMED_DEFAULT_CONFIG.sender.identifier).toBe(UNCONFIRMED_SENTINEL);
    expect(UNCONFIRMED_DEFAULT_CONFIG.receiver.identifier).toBe(UNCONFIRMED_SENTINEL);
  });

  it("reports every specific missing value, not just a generic failure", () => {
    const gaps = describeUnconfirmedTransmissionConfig(UNCONFIRMED_DEFAULT_CONFIG);
    expect(gaps.length).toBe(3);
    expect(gaps.some((g) => g.includes("Sender organisation"))).toBe(true);
    expect(gaps.some((g) => g.includes("Sender transmission identifier"))).toBe(true);
    expect(gaps.some((g) => g.includes("Receiver transmission identifier"))).toBe(true);
  });

  it("a fully supplied configuration is recognised as confirmed", () => {
    const config: E2bTransmissionConfig = {
      environment: "uat",
      sender: { organization: "MEDNOVA", identifier: "MEDNOVA-SND-01" },
      receiver: { identifier: "NAFDAC-RCV-01" },
      reportType: "1",
    };
    expect(isTransmissionConfigConfirmed(config)).toBe(true);
    expect(describeUnconfirmedTransmissionConfig(config)).toEqual([]);
  });

  it("a partially supplied configuration (missing only the receiver id) is still reported as unconfirmed with the exact gap", () => {
    const config: E2bTransmissionConfig = {
      environment: "uat",
      sender: { organization: "MEDNOVA", identifier: "MEDNOVA-SND-01" },
      receiver: { identifier: UNCONFIRMED_SENTINEL },
      reportType: "1",
    };
    expect(isTransmissionConfigConfirmed(config)).toBe(false);
    const gaps = describeUnconfirmedTransmissionConfig(config);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("Receiver transmission identifier");
  });

  it("never hardcodes a real NAFDAC/VigiFlow/MedNova identifier anywhere in this module", () => {
    // The only identifiers this file contains are the sentinel and the
    // ones supplied in this test's own fixtures above — no real-looking
    // regulatory ID string is embedded as a default.
    const content = readFileSync(join(__dirname, "transmission-config.ts"), "utf-8");
    expect(content).not.toMatch(/NAFDAC-\d/);
    expect(content).not.toMatch(/MEDNOVA-\d/);
  });
});
