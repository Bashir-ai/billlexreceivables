export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { UserRole, TransactionType } from "@prisma/client"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const userId = id

    // Users view own; admins and managers view anyone's
    if (
      session.user.role !== UserRole.ADMIN &&
      session.user.role !== UserRole.MANAGER &&
      session.user.id !== userId
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const type = searchParams.get("type")
    const limit = parseInt(searchParams.get("limit") || "100")

    const where: any = { userId }
    if (startDate || endDate) {
      where.transactionDate = {}
      if (startDate) where.transactionDate.gte = new Date(startDate)
      if (endDate) where.transactionDate.lte = new Date(endDate)
    }
    if (type) {
      where.type = type as TransactionType
    }

    const transactions = await prisma.userFinancialTransaction.findMany({
      where,
      take: limit,
      orderBy: { transactionDate: "desc" },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    return NextResponse.json({ transactions })
  } catch (error: any) {
    console.error("Error fetching transactions:", error)
    return NextResponse.json(
      { error: error.message || "Failed to fetch transactions" },
      { status: 500 }
    )
  }
}

const transactionSchema = z.object({
  type: z.nativeEnum(TransactionType),
  amount: z.number(),
  currency: z.string().default("EUR"),
  transactionDate: z.string(), // ISO date string
  description: z.string().min(1),
  notes: z.string().optional().nullable(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Only admins and managers can create manual transactions
    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden - Admin or Manager access required" }, { status: 403 })
    }

    const { id } = await params
    const userId = id
    const body = await request.json()
    const validatedData = transactionSchema.parse(body)

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Create transaction
    const transaction = await prisma.userFinancialTransaction.create({
      data: {
        userId,
        type: validatedData.type,
        amount: validatedData.amount, // Can be negative for debts
        currency: validatedData.currency,
        transactionDate: new Date(validatedData.transactionDate),
        description: validatedData.description,
        notes: validatedData.notes || null,
        createdBy: session.user.id,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    return NextResponse.json({ transaction }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating transaction:", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: error.message || "Failed to create transaction" },
      { status: 500 }
    )
  }
}
