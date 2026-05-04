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

    const invoice = await prisma.bill.findUnique({
      where: { id },
      include: {
        client: true,
        creator: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    if (invoice.status !== BillStatus.SUBMITTED && invoice.status !== BillStatus.DRAFT) {
      return NextResponse.json(
        { error: "Only draft or submitted invoices can be resubmitted" },
        { status: 400 }
      )
    }

    // Update invoice with resubmission tracking
    const updatedInvoice = await prisma.bill.update({
      where: { id },
      data: {
        status: BillStatus.APPROVED,
        approvedAt: new Date(),
        submittedAt: invoice.submittedAt || new Date(),
        internalApprovalRequired: false,
        internalApprovalsComplete: true,
        requiredApproverIds: [],
        resubmittedAt: new Date(),
        resubmittedBy: session.user.id,
        resubmissionCount: invoice.resubmissionCount + 1,
      },
      include: {
        client: true,
        creator: true,
      },
    })

    return NextResponse.json(updatedInvoice)
  } catch (error: any) {
    console.error("Error resubmitting invoice:", error)
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    )
  }
}






