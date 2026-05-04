export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { UserRole, AdvanceType, AdvanceFrequency } from "@prisma/client"

function advanceStepMonths(frequency: AdvanceFrequency | null | undefined): number {
  if (frequency === "QUARTERLY") return 3
  if (frequency === "YEARLY") return 12
  return 1
}

const updateAdvanceSchema = z.object({
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().optional(),
  startDate: z.string().transform((str) => new Date(str)).optional(),
  endDate: z.string().transform((str) => new Date(str)).nullable().optional(),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).nullable().optional(),
  isActive: z.boolean().optional(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; advanceId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Only admins and managers can update advances
    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden - Admin or Manager access required" }, { status: 403 })
    }

    const { id, advanceId } = await params
    const userId = id
    const body = await request.json()
    const validatedData = updateAdvanceSchema.parse(body)

    // Verify advance belongs to user
    const existingAdvance = await prisma.officeAdvance.findFirst({
      where: {
        id: advanceId,
        userId,
      },
    })

    if (!existingAdvance) {
      return NextResponse.json({ error: "Advance not found" }, { status: 404 })
    }

    // Update advance
    const advance = await prisma.officeAdvance.update({
      where: { id: advanceId },
      data: {
        description: validatedData.description,
        amount: validatedData.amount,
        currency: validatedData.currency,
        startDate: validatedData.startDate,
        endDate: validatedData.endDate,
        frequency: validatedData.frequency as AdvanceFrequency | null,
        isActive: validatedData.isActive,
      },
    })

    // Keep historical advance ledger rows aligned with the latest advance definition.
    await prisma.userFinancialTransaction.updateMany({
      where: {
        userId,
        relatedId: advance.id,
        relatedType: "ADVANCE",
      },
      data: {
        amount: -advance.amount,
        currency: advance.currency,
        description: advance.description,
      },
    })

    // If recurring and active, backfill any missing historical occurrences after edits.
    if (
      advance.type === "RECURRING" &&
      advance.isActive &&
      advance.frequency
    ) {
      const stopAt = advance.endDate && advance.endDate < new Date() ? advance.endDate : new Date()
      const step = advanceStepMonths(advance.frequency)
      const existingTx = await prisma.userFinancialTransaction.findMany({
        where: {
          userId,
          relatedId: advance.id,
          relatedType: "ADVANCE",
        },
        select: { transactionDate: true },
      })
      const existingDateKeys = new Set(
        existingTx.map((tx) => tx.transactionDate.toISOString().slice(0, 10))
      )
      const cursor = new Date(advance.startDate)
      const missingRows: Array<{
        userId: string
        type: "ADVANCE"
        relatedId: string
        relatedType: "ADVANCE"
        amount: number
        currency: string
        transactionDate: Date
        description: string
        notes: string
        createdBy: string
      }> = []
      while (cursor <= stopAt) {
        const key = cursor.toISOString().slice(0, 10)
        if (!existingDateKeys.has(key)) {
          missingRows.push({
            userId,
            type: "ADVANCE",
            relatedId: advance.id,
            relatedType: "ADVANCE",
            amount: -advance.amount,
            currency: advance.currency,
            transactionDate: new Date(cursor),
            description: advance.description,
            notes: `Recurring advance backfill - ${advance.frequency}`,
            createdBy: session.user.id,
          })
        }
        cursor.setMonth(cursor.getMonth() + step)
      }
      if (missingRows.length > 0) {
        await prisma.userFinancialTransaction.createMany({ data: missingRows })
      }
    }

    return NextResponse.json({ advance })
  } catch (error: any) {
    console.error("Error updating advance:", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: error.message || "Failed to update advance" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; advanceId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Only admins can permanently delete advances
    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 })
    }

    const { id, advanceId } = await params
    const userId = id

    // Verify advance belongs to user
    const existingAdvance = await prisma.officeAdvance.findFirst({
      where: {
        id: advanceId,
        userId,
      },
    })

    if (!existingAdvance) {
      return NextResponse.json({ error: "Advance not found" }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.userFinancialTransaction.deleteMany({
        where: {
          userId,
          relatedId: advanceId,
          relatedType: "ADVANCE",
        },
      })

      await tx.officeAdvance.delete({
        where: { id: advanceId },
      })
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error deleting advance:", error)
    return NextResponse.json(
      { error: error.message || "Failed to delete advance" },
      { status: 500 }
    )
  }
}
