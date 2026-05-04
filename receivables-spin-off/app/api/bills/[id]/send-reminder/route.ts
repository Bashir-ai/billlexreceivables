export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { sendPaymentReminderEmail } from "@/lib/email"
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

    const body = await request.json()
    const reminderNumber = body.reminderNumber || 1

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        client: true,
        lead: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
          },
        },
        project: {
          select: {
            currency: true,
          },
        },
        proposal: {
          select: {
            currency: true,
          },
        },
      },
    })

    if (!bill) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Determine recipient email and name (from client or lead)
    const recipientEmail = bill.client?.email || bill.lead?.email
    const recipientName = bill.client?.name || bill.lead?.name || bill.client?.company || bill.lead?.company || ""

    if (!recipientEmail) {
      const entityType = bill.client ? "client" : "lead"
      return NextResponse.json(
        { error: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} email is not set. Please update the ${entityType} information first.` },
        { status: 400 }
      )
    }

    // Calculate days overdue
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dueDate = bill.dueDate ? new Date(bill.dueDate) : null
    
    // Only send reminders for collectible outstanding invoices
    if (!dueDate || dueDate >= today) {
      return NextResponse.json({ error: "Invoice is not outstanding" }, { status: 400 })
    }
    const nonCollectibleStatuses: BillStatus[] = [
      BillStatus.PAID,
      BillStatus.CANCELLED,
      BillStatus.WRITTEN_OFF,
    ]
    if (nonCollectibleStatuses.includes(bill.status)) {
      return NextResponse.json({ error: "Invoice is not collectible" }, { status: 400 })
    }

    const daysOverdue = dueDate && dueDate < today
      ? Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      : undefined

    // Send reminder email
    const result = await sendPaymentReminderEmail(
      recipientEmail,
      recipientName,
      {
        id: bill.id,
        invoiceNumber: bill.invoiceNumber,
        amount: bill.amount,
        dueDate: bill.dueDate,
        currency: bill.project?.currency || bill.proposal?.currency || "EUR",
        daysOverdue,
      },
      reminderNumber
    )

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to send reminder email" },
        { status: 500 }
      )
    }

    // Update last reminder sent date
    await prisma.bill.update({
      where: { id },
      data: {
        lastReminderSentAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      message: "Payment reminder email sent successfully",
    })
  } catch (error: any) {
    console.error("Error sending payment reminder:", error)
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    )
  }
}



