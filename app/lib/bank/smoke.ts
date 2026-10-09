import { decryptSecret, encryptSecret } from "~/lib/crypto.server";
import { BankApiError, type EnableBankingClient } from "./enable-banking.server";

export type BankSmokeResult = { problems: string[]; warnings: string[]; banks: number };

/**
 * Runs at deploy: a wrong key or app id otherwise only shows up when someone opens "Banken"
 * (it did, once). A production app that is registered but not yet activated is a warning, not an error:
 * the app works on mock tiles and file import until the owner links accounts.
 */
export async function bankSmokeTest(client: EnableBankingClient): Promise<BankSmokeResult> {
  const result: BankSmokeResult = { problems: [], warnings: [], banks: 0 };
  try {
    result.banks = (await client.listAspsps("DE")).length;
  } catch (error) {
    if (error instanceof BankApiError && error.status === 403) {
      result.warnings.push(
        "Enable-Banking-App ist noch nicht aktiviert (403); Banken laufen bis dahin als Mock/Datei.",
      );
    } else if (error instanceof BankApiError && error.status === 401) {
      result.problems.push(
        "Enable Banking lehnt die Signatur ab (401): ENABLE_BANKING_PRIVATE_KEY passt nicht zu ENABLE_BANKING_APP_ID.",
      );
    } else {
      result.problems.push(`Bankenliste nicht abrufbar: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Bank sessions are stored encrypted; without a valid key the first connection would fail at the very end.
  try {
    if (decryptSecret(encryptSecret("selbsttest")) !== "selbsttest") throw new Error("Rundweg liefert anderen Wert");
  } catch (error) {
    result.problems.push(`DATA_ENCRYPTION_KEY unbrauchbar: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}
