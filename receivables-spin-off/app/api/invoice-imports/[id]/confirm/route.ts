export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { createBillAttributionSnapshot } from "@/lib/bill-attribution"

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
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function inferPaidStatus(rawStatus: unknown, fallbackPaidDate: Date | null): boolean {
  if (typeof rawStatus === "boolean") return rawStatus
  if (typeof rawStatus === "number") return rawStatus !== 0
  if (typeof rawStatus === "string") {
    const normalized = rawStatus.trim().toLowerCase()
    if (["paid", "settled", "yes", "true", "1", "closed"].includes(normalized)) return true
    if (["unpaid", "open", "pending", "no", "false", "0"].includes(normalized)) return false
  }
  return Boolean(fallbackPaidDate)
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const batch = await prisma.invoiceImportBatch.findUnique({
    where: { id: params.id },
    include: { rows: true },
  })

  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 })
  if (batch.status === "CONFIRMED") {
    return NextResponse.json({ error: "Batch already confirmed" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const selectedRowIds = Array.isArray(body?.selectedRowIds)
    ? new Set<string>(body.selectedRowIds.filter((id: unknown) => typeof id === "string"))
    : null
  const rowFieldSelection = (body?.rowFieldSelection && typeof body.rowFieldSelection === "object")
    ? (body.rowFieldSelection as Record<string, string[]>)
    : {}

  const validRows = batch.rows.filter((r) => {
    if (r.status !== "VALID") return false
    if (!selectedRowIds) return true
    return selectedRowIds.has(r.id)
  })
  let importedCount = 0
  const importedPaidBillIds: string[] = []

  await prisma.$transaction(async (tx) => {
    const reservedInvoiceNumbers = new Set<string>()

    const resolveUniqueInvoiceNumber = async (
      candidate: string | null | undefined,
      rowIndex: number
    ): Promise<string> => {
      const base =
        candidate && candidate.trim()
          ? candidate.trim()
          : `BLX-${params.id.slice(-6)}-${rowIndex}`

      // Try base first, then deterministic suffix attempts.
      for (let i = 0; i < 200; i += 1) {
        const next = i === 0 ? base : `${base}-${i}`
        if (reservedInvoiceNumbers.has(next)) continue

        const existing = await tx.bill.findUnique({
          where: { invoiceNumber: next },
          select: { id: true },
        })
        if (!existing) {
          reservedInvoiceNumbers.add(next)
          return next
        }
      }
      // Guaranteed unique fallback: UUID suffix
      const fallback = `BLX-${randomUUID()}`
      reservedInvoiceNumbers.add(fallback)
      return fallback
    }

    for (const row of validRows) {
      let clientId: string | null = null
      let leadId: string | null = null

      if (row.clientName) {
        const existingClient = await tx.client.findFirst({
          where: {
            OR: [
              row.clientEmail ? { email: { equals: row.clientEmail, mode: "insensitive" } } : undefined,
              { name: { equals: row.clientName, mode: "insensitive" } },
              row.clientCompany ? { company: { equals: row.clientCompany, mode: "insensitive" } } : undefined,
            ].filter(Boolean) as any,
            deletedAt: null,
          },
        })

        const client = existingClient ?? await tx.client.create({
          data: {
            name: row.clientName,
            company: row.clientCompany || row.clientName,
            email: row.clientEmail || null,
            createdBy: session.user.id,
          },
        })
        clientId = client.id
      } else if (row.leadName) {
        const sector = row.sectorName
          ? await tx.sectorOfActivity.upsert({
              where: { name: row.sectorName },
              update: {},
              create: { name: row.sectorName },
            })
          : null

        const area = row.areaOfLawName
          ? await tx.areaOfLaw.upsert({
              where: { name: row.areaOfLawName },
              update: {},
              create: { name: row.areaOfLawName },
            })
          : null

        const lead = await tx.lead.create({
          data: {
            name: row.leadName,
            company: row.leadCompany || null,
            createdBy: session.user.id,
            sectorOfActivityId: sector?.id,
            areaOfLawId: area?.id,
          },
        })
        leadId = lead.id
      }

      const subtotal = row.subtotal || 0
      const discountPercent = row.discountPercent || null
      const taxRate = row.taxRate || null
      const afterDiscount = discountPercent ? subtotal * (1 - discountPercent / 100) : subtotal
      const rawData = (row.rawData && typeof row.rawData === "object") ? (row.rawData as Record<string, unknown>) : {}
      const importedTotalAmount =
        toNumber((row as any).totalAmount) ??
        toNumber(rawData.__resolvedTotalAmount) ??
        toNumber(rawData.totalAmount) ??
        toNumber(rawData["Total Amount"]) ??
        toNumber(rawData.total)
      // Prefer imported full amount from file ("Total Amount"), fallback to computed value.
      const finalAmount =
        importedTotalAmount !== null
          ? importedTotalAmount
          : (taxRate ? afterDiscount * (1 + taxRate / 100) : afterDiscount)

      const selectedFields = Array.isArray(rowFieldSelection[row.id]) ? rowFieldSelection[row.id] : []
      const importedIssueDate = toDate(rawData.__resolvedIssueDate ?? rawData.issueDate ?? rawData["Issue Date"])
      const importedPaidDate = toDate(rawData.__resolvedPaidDate ?? rawData.paidDate ?? rawData["Payment Date"])
      const importedCurrency = (rawData.__resolvedCurrency ?? rawData.currency ?? rawData.Currency ?? null) as string | null
      const importedPaymentStatus = rawData.__resolvedPaymentStatusBool ?? rawData.__resolvedPaymentStatus ?? rawData.paymentStatus ?? rawData.status
      const isPaidFromImport = inferPaidStatus(importedPaymentStatus, importedPaidDate)
      const fieldLabelMap: Record<string, string> = {
        clientName: "Client",
        clientEmail: "Client Email",
        clientCompany: "Company",
        leadName: "Lead",
        invoiceNumber: "Source Invoice",
        description: "Description",
        dueDate: "Due Date",
        subtotal: "Subtotal",
        taxRate: "Tax Rate",
        discountPercent: "Discount %",
        totalAmount: "Total Amount",
        issueDate: "Issue Date",
        quantity: "Quantity",
        unitPrice: "Unit Price",
        taxAmount: "Tax Amount",
        tranType: "Transaction Type",
        inventoryName: "Inventory Name",
        paymentStatus: "Payment Status",
        paidDate: "Paid Date",
        currency: "Currency",
      }
      const fieldValueMap: Record<string, unknown> = {
        clientName: row.clientName,
        clientEmail: row.clientEmail,
        clientCompany: row.clientCompany,
        leadName: row.leadName,
        invoiceNumber: row.invoiceNumber,
        description: row.description,
        dueDate: row.dueDate,
        subtotal,
        taxRate,
        discountPercent,
        totalAmount: importedTotalAmount,
        issueDate: importedIssueDate,
        quantity: rawData.quantity ?? (rawData as any).Quantity,
        unitPrice: rawData.unitPrice ?? rawData["Unit Price"],
        taxAmount: rawData.taxAmount ?? rawData["Tax Amount"],
        tranType: rawData.tranType ?? rawData["Tran Type"],
        inventoryName: rawData["Inventory Name"] ?? (rawData as any).inventoryName,
        paymentStatus: importedPaymentStatus,
        paidDate: importedPaidDate,
        currency: importedCurrency,
      }
      const summaryLines = selectedFields
        .map((key) => {
          const val = fieldValueMap[key]
          if (val === null || val === undefined || String(val).trim() === "") return null
          return `${fieldLabelMap[key] || key}: ${String(val)}`
        })
        .filter(Boolean) as string[]
      const mergedDescription = [row.description || null, ...summaryLines]
        .filter(Boolean)
        .join(summaryLines.length > 0 ? "\n" : "")

      const invoiceNumber = await resolveUniqueInvoiceNumber(row.invoiceNumber, row.rowIndex)

      let bill
      try {
        bill = await tx.bill.create({
          data: {
            clientId,
            leadId,
            createdBy: session.user.id,
            status: isPaidFromImport ? "PAID" : "DRAFT",
            subtotal,
            amount: finalAmount,
            description: mergedDescription || null,
            taxRate,
            discountPercent,
            dueDate: row.dueDate,
            paidAt: isPaidFromImport ? (importedPaidDate || new Date()) : null,
            invoiceNumber,
          },
        })
      } catch (error: any) {
        // Final safeguard against race/collision in the same transaction.
        if (error?.code === "P2002") {
          const fallbackInvoiceNumber = await resolveUniqueInvoiceNumber(
            `BLX-${params.id.slice(-6)}-${row.rowIndex}-${Date.now()}`,
            row.rowIndex
          )
          bill = await tx.bill.create({
            data: {
              clientId,
              leadId,
              createdBy: session.user.id,
              status: isPaidFromImport ? "PAID" : "DRAFT",
              subtotal,
              amount: finalAmount,
              description: mergedDescription || null,
              taxRate,
              discountPercent,
              dueDate: row.dueDate,
              paidAt: isPaidFromImport ? (importedPaidDate || new Date()) : null,
              invoiceNumber: fallbackInvoiceNumber,
            },
          })
        } else {
          throw error
        }
      }

      await tx.invoiceImportRow.update({
        where: { id: row.id },
        data: {
          status: "IMPORTED",
          createdBillId: bill.id,
        },
      })
      await createBillAttributionSnapshot({
        tx,
        billId: bill.id,
        clientId: bill.clientId,
        projectId: bill.projectId,
      })
      if (isPaidFromImport) {
        importedPaidBillIds.push(bill.id)
      }
      importedCount += 1
    }

    await tx.invoiceImportBatch.update({
      where: { id: params.id },
      data: { status: "CONFIRMED" },
    })
  })

  for (const billId of importedPaidBillIds) {
    try {
      const { runPaidInvoiceLedgerHooks } = await import("@/lib/invoice-paid-fees")
      await runPaidInvoiceLedgerHooks(billId)
    } catch (error) {
      console.error("Paid import invoice fee hooks failed for bill", billId, error)
    }
  }

  return NextResponse.json({ importedCount })
}

