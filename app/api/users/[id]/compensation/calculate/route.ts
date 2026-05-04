export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { UserRole, CompensationType } from "@prisma/client"
import { z } from "zod"

const calculateSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  bonusMultiplier: z.number().min(0).nullable().optional(),
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

    // Only admins can calculate compensation
    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 })
    }

    const { id } = await params
    const userId = id
    const body = await request.json()
    const validatedData = calculateSchema.parse(body)

    const { year, month, bonusMultiplier } = validatedData

    // Get active compensation for this period
    const compensation = await prisma.userCompensation.findFirst({
      where: {
        userId,
        effectiveFrom: { lte: new Date(year, month - 1, 1) },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: new Date(year, month - 1, 1) } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    })

    if (!compensation) {
      return NextResponse.json({ error: "No active compensation found for this period" }, { status: 404 })
    }

    // Check if entry already exists
    const existingEntry = await prisma.compensationEntry.findUnique({
      where: {
        userId_periodYear_periodMonth: {
          userId,
          periodYear: year,
          periodMonth: month,
        },
      },
    })

    if (existingEntry) {
      return NextResponse.json({ error: "Compensation entry already exists for this period" }, { status: 400 })
    }

    let totalEarned = 0
    let baseSalary = compensation.baseSalary ?? 0
    let bonusAmount: number | null = null
    let percentageEarnings: number | null = null

    if (compensation.compensationType === CompensationType.SALARY_BONUS) {
      // Base salary + bonus (SALARY_BONUS; shown in UI as "Salary + Bonus + Finder")
      const multiplier = bonusMultiplier ?? 0
      if (multiplier < 0 || (compensation.maxBonusMultiplier && multiplier > compensation.maxBonusMultiplier)) {
        return NextResponse.json({ 
          error: `Bonus multiplier must be between 0 and ${compensation.maxBonusMultiplier}` 
        }, { status: 400 })
      }
      bonusAmount = baseSalary * multiplier
      totalEarned = baseSalary + bonusAmount
    } else if (compensation.compensationType === CompensationType.PERCENTAGE_BASED) {
      // Percentage-based calculation
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0, 23, 59, 59)

      let projectTotalEarnings = 0
      let directWorkEarnings = 0

      // Get all eligibility records for this user and compensation
      const eligibilityRecords = await prisma.compensationEligibility.findMany({
        where: {
          userId,
          compensationId: compensation.id,
        },
      })

      // Create maps for quick lookup
      const projectEligibilityMap = new Map<string, boolean>()
      const clientEligibilityMap = new Map<string, boolean>()
      const billEligibilityMap = new Map<string, boolean>()

      for (const record of eligibilityRecords) {
        if (record.projectId) {
          projectEligibilityMap.set(record.projectId, record.isEligible)
        }
        if (record.clientId) {
          clientEligibilityMap.set(record.clientId, record.isEligible)
        }
        if (record.billId) {
          billEligibilityMap.set(record.billId, record.isEligible)
        }
      }

      // Helper function to check if a project is eligible
      const isProjectEligible = (project: any): boolean => {
        // Check project-specific eligibility first
        if (projectEligibilityMap.has(project.id)) {
          return projectEligibilityMap.get(project.id)!
        }
        // Check client-specific eligibility
        if (project.clientId && clientEligibilityMap.has(project.clientId)) {
          return clientEligibilityMap.get(project.clientId)!
        }
        // Default to eligible if no eligibility record exists (backward compatibility)
        return true
      }

      // Helper function to check if a bill is eligible
      const isBillEligible = (bill: any): boolean => {
        // Check bill-specific eligibility first
        if (billEligibilityMap.has(bill.id)) {
          return billEligibilityMap.get(bill.id)!
        }
        // If no bill-specific record, check project eligibility
        if (bill.projectId) {
          return isProjectEligible({ id: bill.projectId, clientId: null })
        }
        // Default to eligible
        return true
      }

      // Get projects user participated in (as manager or through timesheets)
      const userProjects = await prisma.project.findMany({
        where: {
          OR: [
            { projectManagers: { some: { userId } } },
            { timesheetEntries: { some: { userId, date: { gte: periodStart, lte: periodEnd } } } },
            { bills: { some: { items: { some: { personId: userId } } } } },
          ],
        },
        include: {
          proposal: {
            include: {
              items: true,
            },
          },
          bills: {
            where: {
              paidAt: { gte: periodStart, lte: periodEnd },
            },
            include: {
              items: true,
            },
          },
          timesheetEntries: {
            where: {
              userId,
              date: { gte: periodStart, lte: periodEnd },
            },
          },
        },
      })

      for (const project of userProjects) {
        // Check if project is eligible
        if (!isProjectEligible(project)) {
          continue // Skip this project
        }
        
        // Calculate project total value (from paid invoices that are eligible)
        // Note: Expenses are NEVER included in compensation calculations
        const projectTotal = project.bills
          .filter(bill => bill.paidAt && isBillEligible(bill))
          .reduce((sum, bill) => sum + bill.amount, 0)

        // Calculate direct work value (from timesheets and bill items)
        const directWork = project.timesheetEntries.reduce((sum, entry) => {
          return sum + (entry.hours * (entry.rate || 0))
        }, 0)

        // Also check bill items for this user (only from eligible bills)
        const billItemsValue = project.bills
          .filter(bill => isBillEligible(bill))
          .flatMap(bill => bill.items)
          .filter(item => item.personId === userId)
          .reduce((sum, item) => sum + item.amount, 0)

        const totalDirectWork = directWork + billItemsValue

        // Apply percentages based on compensation type
        if (compensation.percentageType === "PROJECT_TOTAL" || compensation.percentageType === "BOTH") {
          if (compensation.projectPercentage) {
            projectTotalEarnings += projectTotal * (compensation.projectPercentage / 100)
          }
        }

        if (compensation.percentageType === "DIRECT_WORK" || compensation.percentageType === "BOTH") {
          if (compensation.directWorkPercentage) {
            directWorkEarnings += totalDirectWork * (compensation.directWorkPercentage / 100)
          }
        }
      }

      percentageEarnings = projectTotalEarnings + directWorkEarnings
      totalEarned = percentageEarnings
    }

    // Create compensation entry
    const entry = await prisma.compensationEntry.create({
      data: {
        userId,
        compensationId: compensation.id,
        periodYear: year,
        periodMonth: month,
        baseSalary: compensation.baseSalary,
        bonusMultiplier: bonusMultiplier ?? null,
        bonusAmount,
        percentageEarnings,
        totalEarned,
        totalPaid: 0,
        balance: totalEarned,
        calculatedAt: new Date(),
      },
    })

    // Create transaction record
    await prisma.userFinancialTransaction.create({
      data: {
        userId,
        type: "COMPENSATION",
        relatedId: entry.id,
        relatedType: "COMPENSATION_ENTRY",
        amount: totalEarned,
        currency: "EUR", // TODO: Get from user settings
        transactionDate: new Date(year, month - 1, 1),
        description: `Compensation for ${year}-${month.toString().padStart(2, '0')}`,
        createdBy: session.user.id,
      },
    })

    return NextResponse.json({ entry }, { status: 201 })
  } catch (error: any) {
    console.error("Error calculating compensation:", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: error.message || "Failed to calculate compensation" },
      { status: 500 }
    )
  }
}
