import type { BankProfile } from "../types";
import { demoProfile } from "./demo";

export const bankProfiles: Record<string, BankProfile> = {
  [demoProfile.id]: demoProfile,
};

export function getBankProfile(id: string): BankProfile {
  const profile = bankProfiles[id];
  if (!profile) throw new Error(`Unbekanntes Bankprofil: ${id}`);
  return profile;
}
