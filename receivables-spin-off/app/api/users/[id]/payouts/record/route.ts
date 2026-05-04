import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { UserRole } from "@prisma/client"

const recordPayoutSchema = z.object({
  kind: z.enum(["COMPENSATION_ENTRY", "FRINGE_BENEFIT_OCCURRENCE"]),
  compensationEntryId: z.string().optional(),
  fringeBenefitOccurrenceId: z.string().optional(),
  amount: z.number().gt(0),
  paymentDate: z.string().optional(),
  notes: z.string().optional().nullable(),
})

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
      return NextResponse.json({ error: "Forbidden - Admin/Manager access required" }, { status: 403 })
    }

    const body = await request.json()
    const validated = recordPayoutSchema.parse(body)

    const actingUserId = session.user.id
    const payoutDate = validated.paymentDate ? new Date(validated.paymentDate) : new Date()

    if (validated.kind === "COMPENSATION_ENTRY") {
      if (!validated.compensationEntryId) {
        return NextResponse.json({ error: "compensationEntryId is required" }, { status: 400 })
      }

      const entry = await prisma.compensationEntry.findUnique({
        where: { id: validated.compensationEntryId },
      })

      if (!entry || entry.userId !== userId) {
        return NextResponse.json({ error: "Compensation entry not found" }, { status: 404 })
      }

      if (entry.balance <= 0) {
        return NextResponse.json(
          { error: "This compensation entry is not payable (balance <= 0)" },
          { status: 400 }
        )
      }

      if (validated.amount > entry.balance) {
        return NextResponse.json(
          { error: `Payment exceeds remaining payable balance. Max: ${entry.balance}` },
          { status: 400 }
        )
      }

      const newTotalPaid = entry.totalPaid + validated.amount
      const newBalance = entry.totalEarned - newTotalPaid

      const updatedEntry = await prisma.compensationEntry.update({
        where: { id: entry.id },
        data: {
          totalPaid: newTotalPaid,
          balance: newBalance,
        },
      })

      const tx = await prisma.userFinancialTransaction.create({
        data: {
          userId,
          type: "PAYMENT",
          relatedId: entry.id,
          relatedType: "COMPENSATION_ENTRY",
          amount: -validated.amount, // Office pays out to user => debit user balance.
          currency: "EUR",
          transactionDate: payoutDate,
          description: `Compensation payout for ${entry.periodYear}-${entry.periodMonth
            .toString()
            .padStart(2, "0")}`,
          notes: validated.notes || null,
          createdBy: actingUserId,
        },
      })

      return NextResponse.json({ entry: updatedEntry, transaction: tx })
    }

    if (validated.kind === "FRINGE_BENEFIT_OCCURRENCE") {
      if (!validated.fringeBenefitOccurrenceId) {
        return NextResponse.json({ error: "fringeBenefitOccurrenceId is required" }, { status: 400 })
      }

      const occurrence = await prisma.fringeBenefitOccurrence.findUnique({
        where: { id: validated.fringeBenefitOccurrenceId },
      })

      if (!occurrence || occurrence.userId !== userId) {
        return NextResponse.json({ error: "Benefit occurrence not found" }, { status: 404 })
      }

      if (occurrence.remainingAmount <= 0) {
        return NextResponse.json(
          { error: "This benefit occurrence has no remaining amount" },
          { status: 400 }
        )
      }

      if (validated.amount > occurrence.remainingAmount) {
        return NextResponse.json(
          { error: `Payment exceeds remaining amount. Max: ${occurrence.remainingAmount}` },
          { status: 400 }
        )
      }

      const newPaidAmount = occurrence.paidAmount + validated.amount
      const newRemainingAmount = occurrence.remainingAmount - validated.amount

      const updatedOccurrence = await prisma.fringeBenefitOccurrence.update({
        where: { id: occurrence.id },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount,
          paidAt: payoutDate,
          paidBy: actingUserId,
          status: newRemainingAmount <= 0 ? "PAID" : "PARTIALLY_PAID",
        },
      })

      const tx = await prisma.userFinancialTransaction.create({
        data: {
          userId,
          type: "PAYMENT",
          relatedId: occurrence.id,
          relatedType: "FRINGE_BENEFIT_OCCURRENCE",
          amount: -validated.amount,
          currency: occurrence.currency || "EUR",
          transactionDate: payoutDate,
          description: `Benefit payout (${updatedOccurrence.id})`,
          notes: validated.notes || null,
          createdBy: actingUserId,
        },
      })

      return NextResponse.json({ occurrence: updatedOccurrence, transaction: tx })
    }

    return NextResponse.json({ error: "Invalid payout kind" }, { status: 400 })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    console.error("Error recording payout:", error)
    return NextResponse.json({ error: "Internal server error", message: error?.message || String(error) }, { status: 500 })
  }
}

