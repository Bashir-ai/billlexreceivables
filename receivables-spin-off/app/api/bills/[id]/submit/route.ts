export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { BillStatus } from "@prisma/client"

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

    if (session.user.role === "CLIENT") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      )
    }

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        client: true,
        lead: {
          select: {
            id: true,
            name: true,
            company: true,
          },
        },
        creator: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        proposal: {
          select: {
            id: true,
            title: true,
            proposalNumber: true,
          },
        },
      },
    })

    if (!bill) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Only invoice creator can submit
    if (bill.createdBy !== session.user.id && session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only the invoice creator can submit it" },
        { status: 403 }
      )
    }

    // Only draft invoices can be submitted
    if (bill.status !== BillStatus.DRAFT) {
      return NextResponse.json(
        { error: "Only draft invoices can be submitted" },
        { status: 400 }
      )
    }

    const updatedBill = await prisma.bill.update({
      where: { id },
      data: {
        // Internal-only flow: submission auto-approves invoice.
        status: BillStatus.APPROVED,
        submittedAt: new Date(),
        approvedAt: new Date(),
        internalApprovalRequired: false,
        internalApprovalsComplete: true,
        requiredApproverIds: [],
      },
      include: {
        client: true,
        creator: true,
      },
    })

    return NextResponse.json(updatedBill)
  } catch (error: any) {
    console.error("Error submitting invoice:", error)
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    )
  }
}



