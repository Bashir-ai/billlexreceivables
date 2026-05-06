export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { supportsInvoicePercentagePayouts } from "@/lib/invoice-percentage-payouts"
import { UserRole } from "@prisma/client"

const createSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive(),
  notes: z.string().optional().nullable(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!supportsInvoicePercentagePayouts()) return NextResponse.json([])

    const bill = await prisma.bill.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, clientId: true },
    })
    if (!bill) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

    const rows = await (prisma as any).invoicePercentagePayout.findMany({
      where: { billId: id },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(rows)
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch invoice percentage payouts", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (!supportsInvoicePercentagePayouts()) {
      return NextResponse.json({ error: "Invoice percentage payout model is not available yet" }, { status: 400 })
    }

    const body = await request.json()
    const validated = createSchema.parse(body)

    const bill = await prisma.bill.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    })
    if (!bill) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

    const user = await prisma.user.findUnique({
      where: { id: validated.userId },
      select: { id: true },
    })
    if (!user) return NextResponse.json({ error: "Recipient user not found" }, { status: 404 })

    const created = await (prisma as any).invoicePercentagePayout.create({
      data: {
        billId: id,
        userId: validated.userId,
        amount: validated.amount,
        notes: validated.notes || null,
        createdBy: session.user.id,
      },
    })

    if (bill.status === "PAID") {
      try {
        const { resyncFinderAndManagementFeesForPaidBill } = await import("@/lib/attribution-fee-resync")
        await resyncFinderAndManagementFeesForPaidBill(id)
      } catch (error) {
        console.error("Failed to resync fees after percentage payout creation:", error)
      }
    }

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: "Failed to create invoice percentage payout", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}

