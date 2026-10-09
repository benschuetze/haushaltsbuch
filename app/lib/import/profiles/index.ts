import type { BankProfile } from "../types";
import { demoProfile } from "./demo";
import { dkbProfile } from "./dkb";
import { ingProfile } from "./ing";
import { sparkasseProfile } from "./sparkasse";
import { volksbankProfile } from "./volksbank";

export const bankProfiles: Record<string, BankProfile> = Object.fromEntries(
  [sparkasseProfile, ingProfile, dkbProfile, volksbankProfile, demoProfile].map((p) => [p.id, p]),
);

export function getBankProfile(id: string): BankProfile {
  const profile = bankProfiles[id];
  if (!profile) throw new Error(`Unbekanntes Bankprofil: ${id}`);
  return profile;
}

/** Used to give a helpful hint when a file is uploaded to an account with the wrong bank. */
export function detectBankProfile(bytes: Uint8Array): BankProfile | undefined {
  return Object.values(bankProfiles).find((p) => p.matches(bytes));
}
