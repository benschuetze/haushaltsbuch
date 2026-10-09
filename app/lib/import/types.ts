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
};

export type BankProfile = {
  id: string;
  label: string;
  parse: (bytes: Uint8Array) => ParseResult;
};
