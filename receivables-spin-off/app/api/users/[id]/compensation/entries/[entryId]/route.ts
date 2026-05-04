export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@prisma/client"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 })
    }

    const { id: userId, entryId } = await params

    const entry = await prisma.compensationEntry.findUnique({
      where: { id: entryId },
      select: { id: true, userId: true, periodYear: true, periodMonth: true },
    })

    if (!entry || entry.userId !== userId) {
      return NextResponse.json({ error: "Compensation entry not found" }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.userFinancialTransaction.deleteMany({
        where: {
          userId,
          relatedId: entryId,
          relatedType: "COMPENSATION_ENTRY",
        },
      })

      // Persist admin manual deletion intent so auto-sync doesn't recreate this period line.
      await tx.userFinancialTransaction.create({
        data: {
          userId,
          type: "ADJUSTMENT",
          relatedId: `${entry.periodYear}-${entry.periodMonth.toString().padStart(2, "0")}`,
          relatedType: "COMPENSATION_ENTRY_DELETED",
          amount: 0,
          currency: "EUR",
          transactionDate: new Date(),
          description: `Admin deleted compensation line for ${entry.periodYear}-${entry.periodMonth
            .toString()
            .padStart(2, "0")}`,
          createdBy: session.user.id,
        },
      })

      await tx.compensationEntry.delete({
        where: { id: entryId },
      })
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error deleting compensation entry:", error)
    return NextResponse.json(
      { error: error.message || "Failed to delete compensation entry" },
      { status: 500 }
    )
  }
}
