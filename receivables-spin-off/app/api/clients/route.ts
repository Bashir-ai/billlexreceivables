export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { isDatabaseConnectionError, getDatabaseErrorMessage } from "@/lib/database-error-handler"
import { generateClientCode } from "@/lib/client-code"
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
  name: z.string().min(1),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  company: z.string().optional(),
  contactInfo: z.string().optional(),
  portugueseTaxNumber: z.string().optional(),
  foreignTaxNumber: z.string().optional(),
  kycCompleted: z.boolean().default(false),
  isIndividual: z.boolean().optional().default(false),
  fullLegalName: z.string().optional(),
  billingAddressLine: z.string().optional(),
  billingCity: z.string().optional(),
  billingState: z.string().optional(),
  billingZipCode: z.string().optional(),
  billingCountry: z.string().optional(),
  clientManagerId: z.string().optional().or(z.literal("")),
  clientCode: z.number().int().min(1).max(999).optional().nullable(),
  referrerName: z.string().optional().nullable(),
  referrerContactInfo: z.string().optional().nullable(),
  finders: z.array(clientFinderSchema).optional(),
  managementSplits: z.array(clientManagementSplitSchema).optional(),
  contacts: z.array(contactPersonSchema).optional(),
})

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    // Pagination parameters
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "100")
    const skip = (page - 1) * limit

    const where = {
      deletedAt: null, // Exclude deleted clients
      archivedAt: null, // Exclude archived clients
    }

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
    } catch (probeError: any) {
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
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
        },
      }),
      prisma.client.count({ where })
    ])

    return NextResponse.json({
      data: clients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
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
    console.error("Error fetching clients:", error)
    return NextResponse.json(
      { 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
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

    // Generate client code if not provided, or validate if provided
    let clientCode: number
    if (validatedData.clientCode) {
      // Check if the provided code is already taken
      const existing = await prisma.client.findUnique({
        where: { clientCode: validatedData.clientCode },
      })
      if (existing) {
        return NextResponse.json(
          { error: `Client code ${validatedData.clientCode} is already in use` },
          { status: 400 }
        )
      }
      clientCode = validatedData.clientCode
    } else {
      clientCode = await generateClientCode()
    }

    const client = await prisma.client.create({
      data: {
        name: validatedData.name,
        email: validatedData.email || null,
        company: validatedData.company || null,
        contactInfo: validatedData.contactInfo || null,
        clientCode: clientCode,
        portugueseTaxNumber: validatedData.portugueseTaxNumber || null,
        foreignTaxNumber: validatedData.foreignTaxNumber || null,
        kycCompleted: validatedData.kycCompleted || false,
        isIndividual: validatedData.isIndividual || false,
        fullLegalName: validatedData.fullLegalName || null,
        billingAddressLine: validatedData.billingAddressLine || null,
        billingCity: validatedData.billingCity || null,
        billingState: validatedData.billingState || null,
        billingZipCode: validatedData.billingZipCode || null,
        billingCountry: validatedData.billingCountry || null,
        clientManagerId: validatedData.clientManagerId || null,
        referrerName: validatedData.referrerName || null,
        referrerContactInfo: validatedData.referrerContactInfo || null,
        createdBy: session.user.id,
        finders: validatedData.finders && validatedData.finders.length > 0
          ? {
              create: validatedData.finders.map((finder) => ({
                userId: finder.userId,
                finderFeePercent: finder.finderFeePercent,
              })),
            }
          : undefined,
        managementSplits: managementSplits.length > 0
          ? {
              create: managementSplits.map((split) => ({
                userId: split.userId,
                role: split.role as ManagementAttributionRole,
                splitPercent: split.splitPercent,
                fixedAmount: split.fixedAmount ?? null,
              })),
            }
          : undefined,
        contacts: validatedData.contacts && validatedData.contacts.length > 0
          ? {
              create: validatedData.contacts.map((contact) => ({
                name: contact.name,
                email: contact.email || null,
                phone: contact.phone || null,
                position: contact.position || null,
                isPrimary: contact.isPrimary || false,
              })),
            }
          : undefined,
      },
      include: {
        contacts: true,
        finders: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        clientManager: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json(client, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
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
    console.error("Error creating client:", error)
    return NextResponse.json(
      { 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    )
  }
}




