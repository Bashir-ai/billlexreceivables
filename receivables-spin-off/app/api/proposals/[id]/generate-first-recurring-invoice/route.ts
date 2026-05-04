export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { generateInvoiceNumber } from "@/lib/invoice-number"
import { RecurringPaymentFrequency } from "@prisma/client"
import { createBillAttributionSnapshot } from "@/lib/bill-attribution"

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

    // Get proposal with items and payment terms
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: {
        client: true,
        items: {
          where: {
            billingMethod: "RECURRING",
            recurringEnabled: true,
          },
        },
        paymentTerms: true,
      },
    })

    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    // Check if proposal is approved
    if (proposal.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Proposal must be approved before generating recurring invoice" },
        { status: 400 }
      )
    }

    // Check if proposal has recurring enabled (proposal-level or item-level)
    const hasProposalLevelRecurring = proposal.recurringEnabled && proposal.recurringFrequency
    const hasItemLevelRecurring = proposal.items.length > 0

    if (!hasProposalLevelRecurring && !hasItemLevelRecurring) {
      return NextResponse.json(
        { error: "This proposal does not have recurring billing enabled" },
        { status: 400 }
      )
    }

    // Check if first invoice already generated
    if (proposal.lastRecurringInvoiceDate) {
      return NextResponse.json(
        { error: "First recurring invoice has already been generated for this proposal" },
        { status: 400 }
      )
    }

    // Calculate invoice amount
    let invoiceAmount = 0
    let description = ""

    if (hasProposalLevelRecurring) {
      // Proposal-level recurring: use proposal amount
      invoiceAmount = proposal.amount || 0
      description = `Recurring Payment - ${proposal.title}`
    } else if (hasItemLevelRecurring) {
      // Item-level recurring: sum of recurring items
      invoiceAmount = proposal.items.reduce((sum, item) => sum + (item.amount || 0), 0)
      const itemDescriptions = proposal.items.map(item => item.description).join(", ")
      description = `Recurring Payment - ${itemDescriptions}`
    }

    if (invoiceAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid invoice amount" },
        { status: 400 }
      )
    }

    // Generate invoice number
    let invoiceNumber: string | null = null
    if (proposal.proposalNumber) {
      const proposalNum = proposal.proposalNumber
      if (proposalNum.startsWith("PROP-")) {
        invoiceNumber = proposalNum.replace("PROP-", "INV-") + "-R1"
      } else {
        invoiceNumber = proposalNum + "-R1"
      }
    } else {
      invoiceNumber = await generateInvoiceNumber()
    }

    // Check if invoice number already exists
    if (invoiceNumber) {
      const existingInvoice = await prisma.bill.findUnique({
        where: { invoiceNumber },
      })
      if (existingInvoice) {
        invoiceNumber = await generateInvoiceNumber()
      }
    }

    // Calculate tax and discount (inherit from proposal)
    const taxInclusive = proposal.taxInclusive || false
    const taxRate = proposal.taxRate || null
    const discountPercent = proposal.clientDiscountPercent || null
    const discountAmount = proposal.clientDiscountAmount || null

    // Calculate discount
    let discountValue = 0
    if (discountPercent && discountPercent > 0) {
      discountValue = (invoiceAmount * discountPercent) / 100
    } else if (discountAmount && discountAmount > 0) {
      // Apply proportional discount
      const proposalTotal = proposal.amount || invoiceAmount
      discountValue = (invoiceAmount * discountAmount) / proposalTotal
    }

    const afterDiscount = invoiceAmount - discountValue

    // Calculate tax
    let taxAmount = 0
    let finalAmount = afterDiscount

    if (taxRate && taxRate > 0) {
      if (taxInclusive) {
        taxAmount = (afterDiscount * taxRate) / (100 + taxRate)
        finalAmount = afterDiscount
      } else {
        taxAmount = (afterDiscount * taxRate) / 100
        finalAmount = afterDiscount + taxAmount
      }
    }

    // Ensure we have a clientId
    if (!proposal.clientId && !proposal.client?.id) {
      return NextResponse.json(
        { error: "Proposal must be associated with a client" },
        { status: 400 }
      )
    }

    // Create recurring payment invoice
    const invoice = await prisma.bill.create({
      data: {
        proposalId: proposal.id,
        clientId: proposal.clientId || proposal.client!.id,
        createdBy: session.user.id,
        subtotal: invoiceAmount,
        amount: finalAmount,
        invoiceNumber: invoiceNumber,
        description: description,
        taxInclusive: taxInclusive,
        taxRate: taxRate,
        discountPercent: discountPercent,
        discountAmount: discountAmount,
        status: "DRAFT",
        items: {
          create: proposal.items.map(item => ({
            type: "CHARGE",
            description: item.description,
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || item.amount,
            amount: item.amount,
            isCredit: false,
          })),
        },
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        proposal: {
          select: {
            id: true,
            proposalNumber: true,
          },
        },
      },
    })
    await createBillAttributionSnapshot({
      tx: prisma,
      billId: invoice.id,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
    })

    // Update proposal's lastRecurringInvoiceDate
    await prisma.proposal.update({
      where: { id },
      data: {
        lastRecurringInvoiceDate: new Date(),
      },
    })

    // Update item-level lastRecurringInvoiceDate for recurring items
    if (hasItemLevelRecurring) {
      await prisma.proposalItem.updateMany({
        where: {
          id: { in: proposal.items.map(item => item.id) },
          recurringEnabled: true,
        },
        data: {
          lastRecurringInvoiceDate: new Date(),
        },
      })
    }

    return NextResponse.json({
      success: true,
      invoice,
      message: "First recurring invoice generated successfully",
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error generating first recurring invoice:", error)
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    )
  }
}

