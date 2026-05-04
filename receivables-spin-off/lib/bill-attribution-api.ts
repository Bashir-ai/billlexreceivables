import { z } from "zod"
import { BillAttributionRole } from "@prisma/client"
import type { BillAttributionRowInput } from "./bill-attribution"

export const billAttributionRowsApiSchema = z.array(
  z.object({
    userId: z.string().min(1),
    role: z.enum(["FINDER", "CLIENT_MANAGER", "PROJECT_MANAGER"]),
    splitPercent: z.number().min(0).max(100).default(0),
    fixedAmount: z.number().min(0).nullable().optional(),
  })
)

export type BillAttributionApiRow = z.infer<typeof billAttributionRowsApiSchema>[number]

export function apiRowsToBillAttributionInputs(rows: z.infer<typeof billAttributionRowsApiSchema>): BillAttributionRowInput[] {
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role as BillAttributionRole,
    splitPercent: r.splitPercent ?? 0,
    fixedAmount: r.fixedAmount ?? null,
  }))
}
