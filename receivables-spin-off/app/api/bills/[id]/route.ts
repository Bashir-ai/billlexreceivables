export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { BillAttributionRole, BillStatus } from "@prisma/client"
import { canEditInvoice } from "@/lib/permissions"
import { parseLocalDate } from "@/lib/utils"
import {
  buildDefaultBillAttributionRows,
  createBillAttributionSnapshot,
  createBillAttributionSnapshotFromRows,
} from "@/lib/bill-attribution"
import { apiRowsToBillAttributionInputs, billAttributionRowsApiSchema } from "@/lib/bill-attribution-api"

const billUpdateSchema = z.object({
  amount: z.number().min(0).optional(),
  subtotal: z.number().min(0).optional(),
  description: z.string().optional(),
  paymentDetailsId: z.string().optional().nullable(),
  taxInclusive: z.boolean().optional(),
  taxRate: z.number().min(0).max(100).optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  discountAmount: z.number().min(0).optional().nullable(),
  dueDate: z.string().optional(),
  status: z.nativeEnum(BillStatus).optional(),
  clientId: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
  attributionRows: billAttributionRowsApiSchema.optional(),
})

function mergeAttributionByRole(options: {
  defaults: ReturnType<typeof apiRowsToBillAttributionInputs>
  overrides: ReturnType<typeof apiRowsToBillAttributionInputs>
}) {
  const { defaults, overrides } = options
  const roles: BillAttributionRole[] = [
    BillAttributionRole.FINDER,
    BillAttributionRole.CLIENT_MANAGER,
    BillAttributionRole.PROJECT_MANAGER,
  ]
  const merged: ReturnType<typeof apiRowsToBillAttributionInputs> = []
  for (const role of roles) {
    const roleOverrides = overrides.filter((r) => r.role === role)
    const source = roleOverrides.length > 0 ? roleOverrides : defaults.filter((r) => r.role === role)
    merged.push(...source)
  }
  return merged
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    let supportsAttributionSnapshots = false
    try {
      await prisma.bill.findFirst({
        include: {
          attributionSnapshots: {
            take: 1,
          },
        },
      } as any)
      supportsAttributionSnapshots = true
    } catch {
      supportsAttributionSnapshots = false
    }
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const bill = await prisma.bill.findUnique({
      where: { 
        id,
        deletedAt: null, // Exclude deleted items
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            portugueseTaxNumber: true,
            foreignTaxNumber: true,
            billingAddressLine: true,
            billingCity: true,
            billingState: true,
            billingZipCode: true,
            billingCountry: true,
          },
        },
        lead: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            addressLine: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
          },
        },
        proposal: {
          select: {
            id: true,
            title: true,
            proposalNumber: true,
            items: {
              select: {
                id: true,
                description: true,
                amount: true,
                billingMethod: true,
              },
            },
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            currency: true,
          },
        },
        items: {
          include: {
            person: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        creator: {
          select: {
            name: true,
            email: true,
          },
        },
        approvals: {
          include: {
            approver: {
              select: {
                name: true,
                email: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        ...(supportsAttributionSnapshots
          ? {
              attributionSnapshots: {
                orderBy: { version: "desc" },
                take: 1,
                include: {
                  rows: {
                    include: {
                      user: {
                        select: { id: true, name: true, email: true },
                      },
                    },
                    orderBy: { createdAt: "asc" },
                  },
                },
              },
            }
          : {}),
      },
    })

    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 })
    }

    // Check if client can access this bill
    if (session.user.role === "CLIENT") {
      const client = await prisma.client.findFirst({
        where: { 
          email: session.user.email,
          deletedAt: null, // Exclude deleted clients
        },
      })
      if (!client || bill.clientId !== client.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // Check if EXTERNAL user can access this bill (must be client manager or finder)
    if (session.user.role === "EXTERNAL") {
      // EXTERNAL users can only access bills linked to clients (not leads)
      if (!bill.clientId) {
        return NextResponse.json(
          { error: "Forbidden - External users can only view invoices for clients" },
          { status: 403 }
        )
      }
      const client = await prisma.client.findUnique({
        where: { id: bill.clientId },
        include: {
          finders: true,
        },
      })
      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 })
      }
      const isManager = client.clientManagerId === session.user.id
      const isFinder = client.finders.some((finder) => finder.userId === session.user.id)
      if (!isManager && !isFinder) {
        return NextResponse.json(
          { error: "Forbidden - External users can only view invoices for clients they manage or where they are finders" },
          { status: 403 }
        )
      }
    }

    return NextResponse.json(bill)
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
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
    })

    if (!bill) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Check edit permissions
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        role: true,
        canEditAllInvoices: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    if (!canEditInvoice(user, { createdBy: bill.createdBy, status: bill.status })) {
      return NextResponse.json(
        { error: "You don't have permission to edit this invoice" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = billUpdateSchema.parse(body)
    if (validatedData.attributionRows !== undefined) {
      const canEditAttr =
        bill.status === BillStatus.DRAFT ||
        bill.status === BillStatus.SUBMITTED ||
        bill.status === BillStatus.APPROVED
      if (!canEditAttr) {
        return NextResponse.json(
          { error: "Attribution can only be edited before invoice is settled/cancelled" },
          { status: 400 }
        )
      }

      if (validatedData.attributionRows.length > 0) {
        const rowsByRole = {
          FINDER: validatedData.attributionRows.filter((row) => row.role === "FINDER"),
          CLIENT_MANAGER: validatedData.attributionRows.filter((row) => row.role === "CLIENT_MANAGER"),
          PROJECT_MANAGER: validatedData.attributionRows.filter((row) => row.role === "PROJECT_MANAGER"),
        }
        for (const [role, rows] of Object.entries(rowsByRole)) {
          const total = rows.reduce((sum, row) => sum + row.splitPercent, 0)
          if (total > 100.0001) {
            return NextResponse.json(
              { error: `${role} split percentage cannot exceed 100` },
              { status: 400 }
            )
          }
        }
      }
    }

    // Validate client/lead if being updated
    if (validatedData.clientId !== undefined || validatedData.leadId !== undefined) {
      // Ensure at least one is provided
      const newClientId = validatedData.clientId !== undefined ? validatedData.clientId : bill.clientId
      const newLeadId = validatedData.leadId !== undefined ? validatedData.leadId : bill.leadId
      
      if (!newClientId && !newLeadId) {
        return NextResponse.json(
          { error: "Either clientId or leadId must be provided" },
          { status: 400 }
        )
      }

      // Validate client exists if clientId provided
      if (validatedData.clientId) {
        const client = await prisma.client.findUnique({
          where: { id: validatedData.clientId },
        })
        if (!client) {
          return NextResponse.json(
            { error: "Client not found" },
            { status: 404 }
          )
        }
      }

      // Validate lead exists if leadId provided
      if (validatedData.leadId) {
        const lead = await prisma.lead.findUnique({
          where: { id: validatedData.leadId },
        })
        if (!lead) {
          return NextResponse.json(
            { error: "Lead not found" },
            { status: 404 }
          )
        }
      }
    }

    // Get current bill with items to recalculate totals
    const billWithItems = await prisma.bill.findUnique({
      where: { id },
      include: {
        items: true,
      },
    })

    if (!billWithItems) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Calculate subtotal from items if not provided
    let subtotal = validatedData.subtotal
    if (subtotal === undefined) {
      subtotal = billWithItems.items.reduce((sum, item) => sum + item.amount, 0)
    }

    // Get tax and discount values (use provided or existing)
    const taxInclusive = validatedData.taxInclusive !== undefined ? validatedData.taxInclusive : billWithItems.taxInclusive
    const taxRate = validatedData.taxRate !== undefined ? validatedData.taxRate : billWithItems.taxRate
    const discountPercent = validatedData.discountPercent !== undefined ? validatedData.discountPercent : billWithItems.discountPercent
    const discountAmount = validatedData.discountAmount !== undefined ? validatedData.discountAmount : billWithItems.discountAmount

    // Calculate discount
    let discountValue = 0
    if (discountPercent && discountPercent > 0) {
      discountValue = (subtotal * discountPercent) / 100
    } else if (discountAmount && discountAmount > 0) {
      discountValue = discountAmount
    }

    const afterDiscount = subtotal - discountValue

    // Calculate tax and final amount
    let taxAmount = 0
    let finalAmount = afterDiscount

    if (taxRate && taxRate > 0) {
      if (taxInclusive) {
        // Tax is included in the amount
        taxAmount = (afterDiscount * taxRate) / (100 + taxRate)
        finalAmount = afterDiscount // Amount already includes tax
      } else {
        // Tax is added on top
        taxAmount = (afterDiscount * taxRate) / 100
        finalAmount = afterDiscount + taxAmount
      }
    }

    const newDueDate = validatedData.dueDate ? parseLocalDate(validatedData.dueDate) : bill.dueDate
    const newStatus = validatedData.status !== undefined ? validatedData.status : bill.status
    
    // Check if invoice becomes outstanding or is paid
    const { isInvoiceOutstanding } = await import("@/lib/invoice-helpers")
    const { notifyOutstandingInvoice } = await import("@/lib/invoice-notifications")
    
    const updateData: any = {
      subtotal: subtotal,
      amount: finalAmount,
      description: validatedData.description !== undefined ? validatedData.description : bill.description,
      paymentDetailsId: validatedData.paymentDetailsId !== undefined ? validatedData.paymentDetailsId : bill.paymentDetailsId,
      taxInclusive: taxInclusive,
      taxRate: taxRate,
      discountPercent: discountPercent,
      discountAmount: discountAmount,
      dueDate: newDueDate,
      status: newStatus,
      submittedAt: newStatus === BillStatus.SUBMITTED ? new Date() : bill.submittedAt,
    }

    // Update clientId/leadId if provided
    if (validatedData.clientId !== undefined) {
      updateData.clientId = validatedData.clientId || null
    }
    if (validatedData.leadId !== undefined) {
      updateData.leadId = validatedData.leadId || null
    }
    
    // Handle outstanding status
    const wasPaid = bill.status === BillStatus.PAID
    const isNowPaid = newStatus === BillStatus.PAID
    
    if (isNowPaid) {
      // Clear outstanding tracking when paid
      updateData.becameOutstandingAt = null
      updateData.lastReminderSentAt = null
      updateData.reminderCount = 0
      // Set paidAt if not already set
      if (!bill.paidAt) {
        updateData.paidAt = new Date()
      }
    } else if (newDueDate) {
      // Re-check outstanding status if dueDate changed
      const tempBill = { ...bill, dueDate: newDueDate, status: newStatus }
      const isOutstanding = isInvoiceOutstanding(tempBill as any)
      
      if (isOutstanding && !bill.becameOutstandingAt) {
        // First time becoming outstanding
        updateData.becameOutstandingAt = new Date()
        updateData.lastReminderSentAt = new Date()
        updateData.reminderCount = 1
        
        // Send notifications
        const billWithRelations = await prisma.bill.findUnique({
          where: { id },
          include: {
            client: {
              include: {
                finders: {
                  include: {
                    user: { select: { id: true, name: true, email: true } },
                  },
                },
                clientManager: { select: { id: true, name: true, email: true } },
              },
            },
            project: {
              include: {
                projectManagers: {
                  include: {
                    user: { select: { id: true, name: true, email: true } },
                  },
                },
              },
            },
          },
        })
        
        if (billWithRelations) {
          await notifyOutstandingInvoice(billWithRelations as any, true, 1)
        }
      }
    }

    const updatedBill = await prisma.bill.update({
      where: { id },
      data: updateData,
      include: {
        client: true,
        lead: true,
        proposal: true,
      },
    })
    if (validatedData.attributionRows !== undefined) {
      const latestSnapshot = await prisma.billAttributionSnapshot.findFirst({
        where: { billId: id },
        orderBy: { version: "desc" },
      })
      const nextVersion = (latestSnapshot?.version || 0) + 1
      const defaultRows = await buildDefaultBillAttributionRows({
        tx: prisma,
        clientId: updatedBill.clientId,
        projectId: updatedBill.projectId,
      })
      const overrideRows = apiRowsToBillAttributionInputs(validatedData.attributionRows)
      // Per-role merge: if only management is overridden on invoice, finder defaults from client are preserved.
      const mergedRows = mergeAttributionByRole({
        defaults: defaultRows,
        overrides: overrideRows,
      })
      await createBillAttributionSnapshotFromRows({
        tx: prisma,
        billId: id,
        clientId: updatedBill.clientId,
        projectId: updatedBill.projectId,
        version: nextVersion,
        rows: mergedRows,
      })
    } else {
      const hasSnapshot = await prisma.billAttributionSnapshot.findFirst({
        where: { billId: id },
        select: { id: true },
      })
      if (!hasSnapshot) {
        await createBillAttributionSnapshot({
          tx: prisma,
          billId: id,
          clientId: updatedBill.clientId,
          projectId: updatedBill.projectId,
        })
      }
    }

    // Calculate finder fees if invoice was just marked as PAID
    if (isNowPaid && !wasPaid) {
      try {
        const { runPaidInvoiceLedgerHooks } = await import("@/lib/invoice-paid-fees")
        await runPaidInvoiceLedgerHooks(id)
      } catch (error) {
        // Log error but don't fail the request
        console.error("Error calculating paid-invoice fees:", error)
        if (error instanceof Error) {
          console.error("Paid invoice fee error details:", error.message, error.stack)
        }
      }
    }

    if (updatedBill.status === BillStatus.PAID) {
      try {
        const { resyncFinderAndManagementFeesForPaidBill } = await import("@/lib/attribution-fee-resync")
        await resyncFinderAndManagementFeesForPaidBill(id)
      } catch (error) {
        console.error("Error resyncing finder/management fees after invoice update:", error)
      }
    }

    return NextResponse.json(updatedBill)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

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
    const action = body.action

    // Get current bill
    const bill = await prisma.bill.findUnique({
      where: { id },
    })

    if (!bill) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Check permissions for write-off and cancel
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        role: true,
      },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    if (action === "writeOff") {
      // Only ADMIN and MANAGER can write off invoices
      if (user.role !== "ADMIN" && user.role !== "MANAGER") {
        return NextResponse.json(
          { error: "Only administrators and managers can write off invoices" },
          { status: 403 }
        )
      }

      // Cannot write off PAID invoices
      if (bill.status === BillStatus.PAID) {
        return NextResponse.json(
          { error: "Cannot write off a paid invoice" },
          { status: 400 }
        )
      }

      // Cannot write off already written off invoices
      if (bill.status === BillStatus.WRITTEN_OFF) {
        return NextResponse.json(
          { error: "Invoice is already written off" },
          { status: 400 }
        )
      }

      const notes = body.notes || null

      const updatedBill = await prisma.bill.update({
        where: { id },
        data: {
          status: BillStatus.WRITTEN_OFF,
          originalAmount: bill.amount, // Store original amount
          writtenOffAt: new Date(),
          writtenOffBy: user.id,
          // Clear outstanding tracking when invoice is no longer collectible
          becameOutstandingAt: null,
          lastReminderSentAt: null,
          reminderCount: 0,
        },
      })

      // Create an interaction to record the write-off
      if (notes) {
        await prisma.invoiceInteraction.create({
          data: {
            billId: id,
            interactionType: "OTHER",
            notes: `Invoice written off. ${notes}`,
            date: new Date(),
            createdBy: user.id,
          },
        })
      }

      return NextResponse.json(updatedBill)
    }

    if (action === "cancel") {
      // Only ADMIN and MANAGER can cancel invoices (or creator can cancel drafts)
      const canCancel = user.role === "ADMIN" || 
                       user.role === "MANAGER" || 
                       (bill.createdBy === user.id && bill.status === BillStatus.DRAFT)

      if (!canCancel) {
        return NextResponse.json(
          { error: "You don't have permission to cancel this invoice" },
          { status: 403 }
        )
      }

      // Cannot cancel PAID invoices
      if (bill.status === BillStatus.PAID) {
        return NextResponse.json(
          { error: "Cannot cancel a paid invoice" },
          { status: 400 }
        )
      }

      // Cannot cancel already cancelled invoices
      if (bill.status === BillStatus.CANCELLED) {
        return NextResponse.json(
          { error: "Invoice is already cancelled" },
          { status: 400 }
        )
      }

      // Cannot cancel already written off invoices
      if (bill.status === BillStatus.WRITTEN_OFF) {
        return NextResponse.json(
          { error: "Cannot cancel a written-off invoice" },
          { status: 400 }
        )
      }

      const updatedBill = await prisma.bill.update({
        where: { id },
        data: {
          status: BillStatus.CANCELLED,
          // Clear outstanding tracking since this invoice won't be collected
          becameOutstandingAt: null,
          lastReminderSentAt: null,
          reminderCount: 0,
        },
      })

      return NextResponse.json(updatedBill)
    }

    if (action === "submit") {
      const updatedBill = await prisma.bill.update({
        where: { id },
        data: {
          status: BillStatus.SUBMITTED,
          submittedAt: new Date(),
        },
      })

      return NextResponse.json(updatedBill)
    } else if (action === "markPaid") {
      if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        )
      }

      const bill = await prisma.bill.update({
        where: { id },
        data: {
          status: BillStatus.PAID,
          paidAt: new Date(),
          // Clear outstanding tracking when invoice is paid
          becameOutstandingAt: null,
          lastReminderSentAt: null,
          reminderCount: 0,
        },
      })

      try {
        const { runPaidInvoiceLedgerHooks } = await import("@/lib/invoice-paid-fees")
        await runPaidInvoiceLedgerHooks(id)
      } catch (error) {
        console.error("Error calculating paid-invoice fees:", error)
      }

      return NextResponse.json(bill)
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const bill = await prisma.bill.findUnique({
      where: { id },
      select: {
        id: true,
        createdBy: true,
        status: true,
      },
    })

    if (!bill) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Allow admins/managers, or creator for draft invoices.
    const canDelete =
      session.user.role === "ADMIN" ||
      session.user.role === "MANAGER" ||
      (bill.createdBy === session.user.id && bill.status === BillStatus.DRAFT)

    if (!canDelete) {
      return NextResponse.json(
        { error: "You don't have permission to delete this invoice." },
        { status: 403 }
      )
    }

    // Prevent deleting paid invoices.
    if (bill.status === BillStatus.PAID) {
      return NextResponse.json(
        { error: "Cannot delete a paid invoice." },
        { status: 400 }
      )
    }

    // Soft delete: set deletedAt timestamp
    await prisma.bill.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    })

    return NextResponse.json({ message: "Invoice moved to junk box successfully" })
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

