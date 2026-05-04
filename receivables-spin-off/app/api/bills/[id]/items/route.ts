export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { BillStatus } from "@prisma/client"
import { z } from "zod"
import { canEditInvoice } from "@/lib/permissions"

async function resyncFeesIfPaid(billId: string) {
  const b = await prisma.bill.findUnique({
    where: { id: billId },
    select: { status: true },
  })
  if (b?.status !== BillStatus.PAID) return
  try {
    const { resyncFinderAndManagementFeesForPaidBill } = await import("@/lib/attribution-fee-resync")
    await resyncFinderAndManagementFeesForPaidBill(billId)
  } catch (e) {
    console.error("resyncFeesIfPaid", billId, e)
  }
}

const billItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().optional().nullable(),
  rate: z.number().optional().nullable(),
  unitPrice: z.number().optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  discountAmount: z.number().min(0).optional().nullable(),
  amount: z.number().min(0),
  billedHours: z.number().optional().nullable(),
  personId: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
})

const billItemUpdateSchema = billItemSchema.extend({
  id: z.string().optional(), // For updates
})

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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: { items: true },
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
    const validatedData = billItemSchema.parse(body)

    // Calculate amount if not provided
    let finalAmount = validatedData.amount
    if (validatedData.quantity && (validatedData.rate || validatedData.unitPrice)) {
      const baseAmount = (validatedData.quantity || 0) * (validatedData.rate || validatedData.unitPrice || 0)
      const discount = validatedData.discountAmount || (validatedData.discountPercent ? (baseAmount * validatedData.discountPercent / 100) : 0)
      finalAmount = baseAmount - discount
    }

    // Create new manual line item
    const newItem = await prisma.billItem.create({
      data: {
        billId: id,
        type: "MANUAL",
        description: validatedData.description,
        quantity: validatedData.quantity || null,
        rate: validatedData.rate || null,
        unitPrice: validatedData.unitPrice || null,
        discountPercent: validatedData.discountPercent || null,
        discountAmount: validatedData.discountAmount || null,
        amount: finalAmount,
        billedHours: validatedData.billedHours || null,
        personId: validatedData.personId || null,
        date: validatedData.date ? new Date(validatedData.date) : null,
        isManuallyEdited: true,
      },
      include: {
        person: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    // Recalculate bill totals
    const allItems = await prisma.billItem.findMany({
      where: { billId: id },
    })
    const subtotal = allItems.reduce((sum, item) => sum + item.amount, 0)
    
    // Apply bill-level discount and tax
    const afterDiscount = bill.discountAmount 
      ? subtotal - bill.discountAmount 
      : bill.discountPercent 
        ? subtotal * (1 - bill.discountPercent / 100)
        : subtotal
    
    const taxAmount = bill.taxRate && bill.taxRate > 0
      ? (bill.taxInclusive 
          ? (afterDiscount * bill.taxRate / (100 + bill.taxRate))
          : (afterDiscount * bill.taxRate / 100))
      : 0
    
    const total = bill.taxInclusive ? afterDiscount : afterDiscount + taxAmount

    await prisma.bill.update({
      where: { id },
      data: {
        subtotal,
        amount: total,
      },
    })

    await resyncFeesIfPaid(id)

    return NextResponse.json(newItem, { status: 201 })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 }
      )
    }
    console.error("Error creating bill item:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const { itemId, ...itemData } = await z.object({
      itemId: z.string(),
      ...billItemSchema.shape,
    }).parse(body)

    const billItem = await prisma.billItem.findUnique({
      where: { id: itemId },
      include: { bill: true },
    })

    if (!billItem || billItem.billId !== id) {
      return NextResponse.json({ error: "Bill item not found" }, { status: 404 })
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

    if (!canEditInvoice(user, { createdBy: billItem.bill.createdBy, status: billItem.bill.status })) {
      return NextResponse.json(
        { error: "You don't have permission to edit this invoice" },
        { status: 403 }
      )
    }

    // Calculate amount if not provided
    let finalAmount = itemData.amount
    if (itemData.quantity && (itemData.rate || itemData.unitPrice)) {
      const baseAmount = (itemData.quantity || 0) * (itemData.rate || itemData.unitPrice || 0)
      const discount = itemData.discountAmount || (itemData.discountPercent ? (baseAmount * itemData.discountPercent / 100) : 0)
      finalAmount = baseAmount - discount
    }

    // Update item
    // If this is a timesheet item and billedHours is being changed, mark as manually edited
    const isManuallyEdited = billItem.type === "TIMESHEET" && 
      itemData.billedHours !== null && 
      itemData.billedHours !== undefined &&
      itemData.billedHours !== billItem.billedHours

    const updatedItem = await prisma.billItem.update({
      where: { id: itemId },
      data: {
        description: itemData.description,
        quantity: itemData.quantity || null,
        rate: itemData.rate || null,
        unitPrice: itemData.unitPrice || null,
        discountPercent: itemData.discountPercent || null,
        discountAmount: itemData.discountAmount || null,
        amount: finalAmount,
        billedHours: itemData.billedHours !== undefined ? itemData.billedHours : billItem.billedHours,
        isManuallyEdited: isManuallyEdited || billItem.isManuallyEdited,
        originalTimesheetEntryId: billItem.originalTimesheetEntryId || billItem.timesheetEntryId,
        personId: itemData.personId || billItem.personId,
        date: itemData.date ? new Date(itemData.date) : billItem.date,
      },
      include: {
        person: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    // Recalculate bill totals
    const allItems = await prisma.billItem.findMany({
      where: { billId: id },
    })
    const subtotal = allItems.reduce((sum, item) => sum + item.amount, 0)
    
    const bill = await prisma.bill.findUnique({
      where: { id },
    })
    
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 })
    }

    // Apply bill-level discount and tax
    const afterDiscount = bill.discountAmount 
      ? subtotal - bill.discountAmount 
      : bill.discountPercent 
        ? subtotal * (1 - bill.discountPercent / 100)
        : subtotal
    
    const taxAmount = bill.taxRate && bill.taxRate > 0
      ? (bill.taxInclusive 
          ? (afterDiscount * bill.taxRate / (100 + bill.taxRate))
          : (afterDiscount * bill.taxRate / 100))
      : 0
    
    const total = bill.taxInclusive ? afterDiscount : afterDiscount + taxAmount

    await prisma.bill.update({
      where: { id },
      data: {
        subtotal,
        amount: total,
      },
    })

    await resyncFeesIfPaid(id)

    return NextResponse.json(updatedItem)
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 }
      )
    }
    console.error("Error updating bill item:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
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

    if (session.user.role === "CLIENT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get("itemId")

    if (!itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 })
    }

    const billItem = await prisma.billItem.findUnique({
      where: { id: itemId },
      include: { bill: true },
    })

    if (!billItem || billItem.billId !== id) {
      return NextResponse.json({ error: "Bill item not found" }, { status: 404 })
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

    if (!canEditInvoice(user, { createdBy: billItem.bill.createdBy, status: billItem.bill.status })) {
      return NextResponse.json(
        { error: "You don't have permission to edit this invoice" },
        { status: 403 }
      )
    }

    // Don't allow deletion of timesheet items - they should be unbilled instead
    if (billItem.type === "TIMESHEET" && billItem.timesheetEntryId) {
      return NextResponse.json(
        { error: "Cannot delete timesheet items. Unbill them from the project instead." },
        { status: 400 }
      )
    }

    await prisma.billItem.delete({
      where: { id: itemId },
    })

    // Recalculate bill totals
    const allItems = await prisma.billItem.findMany({
      where: { billId: id },
    })
    const subtotal = allItems.reduce((sum, item) => sum + item.amount, 0)
    
    const bill = await prisma.bill.findUnique({
      where: { id },
    })
    
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 })
    }

    // Apply bill-level discount and tax
    const afterDiscount = bill.discountAmount 
      ? subtotal - bill.discountAmount 
      : bill.discountPercent 
        ? subtotal * (1 - bill.discountPercent / 100)
        : subtotal
    
    const taxAmount = bill.taxRate && bill.taxRate > 0
      ? (bill.taxInclusive 
          ? (afterDiscount * bill.taxRate / (100 + bill.taxRate))
          : (afterDiscount * bill.taxRate / 100))
      : 0
    
    const total = bill.taxInclusive ? afterDiscount : afterDiscount + taxAmount

    await prisma.bill.update({
      where: { id },
      data: {
        subtotal,
        amount: total,
      },
    })

    await resyncFeesIfPaid(id)

    return NextResponse.json({ message: "Item deleted" })
  } catch (error: any) {
    console.error("Error deleting bill item:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
