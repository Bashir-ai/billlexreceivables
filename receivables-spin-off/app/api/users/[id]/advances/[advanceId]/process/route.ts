export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@prisma/client"

function stepMonths(frequency: "MONTHLY" | "QUARTERLY" | "YEARLY" | null | undefined) {
  if (frequency === "QUARTERLY") return 3
  if (frequency === "YEARLY") return 12
  return 1
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; advanceId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Only admins and managers can process advances
    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden - Admin or Manager access required" }, { status: 403 })
    }

    const { id, advanceId } = await params
    const userId = id

    // Get advance
    const advance = await prisma.officeAdvance.findFirst({
      where: {
        id: advanceId,
        userId,
        isActive: true,
        type: "RECURRING",
      },
    })

    if (!advance) {
      return NextResponse.json({ error: "Recurring advance not found or inactive" }, { status: 404 })
    }

    // Check if advance should be processed (based on frequency and dates)
    const now = new Date()
    if (advance.endDate && now > advance.endDate) {
      // Advance has ended, deactivate it
      await prisma.officeAdvance.update({
        where: { id: advanceId },
        data: { isActive: false },
      })
      return NextResponse.json({ message: "Advance has ended and has been deactivated" })
    }

    const step = stepMonths(advance.frequency)
    const existingTx = await prisma.userFinancialTransaction.findMany({
      where: {
        userId,
        relatedId: advanceId,
        relatedType: "ADVANCE",
      },
      select: { transactionDate: true },
    })
    const existingKeys = new Set(existingTx.map((tx) => tx.transactionDate.toISOString().slice(0, 10)))
    const stopAt = advance.endDate && advance.endDate < now ? advance.endDate : now
    const cursor = new Date(advance.startDate)
    const rows: Array<any> = []

    while (cursor <= stopAt) {
      const key = cursor.toISOString().slice(0, 10)
      if (!existingKeys.has(key)) {
        rows.push({
          userId,
          type: "ADVANCE",
          relatedId: advanceId,
          relatedType: "ADVANCE",
          amount: -advance.amount,
          currency: advance.currency,
          transactionDate: new Date(cursor),
          description: advance.description,
          notes: `Recurring advance payment - ${advance.frequency}`,
          createdBy: session.user.id,
        })
      }
      cursor.setMonth(cursor.getMonth() + step)
    }

    if (rows.length === 0) {
      return NextResponse.json({
        message: "No missing advance transactions to process",
      })
    }

    await prisma.userFinancialTransaction.createMany({ data: rows })
    return NextResponse.json({ createdCount: rows.length }, { status: 201 })
  } catch (error: any) {
    console.error("Error processing advance:", error)
    return NextResponse.json(
      { error: error.message || "Failed to process advance" },
      { status: 500 }
    )
  }
}
