export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { UpfrontPaymentType } from "@prisma/client"
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

    // Get proposal with payment terms
    // Note: We need to check for upfront invoices differently if schema isn't updated
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: {
        client: true,
        paymentTerms: {
          where: {
            upfrontType: { not: null },
            upfrontValue: { not: null },
          },
        },
        bills: {
          select: {
            id: true,
          },
        },
      },
    })

    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
    }

    // Check if proposal is approved
    if (proposal.clientApprovalStatus !== "APPROVED") {
      return NextResponse.json(
        { error: "Proposal must be approved before generating upfront payment invoice" },
        { status: 400 }
      )
    }

    // Check if upfront invoice already exists
    // Query all bills for this proposal (don't select isUpfrontPayment to avoid errors if field doesn't exist)
    // We'll check the field existence when creating the invoice instead
    const allBills = await prisma.bill.findMany({
      where: {
        proposalId: proposal.id,
      },
      select: { 
        id: true,
      },
    })
    
    // For now, we'll skip the upfront check if the field doesn't exist
    // After migration, this will be properly checked
    let upfrontInvoices: any[] = []
    if (allBills.length > 0) {
      // Try to check if any are upfront invoices
      try {
        const billsWithField = await prisma.bill.findMany({
          where: {
            proposalId: proposal.id,
            isUpfrontPayment: true,
          },
          select: { id: true },
        })
        upfrontInvoices = billsWithField
      } catch (err: any) {
        // Field doesn't exist yet - assume no upfront invoices
        upfrontInvoices = []
      }
    }
    
    if (upfrontInvoices.length > 0) {
      return NextResponse.json(
        { error: "Upfront payment invoice already exists for this proposal" },
        { status: 400 }
      )
    }

    // Find payment term with upfront payment
    const upfrontPaymentTerm = proposal.paymentTerms.find(
      pt => pt.upfrontType && pt.upfrontValue
    )

    if (!upfrontPaymentTerm) {
      return NextResponse.json(
        { error: "No upfront payment configured for this proposal" },
        { status: 400 }
      )
    }

    // Calculate upfront amount
    let upfrontAmount = 0
    if (upfrontPaymentTerm.upfrontType === UpfrontPaymentType.PERCENT) {
      // Calculate percentage of proposal total
      const proposalTotal = proposal.amount || 0
      upfrontAmount = (proposalTotal * (upfrontPaymentTerm.upfrontValue || 0)) / 100
    } else if (upfrontPaymentTerm.upfrontType === UpfrontPaymentType.FIXED_AMOUNT) {
      upfrontAmount = upfrontPaymentTerm.upfrontValue || 0
    }

    if (upfrontAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid upfront payment amount" },
        { status: 400 }
      )
    }

    // Generate invoice number: PROP-2024-001 -> INV-2024-001-1
    let invoiceNumber: string | null = null
    if (proposal.proposalNumber) {
      const proposalNum = proposal.proposalNumber
      if (proposalNum.startsWith("PROP-")) {
        invoiceNumber = proposalNum.replace("PROP-", "INV-") + "-1"
      } else {
        invoiceNumber = proposalNum + "-1"
      }
    }

    // Check if invoice number already exists
    if (invoiceNumber) {
      const existingInvoice = await prisma.bill.findUnique({
        where: { invoiceNumber },
      })
      if (existingInvoice) {
        // If exists, find next available number
        const existingInvoices = await prisma.bill.findMany({
          where: {
            proposalId: proposal.id,
          },
          select: {
            invoiceNumber: true,
          },
        })
        
        let suffix = 1
        let testNumber = invoiceNumber
        while (existingInvoices.some(b => b.invoiceNumber === testNumber)) {
          suffix++
          if (proposal.proposalNumber?.startsWith("PROP-")) {
            testNumber = proposal.proposalNumber.replace("PROP-", "INV-") + `-${suffix}`
          } else {
            testNumber = (proposal.proposalNumber || "") + `-${suffix}`
          }
        }
        invoiceNumber = testNumber
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
      discountValue = (upfrontAmount * discountPercent) / 100
    } else if (discountAmount && discountAmount > 0) {
      // Apply proportional discount to upfront payment
      const proposalTotal = proposal.amount || upfrontAmount
      discountValue = (upfrontAmount * discountAmount) / proposalTotal
    }

    const afterDiscount = upfrontAmount - discountValue

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

    // Ensure clientId exists (Bill requires non-null clientId)
    const clientId = proposal.clientId
    if (!clientId) {
      return NextResponse.json(
        { error: "Cannot create invoice: proposal has no client assigned" },
        { status: 400 }
      )
    }

    // Create upfront payment invoice
    const invoice = await prisma.bill.create({
      data: {
        proposalId: proposal.id,
        clientId: clientId,
        createdBy: session.user.id,
        subtotal: upfrontAmount,
        amount: finalAmount,
        invoiceNumber: invoiceNumber,
        taxInclusive: taxInclusive,
        taxRate: taxRate,
        discountPercent: discountPercent,
        discountAmount: discountAmount,
        isUpfrontPayment: true,
        status: "DRAFT",
        items: {
          create: {
            type: "CHARGE",
            description: `Upfront Payment - ${proposal.title}`,
            quantity: 1,
            unitPrice: upfrontAmount,
            amount: upfrontAmount,
            isCredit: false,
          },
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

    return NextResponse.json({
      success: true,
      invoice,
      message: "Upfront payment invoice generated successfully",
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error generating upfront invoice:", error)
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack,
    })
    
    // Check if it's a Prisma error about missing fields
    if (error.code === "P2021" || error.code === "P2016" || 
        error.message?.includes("Unknown field") || 
        error.message?.includes("isUpfrontPayment") ||
        error.message?.includes("isCredit") ||
        error.message?.includes("creditApplied")) {
      return NextResponse.json(
        { 
          error: "⚠️ DATABASE MIGRATION REQUIRED ⚠️",
          message: "The database schema needs to be updated before you can generate upfront invoices.",
          action: "STOP_YOUR_SERVER_AND_RUN_MIGRATION",
          steps: [
            {
              step: 1,
              action: "Stop your development server",
              command: "Press Ctrl+C in the terminal where 'npm run dev' is running"
            },
            {
              step: 2,
              action: "Run the migration",
              command: "npm run db:migrate-upfront"
            },
            {
              step: 3,
              action: "Restart your server",
              command: "npm run dev"
            },
            {
              step: 4,
              action: "Try again",
              command: "Go back to the proposal and click 'Generate Upfront Payment Invoice'"
            }
          ],
          alternative: "Or run manually: npx prisma db push && npx prisma generate",
          fieldsNeeded: {
            Bill: ["isUpfrontPayment", "creditApplied", "relatedInvoiceId"],
            BillItem: ["isCredit"]
          },
          technicalDetails: {
            error: error.message,
            code: error.code,
            hint: "This error occurs because the Prisma client is trying to use database fields that don't exist yet. Running the migration will add these fields to your database."
          }
        },
        { status: 500 }
      )
    }
    
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    )
  }
}

