import type { SourceProfile } from "./types";
import { ondoAefiProfile } from "./ondo-aefi";
import { syntheticFacilityBProfile } from "./synthetic-facility-b";

const PROFILES: Record<string, SourceProfile> = {
  [ondoAefiProfile.id]: ondoAefiProfile,
  [syntheticFacilityBProfile.id]: syntheticFacilityBProfile,
};

/** Adding a new real line-list source means writing a new SourceProfile
 *  object and registering it here — never editing mapping.ts, validation.ts,
 *  serializer.ts, or batching.ts. See docs/E2B-R3-SOURCE-PROFILES.md. */
export function getSourceProfile(id: string): SourceProfile {
  const profile = PROFILES[id];
  if (!profile) {
    throw new Error(`Unknown source profile "${id}". Registered profiles: ${Object.keys(PROFILES).join(", ")}`);
  }
  return profile;
}

export function listSourceProfiles(): SourceProfile[] {
  return Object.values(PROFILES);
}
