import { z } from "zod";

/** How a learned bank format maps its columns. Indices refer to the header row. */
export const columnMappingSchema = z
  .object({
    delimiter: z.enum([";", ",", "\t"]),
    date: z.number().int().min(0),
    amount: z.number().int().min(0).optional(),
    /** Some banks (Deutsche Bank) split amounts into "Soll" (debit) and "Haben" (credit) columns. */
    debit: z.number().int().min(0).optional(),
    credit: z.number().int().min(0).optional(),
    decimal: z.enum(["de", "en"]),
    counterparty: z.number().int().min(0).optional(),
    /** Separate payer and payee columns: the other party depends on the direction of the booking. */
    payer: z.number().int().min(0).optional(),
    payee: z.number().int().min(0).optional(),
    purpose: z.number().int().min(0).optional(),
    currency: z.number().int().min(0).optional(),
    status: z.number().int().min(0).optional(),
  })
  .refine((m) => m.amount !== undefined || (m.debit !== undefined && m.credit !== undefined), {
    message: "Betrag fehlt: weder eine Betragsspalte noch Soll/Haben",
  })
  .refine((m) => m.purpose !== undefined || m.counterparty !== undefined || m.payee !== undefined, {
    message: "Weder Verwendungszweck noch Empfänger gefunden",
  });

export type ColumnMapping = z.infer<typeof columnMappingSchema>;
