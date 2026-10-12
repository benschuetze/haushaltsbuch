/**
 * Who runs this instance, for the imprint and the privacy notice. Set in the hosting environment only: the
 * repository is public, and a name with a home address does not belong in it.
 */
export type Operator = { name: string | null; address: string[]; email: string | null };

export function operatorInfo(env: NodeJS.ProcessEnv = process.env): Operator {
  return {
    name: env.PRIVACY_OPERATOR?.trim() || null,
    // One line per part, separated by ";" because environment variables have no line breaks.
    address: (env.OPERATOR_ADDRESS ?? "")
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean),
    email: env.PRIVACY_CONTACT_EMAIL?.trim() || null,
  };
}

/** § 5 DDG needs a name, an address to serve papers to, and a fast electronic contact. */
export function imprintComplete(o: Operator): boolean {
  return Boolean(o.name && o.address.length > 0 && o.email);
}
