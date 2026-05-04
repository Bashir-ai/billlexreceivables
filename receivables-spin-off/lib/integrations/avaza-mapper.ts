import { BillStatus } from "@prisma/client"
import type { AvazaInvoice, AvazaParty } from "./avaza-client"

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toDate(v?: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function mapAvazaStatus(statusRaw?: string): BillStatus {
  const status = String(statusRaw || "").trim().toLowerCase()
  if (["paid", "payment_received", "settled"].includes(status)) return BillStatus.PAID
  if (["approved", "accepted"].includes(status)) return BillStatus.APPROVED
  if (["sent", "issued", "submitted", "viewed", "overdue"].includes(status)) return BillStatus.SUBMITTED
  if (["cancelled", "void", "canceled"].includes(status)) return BillStatus.CANCELLED
  return BillStatus.DRAFT
}

export function mapPartyToClient(party: AvazaParty) {
  return {
    avazaExternalId: String(party.id),
    name: party.name?.trim() || party.company_name?.trim() || `Avaza Client ${party.id}`,
    email: party.email?.trim() || null,
    company: party.company_name?.trim() || null,
    avazaUpdatedAt: toDate(party.updated_at),
  }
}

export function mapInvoice(invoice: AvazaInvoice) {
  const status = mapAvazaStatus(invoice.status)
  const amount = toNumber(invoice.total) ?? toNumber(invoice.amount) ?? 0
  const issued = toDate(invoice.issue_date)
  const due = toDate(invoice.due_date)
  const paid = toDate(invoice.paid_date || invoice.paid_at)
  return {
    avazaExternalId: String(invoice.id),
    invoiceNumber: invoice.invoice_number || null,
    status,
    amount,
    subtotal: amount,
    dueDate: due,
    paidAt: status === BillStatus.PAID ? paid ?? new Date() : null,
    submittedAt:
      status === BillStatus.SUBMITTED || status === BillStatus.APPROVED || status === BillStatus.PAID
        ? issued ?? new Date()
        : null,
    approvedAt: status === BillStatus.APPROVED || status === BillStatus.PAID ? issued ?? new Date() : null,
    avazaUpdatedAt: toDate(invoice.updated_at),
    partyExternalId: invoice.party_id ? String(invoice.party_id) : null,
  }
}

