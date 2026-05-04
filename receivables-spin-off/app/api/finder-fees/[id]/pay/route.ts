export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@prisma/client"
import { z } from "zod"

const paymentSchema = z.object({
  amount: z.number().min(0.01),
  paymentDate: z.string().optional(),
  notes: z.string().optional().nullable(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json(
        { error: "Forbidden - Only admins and managers can record payments" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = paymentSchema.parse(body)

    // Get the finder fee
    const finderFee = await prisma.finderFee.findUnique({
      where: { id },
      include: {
        payments: true,
      },
    })

    if (!finderFee) {
      return NextResponse.json({ error: "Finder fee not found" }, { status: 404 })
    }

    // Calculate total paid so far
    const totalPaid = finderFee.payments.reduce((sum, payment) => sum + payment.amount, 0)
    const newTotalPaid = totalPaid + validatedData.amount
    const remainingAmount = finderFee.finderFeeAmount - newTotalPaid

    // Check if payment exceeds remaining amount
    if (newTotalPaid > finderFee.finderFeeAmount) {
      return NextResponse.json(
        { error: `Payment amount exceeds remaining amount. Maximum payment: ${finderFee.finderFeeAmount - totalPaid}` },
        { status: 400 }
      )
    }

    // Determine new status
    let newStatus: "PENDING" | "PARTIALLY_PAID" | "PAID" = "PENDING"
    if (remainingAmount <= 0) {
      newStatus = "PAID"
    } else if (newTotalPaid > 0) {
      newStatus = "PARTIALLY_PAID"
    }

    const paymentDate = validatedData.paymentDate
      ? new Date(validatedData.paymentDate)
      : new Date()

    const updatedFinderFee = await prisma.$transaction(async (tx) => {
      await tx.finderFeePayment.create({
        data: {
          finderFeeId: id,
          amount: validatedData.amount,
          paymentDate,
          notes: validatedData.notes || null,
          paidBy: session.user.id,
        },
      })

      const updated = await tx.finderFee.update({
        where: { id },
        data: {
          status: newStatus,
          paidAmount: newTotalPaid,
          remainingAmount: Math.max(0, remainingAmount),
          paidAt: newStatus === "PAID" ? new Date() : finderFee.paidAt,
        },
        include: {
          bill: {
            select: {
              id: true,
              invoiceNumber: true,
              amount: true,
              paidAt: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
              company: true,
            },
          },
          payments: {
            orderBy: {
              paymentDate: "desc",
            },
          },
        },
      })

      // Ledger: paying finder fee reduces running balance (same sign as compensation payouts).
      await tx.userFinancialTransaction.create({
        data: {
          userId: finderFee.finderId,
          type: "PAYMENT",
          relatedId: id,
          relatedType: "FINDER_FEE",
          amount: -validatedData.amount,
          currency: "EUR",
          transactionDate: paymentDate,
          description: `Finder fee payout — invoice ${updated.bill.invoiceNumber || updated.bill.id}`,
          notes: validatedData.notes || null,
          createdBy: session.user.id,
        },
      })

      return updated
    })

    return NextResponse.json(updatedFinderFee)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Validation errors:", JSON.stringify(error.errors, null, 2))
      return NextResponse.json(
        { 
          error: "Invalid input", 
          details: error.errors,
          message: error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")
        },
        { status: 400 }
      )
    }

    if (error instanceof Error) {
      console.error("Error recording payment:", error.message)
      if (error.stack) {
        console.error("Error stack:", error.stack)
      }
      return NextResponse.json(
        { error: "Internal server error", message: error.message },
        { status: 500 }
      )
    }

    console.error("Unknown error type:", typeof error)
    return NextResponse.json(
      { error: "Internal server error", message: "Unknown error" },
      { status: 500 }
    )
  }
}

