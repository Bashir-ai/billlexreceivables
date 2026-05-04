export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { UserRole } from "@prisma/client"
import { buildNormalizedCompensationCreateData } from "@/lib/compensation-create-data"

const compensationSchema = z.object({
  compensationType: z.enum(["SALARY_BONUS", "PERCENTAGE_BASED"]),
  baseSalary: z.number().positive().nullable().optional(),
  maxBonusMultiplier: z.number().min(0).nullable().optional(),
  percentageType: z.enum(["PROJECT_TOTAL", "DIRECT_WORK", "BOTH"]).nullable().optional(),
  projectPercentage: z.number().min(0).max(100).nullable().optional(),
  directWorkPercentage: z.number().min(0).max(100).nullable().optional(),
  effectiveFrom: z.string().transform((str) => new Date(str)),
  effectiveTo: z.string().transform((str) => new Date(str)).nullable().optional(),
})

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

    // Check permissions: user can view own, admin/manager can view all
    if (session.user.id !== userId && session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Get current active compensation
    const compensation = await prisma.userCompensation.findFirst({
      where: {
        userId,
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: new Date() } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
      include: {
        compensationEntries: {
          orderBy: { calculatedAt: 'desc' },
          take: 12, // Last 12 months
        },
      },
    })

    if (!compensation) {
      return NextResponse.json({ compensation: null })
    }

    return NextResponse.json({ compensation })
  } catch (error: any) {
    console.error("Error fetching compensation:", error)
    return NextResponse.json(
      { error: error.message || "Failed to fetch compensation" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Only admins can create/edit compensation
    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 })
    }

    const { id } = await params
    const userId = id
    const body = await request.json()
    const validatedData = compensationSchema.parse(body)

    // Validate based on compensation type
    if (validatedData.compensationType === "SALARY_BONUS") {
      if (!validatedData.baseSalary || validatedData.baseSalary <= 0) {
        return NextResponse.json({ error: "Base salary is required for salary-based compensation" }, { status: 400 })
      }
      if (validatedData.maxBonusMultiplier === null || validatedData.maxBonusMultiplier === undefined || validatedData.maxBonusMultiplier < 0) {
        return NextResponse.json({ error: "Max bonus multiplier is required and must be 0 or greater (0 means no bonus compensation)" }, { status: 400 })
      }
    } else if (validatedData.compensationType === "PERCENTAGE_BASED") {
      if (!validatedData.percentageType) {
        return NextResponse.json({ error: "Percentage type is required for percentage-based compensation" }, { status: 400 })
      }
      if (validatedData.percentageType === "PROJECT_TOTAL" || validatedData.percentageType === "BOTH") {
        if (!validatedData.projectPercentage || validatedData.projectPercentage <= 0) {
          return NextResponse.json({ error: "Project percentage is required" }, { status: 400 })
        }
      }
      if (validatedData.percentageType === "DIRECT_WORK" || validatedData.percentageType === "BOTH") {
        if (!validatedData.directWorkPercentage || validatedData.directWorkPercentage <= 0) {
          return NextResponse.json({ error: "Direct work percentage is required" }, { status: 400 })
        }
      }
    }

    // End any existing active compensation
    await prisma.userCompensation.updateMany({
      where: {
        userId,
        effectiveTo: null,
      },
      data: {
        effectiveTo: new Date(),
      },
    })

    const createData = buildNormalizedCompensationCreateData(userId, validatedData)
    const compensation = await prisma.userCompensation.create({
      data: createData,
    })

    return NextResponse.json({ compensation }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating compensation:", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: error.message || "Failed to create compensation" },
      { status: 500 }
    )
  }
}
