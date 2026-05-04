export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { isDatabaseConnectionError, getDatabaseErrorMessage } from "@/lib/database-error-handler"
import { ManagementAttributionRole } from "@prisma/client"

const contactPersonSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  phone: z.string().optional(),
  position: z.string().optional(),
  isPrimary: z.boolean().default(false),
})

const clientFinderSchema = z.object({
  userId: z.string().min(1),
  finderFeePercent: z.number().min(0).max(100).default(0),
})

const clientManagementSplitSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["CLIENT_MANAGER", "PROJECT_MANAGER"]),
  splitPercent: z.number().min(0).max(100).default(0),
  fixedAmount: z.number().min(0).nullable().optional(),
})

const clientSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  email: z.union([z.string().email(), z.literal("")]).optional().nullable(),
  company: z.string().optional().nullable(),
  contactInfo: z.string().optional().nullable(),
  portugueseTaxNumber: z.string().optional().nullable(),
  foreignTaxNumber: z.string().optional().nullable(),
  kycCompleted: z.boolean().optional(),
  isIndividual: z.boolean().optional(),
  fullLegalName: z.string().optional().nullable(),
  billingAddressLine: z.string().optional().nullable(),
  billingCity: z.string().optional().nullable(),
  billingState: z.string().optional().nullable(),
  billingZipCode: z.string().optional().nullable(),
  billingCountry: z.string().optional().nullable(),
  clientManagerId: z.union([z.string().min(1), z.literal("")]).optional().nullable(),
  clientCode: z.number().int().min(1).max(999).optional().nullable(),
  referrerName: z.string().optional().nullable(),
  referrerContactInfo: z.string().optional().nullable(),
  finders: z.array(clientFinderSchema).optional(),
  managementSplits: z.array(clientManagementSplitSchema).optional(),
  contacts: z.array(contactPersonSchema).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    let supportsManagementSplits = false
    try {
      await prisma.client.findFirst({
        include: {
          managementSplits: {
            take: 1,
          },
        },
      } as any)
      supportsManagementSplits = true
    } catch {
      supportsManagementSplits = false
    }
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const client = await prisma.client.findUnique({
      where: { 
        id,
        deletedAt: null, // Exclude deleted clients (but allow archived)
      },
      include: {
        creator: {
          select: {
            name: true,
            email: true,
          },
        },
        finders: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        ...(supportsManagementSplits
          ? {
              managementSplits: {
                include: {
                  user: { select: { id: true, name: true, email: true } },
                },
              },
            }
          : {}),
        clientManager: { select: { id: true, name: true, email: true } },
        proposals: {
          where: {
            deletedAt: null, // Exclude soft-deleted proposals
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        bills: {
          where: {
            deletedAt: null, // Exclude soft-deleted bills
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        projects: {
          where: {
            deletedAt: null, // Exclude soft-deleted projects
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        contacts: {
          orderBy: [
            { isPrimary: "desc" },
            { createdAt: "asc" },
          ],
        },
      },
    })

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    return NextResponse.json(client)
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      return NextResponse.json(
        { 
          error: "Database connection error",
          message: getDatabaseErrorMessage()
        },
        { status: 503 }
      )
    }
    console.error("Error fetching client:", error)
    return NextResponse.json(
      { 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      },
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
    let supportsManagementSplits = false
    try {
      await prisma.client.findFirst({
        include: {
          managementSplits: {
            take: 1,
          },
        },
      } as any)
      supportsManagementSplits = true
    } catch {
      supportsManagementSplits = false
    }
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
    const validatedData = clientSchema.parse(body)
    const managementSplits = validatedData.managementSplits || []
    const byRole = {
      CLIENT_MANAGER: managementSplits.filter((s) => s.role === "CLIENT_MANAGER"),
      PROJECT_MANAGER: managementSplits.filter((s) => s.role === "PROJECT_MANAGER"),
    }
    for (const [role, rows] of Object.entries(byRole)) {
      const total = rows.reduce((sum, row) => sum + row.splitPercent, 0)
      if (total > 100.0001) {
        return NextResponse.json(
          { error: `${role} split percentage cannot exceed 100` },
          { status: 400 }
        )
      }
    }

    // Handle contacts: delete all existing and create new ones
    await prisma.clientContact.deleteMany({
      where: { clientId: id },
    })

    // Handle finders: We can't delete finders that are referenced by FinderFee records
    // So we need to be smarter about updates
    if (validatedData.finders !== undefined) {
      // Get existing finders and check which ones are referenced by FinderFee
      const existingFinders = await prisma.clientFinder.findMany({
        where: { clientId: id },
      })

      // Check which finders are referenced by FinderFee records
      const finderIds = existingFinders.map(f => f.id)
      const referencedFinderIds = await prisma.finderFee.findMany({
        where: {
          clientFinderId: { in: finderIds },
        },
        select: {
          clientFinderId: true,
        },
        distinct: ['clientFinderId'],
      }).then(fees => fees.map(f => f.clientFinderId))

      // Delete only finders that are NOT referenced by any FinderFee records
      const findersToDelete = existingFinders.filter(f => !referencedFinderIds.includes(f.id))
      if (findersToDelete.length > 0) {
        await prisma.clientFinder.deleteMany({
          where: {
            id: { in: findersToDelete.map(f => f.id) },
          },
        })
      }

      // For finders that are referenced, update them if they match the new data
      const referencedFinders = existingFinders.filter(f => referencedFinderIds.includes(f.id))
      const newFinders = [...(validatedData.finders || [])]
      
      // Match existing referenced finders with new finders by userId
      for (const existingFinder of referencedFinders) {
        const matchingNewFinder = newFinders.find(nf => nf.userId === existingFinder.userId)
        if (matchingNewFinder) {
          // Update the existing finder if the percentage changed
          if (matchingNewFinder.finderFeePercent !== existingFinder.finderFeePercent) {
            await prisma.clientFinder.update({
              where: { id: existingFinder.id },
              data: { finderFeePercent: matchingNewFinder.finderFeePercent },
            })
          }
          // Remove from newFinders so we don't create a duplicate
          const index = newFinders.findIndex(nf => nf.userId === existingFinder.userId)
          if (index > -1) {
            newFinders.splice(index, 1)
          }
        }
      }

      // Update validatedData.finders to only include new finders to create
      validatedData.finders = newFinders
    }
    if (validatedData.managementSplits !== undefined && supportsManagementSplits) {
      await prisma.clientManagementSplit.deleteMany({
        where: { clientId: id },
      })
    }

    // Build update data object, only including fields that are provided
    const updateData: any = {}
    
    if (validatedData.name !== undefined && validatedData.name !== "") {
      updateData.name = validatedData.name
    } else if (validatedData.name === "") {
      // If name is sent as empty string, don't update it (keep existing value)
      // This prevents accidentally clearing the name field
    }
    if (validatedData.email !== undefined) {
      updateData.email = validatedData.email || null
    }
    if (validatedData.company !== undefined) {
      updateData.company = validatedData.company || null
    }
    if (validatedData.contactInfo !== undefined) {
      updateData.contactInfo = validatedData.contactInfo || null
    }
    if (validatedData.portugueseTaxNumber !== undefined) {
      updateData.portugueseTaxNumber = validatedData.portugueseTaxNumber || null
    }
    if (validatedData.foreignTaxNumber !== undefined) {
      updateData.foreignTaxNumber = validatedData.foreignTaxNumber || null
    }
    if (validatedData.kycCompleted !== undefined) {
      updateData.kycCompleted = validatedData.kycCompleted
    }
    if (validatedData.isIndividual !== undefined) {
      updateData.isIndividual = validatedData.isIndividual
    }
    if (validatedData.fullLegalName !== undefined) {
      updateData.fullLegalName = validatedData.fullLegalName || null
    }
    if (validatedData.billingAddressLine !== undefined) {
      updateData.billingAddressLine = validatedData.billingAddressLine || null
    }
    if (validatedData.billingCity !== undefined) {
      updateData.billingCity = validatedData.billingCity || null
    }
    if (validatedData.billingState !== undefined) {
      updateData.billingState = validatedData.billingState || null
    }
    if (validatedData.billingZipCode !== undefined) {
      updateData.billingZipCode = validatedData.billingZipCode || null
    }
    if (validatedData.billingCountry !== undefined) {
      updateData.billingCountry = validatedData.billingCountry || null
    }
    if (validatedData.clientManagerId !== undefined) {
      updateData.clientManagerId = validatedData.clientManagerId || null
    }
    if (validatedData.clientCode !== undefined) {
      // If clientCode is provided, validate it's unique (unless it's the same as current)
      if (validatedData.clientCode !== null) {
        const existing = await prisma.client.findUnique({
          where: { clientCode: validatedData.clientCode },
        })
        if (existing && existing.id !== id) {
          return NextResponse.json(
            { error: `Client code ${validatedData.clientCode} is already in use` },
            { status: 400 }
          )
        }
      }
      updateData.clientCode = validatedData.clientCode
    }
    if (validatedData.referrerName !== undefined) {
      updateData.referrerName = validatedData.referrerName || null
    }
    if (validatedData.referrerContactInfo !== undefined) {
      updateData.referrerContactInfo = validatedData.referrerContactInfo || null
    }

    // Handle finders and contacts
    if (validatedData.finders !== undefined) {
      updateData.finders = validatedData.finders && validatedData.finders.length > 0
        ? {
            create: validatedData.finders.map((finder) => ({
              userId: finder.userId,
              finderFeePercent: finder.finderFeePercent,
            })),
          }
        : undefined
    }
    if (validatedData.managementSplits !== undefined && supportsManagementSplits) {
      updateData.managementSplits = validatedData.managementSplits.length > 0
        ? {
            create: validatedData.managementSplits.map((split) => ({
              userId: split.userId,
              role: split.role as ManagementAttributionRole,
              splitPercent: split.splitPercent,
              fixedAmount: split.fixedAmount ?? null,
            })),
          }
        : undefined
    }
    if (validatedData.contacts !== undefined) {
      updateData.contacts = validatedData.contacts && validatedData.contacts.length > 0
        ? {
            create: validatedData.contacts.map((contact) => ({
              name: contact.name,
              email: contact.email || null,
              phone: contact.phone || null,
              position: contact.position || null,
              isPrimary: contact.isPrimary || false,
            })),
          }
        : undefined
    }

    const client = await prisma.client.update({
      where: { id },
      data: updateData,
      include: {
        contacts: {
          orderBy: [
            { isPrimary: "desc" },
            { createdAt: "asc" },
          ],
        },
        finders: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        ...(supportsManagementSplits
          ? {
              managementSplits: {
                include: {
                  user: { select: { id: true, name: true, email: true } },
                },
              },
            }
          : {}),
        clientManager: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(client)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Validation error:", JSON.stringify(error.errors, null, 2))
      return NextResponse.json(
        { 
          error: "Invalid input", 
          details: error.errors,
          message: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        },
        { status: 400 }
      )
    }
    if (isDatabaseConnectionError(error)) {
      return NextResponse.json(
        { 
          error: "Database connection error",
          message: getDatabaseErrorMessage()
        },
        { status: 503 }
      )
    }
    console.error("Error updating client:", error)
    if (error instanceof Error) {
      console.error("Error message:", error.message)
      console.error("Error stack:", error.stack)
    }
    return NextResponse.json(
      { error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" },
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

    if (session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      )
    }

    // Check if force deletion is requested
    const url = new URL(request.url)
    const forceDelete = url.searchParams.get("force") === "true"

    if (forceDelete) {
      // Hard delete: permanently delete the client and all related data
      // Prisma cascade will handle related records based on schema
      await prisma.client.delete({
        where: { id },
      })
      return NextResponse.json({ message: "Client permanently deleted" })
    } else {
      // Check if client can be deleted (not just archived)
      const { canDeleteClient } = await import("@/lib/client-deletion-check")
      const deletionCheck = await canDeleteClient(id)

      if (!deletionCheck.canDelete) {
        return NextResponse.json(
          { 
            error: "Cannot delete client",
            message: deletionCheck.reason,
            ongoingProjects: deletionCheck.ongoingProjects,
            openInvoices: deletionCheck.openInvoices,
            openProposals: deletionCheck.openProposals,
          },
          { status: 400 }
        )
      }

      // Soft delete: set deletedAt timestamp
      await prisma.client.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      })

      return NextResponse.json({ message: "Client deleted" })
    }
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      return NextResponse.json(
        { 
          error: "Database connection error",
          message: getDatabaseErrorMessage()
        },
        { status: 503 }
      )
    }
    console.error("Error deleting client:", error)
    if (error instanceof Error) {
      console.error("Error message:", error.message)
      console.error("Error stack:", error.stack)
    }
    return NextResponse.json(
      { error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" },
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

    if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const action = body.action // "archive" or "unarchive"

    if (action === "archive") {
      await prisma.client.update({
        where: { id },
        data: {
          archivedAt: new Date(),
        },
      })
      return NextResponse.json({ message: "Client archived" })
    } else if (action === "unarchive") {
      await prisma.client.update({
        where: { id },
        data: {
          archivedAt: null,
        },
      })
      return NextResponse.json({ message: "Client unarchived" })
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'archive' or 'unarchive'" },
        { status: 400 }
      )
    }
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      return NextResponse.json(
        { 
          error: "Database connection error",
          message: getDatabaseErrorMessage()
        },
        { status: 503 }
      )
    }
    console.error("Error archiving/unarchiving client:", error)
    if (error instanceof Error) {
      console.error("Error message:", error.message)
      console.error("Error stack:", error.stack)
    }
    return NextResponse.json(
      { error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

