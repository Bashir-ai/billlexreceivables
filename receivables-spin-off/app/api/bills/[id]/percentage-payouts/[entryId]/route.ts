export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { supportsInvoicePercentagePayouts } from "@/lib/invoice-percentage-payouts"
import { UserRole } from "@prisma/client"

const updateSchema = z.object({
  amount: z.number().positive().optional(),
  notes: z.string().optional().nullable(),
  userId: z.string().min(1).optional(),
})

async function resyncIfPaid(billId: string) {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: { status: true },
  })
  if (bill?.status !== "PAID") return
  try {
    const { resyncFinderAndManagementFeesForPaidBill } = await import("@/lib/attribution-fee-resync")
    await resyncFinderAndManagementFeesForPaidBill(billId)
  } catch (error) {
    console.error("Failed to resync fees after percentage payout update:", error)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const { id, entryId } = await params
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (!supportsInvoicePercentagePayouts()) {
      return NextResponse.json({ error: "Invoice percentage payout model is not available yet" }, { status: 400 })
    }

    const body = await request.json()
    const validated = updateSchema.parse(body)

    const existing = await (prisma as any).invoicePercentagePayout.findUnique({
      where: { id: entryId },
      select: { id: true, billId: true },
    })
    if (!existing || existing.billId !== id) {
      return NextResponse.json({ error: "Percentage payout entry not found" }, { status: 404 })
    }

    if (validated.userId) {
      const user = await prisma.user.findUnique({ where: { id: validated.userId }, select: { id: true } })
      if (!user) return NextResponse.json({ error: "Recipient user not found" }, { status: 404 })
    }

    const updated = await (prisma as any).invoicePercentagePayout.update({
      where: { id: entryId },
      data: {
        ...(validated.amount !== undefined ? { amount: validated.amount } : {}),
        ...(validated.notes !== undefined ? { notes: validated.notes || null } : {}),
        ...(validated.userId ? { userId: validated.userId } : {}),
      },
    })

    await resyncIfPaid(id)
    return NextResponse.json(updated)
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: "Failed to update invoice percentage payout", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const { id, entryId } = await params
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (!supportsInvoicePercentagePayouts()) {
      return NextResponse.json({ error: "Invoice percentage payout model is not available yet" }, { status: 400 })
    }

    const existing = await (prisma as any).invoicePercentagePayout.findUnique({
      where: { id: entryId },
      select: { id: true, billId: true },
    })
    if (!existing || existing.billId !== id) {
      return NextResponse.json({ error: "Percentage payout entry not found" }, { status: 404 })
    }

    await (prisma as any).invoicePercentagePayout.delete({ where: { id: entryId } })
    await resyncIfPaid(id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to delete invoice percentage payout", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}

