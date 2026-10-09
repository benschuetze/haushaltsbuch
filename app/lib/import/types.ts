export type NormalizedRow = {
  /** 1-based line in the file, so rejections can point at it. */
  line: number;
  bookingDate: string;
  amountCents: number;
  currency: string;
  counterparty: string;
  purpose: string;
  raw: Record<string, string>;
};

export type RejectedRow = {
  line: number;
  reason: string;
};

export type ParseResult = {
  rows: NormalizedRow[];
  rejected: RejectedRow[];
  /** Valid but not booked yet (pending card payments). Not an error, just not now. */
  skipped: RejectedRow[];
};

export type BankProfile = {
  id: string;
  label: string;
  /** Cheap check on the header, used to suggest the right profile for a file. */
  matches: (bytes: Uint8Array) => boolean;
  parse: (bytes: Uint8Array) => ParseResult;
};
