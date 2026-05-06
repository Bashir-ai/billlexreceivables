export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { UserRole } from "@prisma/client"
import { POST as calculateCompensationForUser } from "@/app/api/users/[id]/compensation/calculate/route"
import { buildNormalizedCompensationCreateData } from "@/lib/compensation-create-data"

function supportsUserCompensationField(fieldName: string): boolean {
  try {
    const model = (prisma as any)?._runtimeDataModel?.models?.UserCompensation
    const fields = model?.fields
    return Array.isArray(fields) && fields.some((field: any) => field?.name === fieldName)
  } catch {
    return false
  }
}

const compensationSchema = z.object({
  compensationType: z.enum(["SALARY_BONUS", "PERCENTAGE_BASED", "SALARY_BONUS_FINDER_MANAGEMENT"]),
  baseSalary: z.number().positive().nullable().optional(),
  maxBonusMultiplier: z.number().min(0).nullable().optional(),
  percentageType: z.enum(["PROJECT_TOTAL", "DIRECT_WORK", "BOTH"]).nullable().optional(),
  projectPercentage: z.number().min(0).max(100).nullable().optional(),
  directWorkPercentage: z.number().min(0).max(100).nullable().optional(),
  projectFixedAmount: z.number().min(0).nullable().optional(),
  directWorkFixedAmount: z.number().min(0).nullable().optional(),
  bonusFixedAmount: z.number().min(0).nullable().optional(),
  bonusPercent: z.number().min(0).max(100).nullable().optional(),
  finderFeePercent: z.number().min(0).max(100).nullable().optional(),
  finderFeeFixedAmount: z.number().min(0).nullable().optional(),
  managementFeePercent: z.number().min(0).max(100).nullable().optional(),
  managementFeeFixedAmount: z.number().min(0).nullable().optional(),
  employmentStartDate: z.string().transform((str) => new Date(str)).nullable().optional(),
  bonusDueFrequency: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).nullable().optional(),
  bonusDueMonth: z.number().int().min(1).max(12).nullable().optional(),
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
      if (!validatedData.employmentStartDate) {
        return NextResponse.json(
          { error: "Employment start date is required (anchor for salary and bonus proration)" },
          { status: 400 }
        )
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
    } else if (validatedData.compensationType === "SALARY_BONUS_FINDER_MANAGEMENT") {
      if (!validatedData.baseSalary || validatedData.baseSalary <= 0) {
        return NextResponse.json({ error: "Base salary is required for salary + finder + management compensation" }, { status: 400 })
      }
      if (!validatedData.employmentStartDate) {
        return NextResponse.json(
          { error: "Employment start date is required (anchor for salary and bonus proration)" },
          { status: 400 }
        )
      }
    }

    // End any existing active compensation at the day before this new compensation starts.
    const previousEffectiveTo = new Date(validatedData.effectiveFrom.getTime() - 1)
    await prisma.userCompensation.updateMany({
      where: {
        userId,
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: validatedData.effectiveFrom } },
        ],
      },
      data: {
        effectiveTo: previousEffectiveTo,
      },
    })

    const createData: Record<string, unknown> = buildNormalizedCompensationCreateData(
      userId,
      validatedData
    )
    if (!supportsUserCompensationField("employmentStartDate")) {
      delete createData.employmentStartDate
    }
    if (!supportsUserCompensationField("bonusDueFrequency")) {
      delete createData.bonusDueFrequency
    }
    if (!supportsUserCompensationField("bonusDueMonth")) {
      delete createData.bonusDueMonth
    }
    const compensation = await prisma.userCompensation.create({
      data: createData as any,
    })

    // If compensation settings that govern finder/management payout changed, backfill paid-invoice
    // fee lines for all clients where this user participates in finder/management attribution.
    const compensationTouchesFeeRules =
      validatedData.finderFeePercent !== undefined ||
      validatedData.finderFeeFixedAmount !== undefined ||
      validatedData.managementFeePercent !== undefined ||
      validatedData.managementFeeFixedAmount !== undefined

    if (compensationTouchesFeeRules) {
      try {
        const [{ resyncFinderAndManagementFeesForClientPaidBills }, clientLinks] = await Promise.all([
          import("@/lib/attribution-fee-resync"),
          prisma.client.findMany({
            where: {
              deletedAt: null,
              OR: [
                { finders: { some: { userId } } },
                { managementSplits: { some: { userId } } },
                { clientManagerId: userId },
              ],
            },
            select: { id: true },
          }),
        ])

        const uniqueClientIds = Array.from(new Set(clientLinks.map((c) => c.id)))
        for (const clientId of uniqueClientIds) {
          await resyncFinderAndManagementFeesForClientPaidBills(clientId)
        }
      } catch (error) {
        // Do not block compensation save on backfill errors.
        console.error("Error backfilling paid-invoice finder/management fee lines:", error)
      }
    }

    // Auto-calculate all elapsed periods in this compensation interval so the Accounts tab is immediately up to date.
    const now = new Date()
    const startCursor = new Date(
      validatedData.effectiveFrom.getFullYear(),
      validatedData.effectiveFrom.getMonth(),
      1
    )
    const endBoundary =
      validatedData.effectiveTo && validatedData.effectiveTo < now
        ? validatedData.effectiveTo
        : new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    const endCursor = new Date(endBoundary.getFullYear(), endBoundary.getMonth(), 1)

    const failures: Array<{ year: number; month: number; error: string }> = []
    const cursor = new Date(startCursor)
    while (cursor <= endCursor) {
      const year = cursor.getFullYear()
      const month = cursor.getMonth() + 1
      try {
        const req = new Request("http://localhost/api/users/compensation/calculate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-cron": "compensation-calculate",
            ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
          },
          body: JSON.stringify({ year, month, forceRecalculate: true }),
        })
        await calculateCompensationForUser(req, { params: Promise.resolve({ id: userId }) })
      } catch (error: any) {
        failures.push({ year, month, error: error?.message || String(error) })
      }
      cursor.setMonth(cursor.getMonth() + 1)
    }

    return NextResponse.json({ compensation, catchupFailures: failures }, { status: 201 })
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
