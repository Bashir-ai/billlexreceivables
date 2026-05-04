export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@prisma/client"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const fee = await prisma.managementFee.findUnique({
      where: { id },
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
        payments: true,
      },
    })

    if (!fee) {
      return NextResponse.json({ error: "Management fee not found" }, { status: 404 })
    }

    const canView =
      fee.recipientUserId === session.user.id ||
      session.user.role === UserRole.ADMIN ||
      session.user.role === UserRole.MANAGER

    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(fee)
  } catch (error) {
    console.error("Error fetching management fee:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
