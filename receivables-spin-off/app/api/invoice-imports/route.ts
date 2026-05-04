export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { InvoiceImportRowStatus } from "@prisma/client"

const importRequestSchema = z.object({
  fileName: z.string().min(1),
  rows: z.array(z.record(z.any())).min(1),
})

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number") return String(value)
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === "number") {
    // Excel serial date support
    const epoch = new Date(Date.UTC(1899, 11, 30))
    const d = new Date(epoch.getTime() + value * 86400000)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value !== "string" || !value.trim()) return null
  const d = new Date(value.trim())
  return Number.isNaN(d.getTime()) ? null : d
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    if (["true", "yes", "y", "paid", "settled", "1"].includes(normalized)) return true
    if (["false", "no", "n", "unpaid", "open", "pending", "0"].includes(normalized)) return false
  }
  return null
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const batches = await prisma.invoiceImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  })

  return NextResponse.json(batches)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const payload = importRequestSchema.parse(body)

    const normalizedRows = payload.rows.map((row, idx) => {
      const mergedClientBC = firstString(row.__mergedClientBC ?? row.__originalRow?.__mergedClientBC)
      const clientName = firstString(
        row.clientName ??
          row.client ??
          row.customer ??
          row.Customer ??
          row.__originalRow?.Customer ??
          mergedClientBC
      )
      const clientEmail = firstString(row.clientEmail ?? row.email)
      const leadName = firstString(row.leadName ?? row.lead)
      const quantity = toNumber(row.quantity ?? row.Quantity ?? row.__originalRow?.Quantity)
      const unitPrice = toNumber(row.unitPrice ?? row["Unit Price"] ?? row.UnitPrice ?? row.__originalRow?.["Unit Price"])
      const amountBeforeTax = toNumber(
        row.amountBeforeTax ?? row["Amount before Tax"] ?? row.amount_before_tax ?? row.__originalRow?.["Amount before Tax"]
      )
      const taxAmount = toNumber(row.taxAmount ?? row["Tax Amount"] ?? row.tax_amount ?? row.__originalRow?.["Tax Amount"])
      const totalAmount = toNumber(row.totalAmount ?? row["Total Amount"] ?? row.total ?? row.__originalRow?.["Total Amount"])
      const derivedSubtotal = amountBeforeTax ?? (quantity !== null && unitPrice !== null ? quantity * unitPrice : null)
      // Avaza mapping: "Amount before Tax" is subtotal.
      const subtotal = toNumber(row.subtotal ?? row.amountBeforeTax ?? row["Amount before Tax"] ?? row.amount ?? derivedSubtotal)
      // Avaza mapping: "Total Amount" is full invoice amount.
      const fullAmount = toNumber(row.totalAmount ?? row["Total Amount"] ?? row.total)
      const description = firstString(
        row.description ?? row.details ?? row.note ?? row["Inventory Name"] ?? row.inventoryName ?? row.__originalRow?.["Inventory Name"]
      )
      const invoiceNumber = firstString(
        row.invoiceNumber ??
          row.invoice_no ??
          row.invoice ??
          row["Tran Number"] ??
          row.__originalRow?.["Tran Number"] ??
          row.__colF ??
          row.__originalRow?.__colF
      )
      const taxRate = toNumber(
        row.taxRate ??
          row.tax ??
          (taxAmount !== null && subtotal !== null && subtotal > 0 ? (taxAmount / subtotal) * 100 : null)
      )
      const discountPercent = toNumber(row.discountPercent ?? row.discount)
      const issueDate = toDate(row.issueDate ?? row["Issue Date"] ?? row.issue_date ?? row.__originalRow?.["Issue Date"])
      const dueDate = toDate(row.dueDate ?? row.due_date ?? row["Due Date"] ?? row.__originalRow?.["Due Date"] ?? issueDate)
      const paidDate = toDate(row.paidDate ?? row.paymentDate ?? row["Payment Date"] ?? row.__originalRow?.["Payment Date"])
      const paymentStatusRaw = firstString(
        row.paymentStatus ??
          row.status ??
          row["Payment Status"] ??
          row["Is Paid"] ??
          row.__originalRow?.["Payment Status"] ??
          row.__originalRow?.status
      )
      const paymentStatusBool = toBoolean(row.paymentStatus ?? row.status ?? row["Payment Status"] ?? row["Is Paid"])
      const currency = firstString(row.currency ?? row["Currency"] ?? row.moeda ?? row.__originalRow?.Currency)
      const sectorName = firstString(row.sectorName ?? row.sector ?? row.sectorOfActivity)
      const areaOfLawName = firstString(row.areaOfLawName ?? row.areaOfLaw ?? row.area)
      const transactionType = firstString(row.tranType ?? row["Tran Type"] ?? row.__originalRow?.["Tran Type"])

      const errors: string[] = []
      if (!clientName && !leadName) errors.push("clientName or leadName is required")
      if (subtotal === null || subtotal < 0) errors.push("subtotal/amount must be a valid positive number")
      if (fullAmount !== null && fullAmount < 0) errors.push("total amount must be a valid positive number")
      const status: InvoiceImportRowStatus = errors.length ? "INVALID" : "VALID"

      return {
        rowIndex: idx + 1,
        status,
        errorMessage: errors.join("; ") || null,
        clientName,
        clientEmail: firstString(row.clientEmail ?? row.email ?? row.__originalRow?.email),
        clientCompany: firstString(row.clientCompany ?? row.company ?? row.__originalRow?.company),
        leadName: firstString(row.leadName ?? row.lead),
        leadCompany: firstString(row.leadCompany ?? row.lead_company),
        description: transactionType ? `${transactionType}${description ? ` - ${description}` : ""}` : description,
        invoiceNumber,
        subtotal,
        taxRate,
        discountPercent,
        dueDate,
        sectorName,
        areaOfLawName,
        rawData: {
          ...row,
          __resolvedTotalAmount: fullAmount,
          __resolvedIssueDate: issueDate?.toISOString() ?? null,
          __resolvedPaidDate: paidDate?.toISOString() ?? null,
          __resolvedPaymentStatus: paymentStatusRaw,
          __resolvedPaymentStatusBool: paymentStatusBool,
          __resolvedCurrency: currency,
        },
      }
    })

    const validRows = normalizedRows.filter((r) => r.status === "VALID").length
    const invalidRows = normalizedRows.length - validRows

    const batch = await prisma.invoiceImportBatch.create({
      data: {
        fileName: payload.fileName,
        createdBy: session.user.id,
        totalRows: normalizedRows.length,
        validRows,
        invalidRows,
        rows: {
          create: normalizedRows,
        },
      },
      include: {
        rows: {
          orderBy: { rowIndex: "asc" },
        },
      },
    })

    return NextResponse.json(batch, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to stage invoice import" }, { status: 500 })
  }
}

