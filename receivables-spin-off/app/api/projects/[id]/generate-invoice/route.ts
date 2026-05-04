export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
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

    // Get project with proposal and all unbilled items
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        proposal: {
          select: {
            id: true,
            proposalNumber: true,
            currency: true,
            taxInclusive: true,
            taxRate: true,
            clientDiscountPercent: true,
            clientDiscountAmount: true,
          },
        },
        client: true,
        timesheetEntries: {
          where: {
            billable: true,
            billed: false,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        charges: {
          where: {
            billed: false,
          },
        },
        expenses: {
          where: {
            isBillable: true,
            billedAt: null,
          },
          include: {
            creator: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    // Check if there are any unbilled items
    const unbilledTimesheetEntries = project.timesheetEntries || []
    const unbilledCharges = project.charges || []
    const unbilledExpenses = project.expenses || []

    if (unbilledTimesheetEntries.length === 0 && unbilledCharges.length === 0 && unbilledExpenses.length === 0) {
      return NextResponse.json(
        { error: "No unbilled items to invoice" },
        { status: 400 }
      )
    }

    // Calculate subtotal from all items (before discount and tax)
    const timesheetTotal = unbilledTimesheetEntries.reduce(
      (sum, entry) => sum + (entry.hours * (entry.rate || 0)),
      0
    )
    const chargesTotal = unbilledCharges.reduce(
      (sum, charge) => sum + charge.amount,
      0
    )
    const expensesTotal = unbilledExpenses.reduce(
      (sum, expense) => sum + expense.amount,
      0
    )
    let subtotal = timesheetTotal + chargesTotal + expensesTotal

    // Check for paid upfront invoices to apply as credits
    const paidUpfrontInvoices = await prisma.bill.findMany({
      where: {
        proposalId: project.proposalId,
        isUpfrontPayment: true,
        status: "PAID",
      },
      orderBy: { createdAt: "asc" },
    })

    // Calculate total available credit (amount - creditApplied for each upfront invoice)
    let totalCreditAvailable = 0
    const creditsToApply: Array<{ invoiceId: string; invoiceNumber: string | null; amount: number }> = []
    
    for (const upfrontInvoice of paidUpfrontInvoices) {
      const availableCredit = upfrontInvoice.amount - upfrontInvoice.creditApplied
      if (availableCredit > 0) {
        totalCreditAvailable += availableCredit
        creditsToApply.push({
          invoiceId: upfrontInvoice.id,
          invoiceNumber: upfrontInvoice.invoiceNumber,
          amount: availableCredit,
        })
      }
    }

    // Cap credit at invoice subtotal (can't have negative total)
    const creditToApply = Math.min(totalCreditAvailable, subtotal)

    // Inherit tax settings from proposal (can be modified later)
    const taxInclusive = project.proposal?.taxInclusive || false
    const taxRate = project.proposal?.taxRate || null
    const discountPercent = project.proposal?.clientDiscountPercent || null
    const discountAmount = project.proposal?.clientDiscountAmount || null

    // Apply credit to subtotal (credit reduces the amount before discount and tax)
    subtotal = subtotal - creditToApply

    // Calculate discount
    let discountValue = 0
    if (discountPercent && discountPercent > 0) {
      discountValue = (subtotal * discountPercent) / 100
    } else if (discountAmount && discountAmount > 0) {
      discountValue = discountAmount
    }

    const afterDiscount = subtotal - discountValue

    // Calculate tax
    let taxAmount = 0
    let finalAmount = afterDiscount

    if (taxRate && taxRate > 0) {
      if (taxInclusive) {
        // Tax is included in the amount, so extract it
        taxAmount = (afterDiscount * taxRate) / (100 + taxRate)
        finalAmount = afterDiscount // Amount already includes tax
      } else {
        // Tax is added on top
        taxAmount = (afterDiscount * taxRate) / 100
        finalAmount = afterDiscount + taxAmount
      }
    }

    // Generate invoice number with sequential suffix
    // Check existing invoices for this proposal to determine next suffix
    const existingInvoices = await prisma.bill.findMany({
      where: {
        proposalId: project.proposalId,
      },
      select: {
        invoiceNumber: true,
        isUpfrontPayment: true,
      },
      orderBy: { createdAt: "asc" },
    })

    let invoiceNumber: string | null = null
    if (project.proposal?.proposalNumber) {
      const proposalNum = project.proposal.proposalNumber
      let baseNumber: string
      
      // Replace "PROP" prefix with "INV" if it exists
      if (proposalNum.startsWith("PROP-")) {
        baseNumber = proposalNum.replace("PROP-", "INV-")
      } else {
        baseNumber = proposalNum
      }

      // Determine next suffix number
      // Count existing invoices (upfront payment is -1, first project invoice is -2, etc.)
      const invoiceCount = existingInvoices.length
      // If upfront payment exists, next is -2, otherwise -1
      const hasUpfront = existingInvoices.some(b => b.isUpfrontPayment)
      const suffix = hasUpfront ? invoiceCount + 1 : invoiceCount + 1
      
      invoiceNumber = `${baseNumber}-${suffix}`
    }

    // Check if invoice number already exists (shouldn't happen, but safety check)
    if (invoiceNumber) {
      const existingInvoice = await prisma.bill.findUnique({
        where: { invoiceNumber },
      })
      if (existingInvoice) {
        // Find next available number
        let suffix = 1
        let testNumber = invoiceNumber
        const baseNumber = invoiceNumber.split("-").slice(0, -1).join("-")
        while (existingInvoices.some(b => b.invoiceNumber === testNumber)) {
          suffix++
          testNumber = `${baseNumber}-${suffix}`
        }
        invoiceNumber = testNumber
      }
    }

    // Prepare credit line items
    const creditLineItems: any[] = []
    if (creditToApply > 0 && creditsToApply.length > 0) {
      let remainingCredit = creditToApply
      for (let i = 0; i < creditsToApply.length && remainingCredit > 0; i++) {
        const credit = creditsToApply[i]
        const creditAmount = Math.min(credit.amount, remainingCredit)
        if (creditAmount > 0) {
          creditLineItems.push({
            type: "CHARGE",
            description: `Credit from upfront payment${credit.invoiceNumber ? ` (${credit.invoiceNumber})` : ""}`,
            quantity: 1,
            unitPrice: -creditAmount,
            amount: -creditAmount,
            isCredit: true,
          })
          remainingCredit -= creditAmount
        }
      }
    }

    // Create invoice with credit line items
    const invoice = await prisma.bill.create({
      data: {
        proposalId: project.proposalId,
        projectId: project.id,
        clientId: project.clientId,
        createdBy: session.user.id,
        subtotal: subtotal + creditToApply, // Subtotal before credit (for display)
        amount: finalAmount,
        invoiceNumber: invoiceNumber,
        taxInclusive: taxInclusive,
        taxRate: taxRate,
        discountPercent: discountPercent,
        discountAmount: discountAmount,
        status: "DRAFT",
        items: {
          create: creditLineItems, // Credit line items created first
        },
      },
      include: {
        proposal: {
          select: {
            id: true,
            proposalNumber: true,
          },
        },
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        items: true,
      },
    })
    await createBillAttributionSnapshot({
      tx: prisma,
      billId: invoice.id,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
    })

    // Create BillItems for timesheet entries
    if (unbilledTimesheetEntries.length > 0) {
      await prisma.billItem.createMany({
        data: unbilledTimesheetEntries.map(entry => ({
          billId: invoice.id,
          type: "TIMESHEET",
          timesheetEntryId: entry.id,
          personId: entry.userId,
          description: entry.description || `Hours worked by ${entry.user.name}`,
          quantity: entry.hours,
          rate: entry.rate || 0,
          amount: entry.hours * (entry.rate || 0),
          isCredit: false,
          date: entry.date,
        })),
      })

      // Mark timesheet entries as billed
      await prisma.timesheetEntry.updateMany({
        where: {
          id: {
            in: unbilledTimesheetEntries.map(e => e.id),
          },
        },
        data: {
          billed: true,
        },
      })
    }

    // Create BillItems for charges
    if (unbilledCharges.length > 0) {
      await prisma.billItem.createMany({
        data: unbilledCharges.map(charge => ({
          billId: invoice.id,
          type: "CHARGE",
          chargeId: charge.id,
          description: charge.description,
          quantity: charge.quantity || 1,
          unitPrice: charge.unitPrice || charge.amount,
          amount: charge.amount,
          isCredit: false,
        })),
      })

      // Mark charges as billed
      await prisma.projectCharge.updateMany({
        where: {
          id: {
            in: unbilledCharges.map(c => c.id),
          },
        },
        data: {
          billed: true,
        },
      })
    }

      // Create BillItems for expenses
    if (unbilledExpenses.length > 0) {
      await prisma.billItem.createMany({
        data: unbilledExpenses.map(expense => ({
          billId: invoice.id,
          type: "CHARGE",
          description: expense.isReimbursement 
            ? `Reimbursement: ${expense.description}`
            : expense.description,
          quantity: 1,
          unitPrice: expense.amount,
          amount: expense.amount,
          isCredit: false,
        })),
      })

      // Mark expenses as billed
      await prisma.projectExpense.updateMany({
        where: {
          id: {
            in: unbilledExpenses.map(e => e.id),
          },
        },
        data: {
          billedAt: new Date(),
          billId: invoice.id,
        },
      })
    }

    // Update creditApplied on upfront invoices
    if (creditToApply > 0 && creditsToApply.length > 0) {
      let remainingCredit = creditToApply
      for (const credit of creditsToApply) {
        if (remainingCredit <= 0) break
        
        const upfrontInvoice = paidUpfrontInvoices.find(b => b.id === credit.invoiceId)
        if (upfrontInvoice) {
          const creditToApplyToThis = Math.min(credit.amount, remainingCredit)
          await prisma.bill.update({
            where: { id: credit.invoiceId },
            data: {
              creditApplied: upfrontInvoice.creditApplied + creditToApplyToThis,
              relatedInvoiceId: invoice.id,
            },
          })
          remainingCredit -= creditToApplyToThis
        }
      }
    }

    return NextResponse.json({
      success: true,
      invoice,
      message: "Invoice generated successfully",
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error generating invoice:", error)
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    )
  }
}

