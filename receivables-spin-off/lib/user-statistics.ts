import { prisma } from "./prisma"

export interface UserStatistics {
  userId: string
  userName: string
  userEmail: string
  // Billed hours and services
  billedHours: number
  billedAmount: number
  // Clients
  clientsFound: number
  clientsManaged: number
  // Projects
  projectsManaged: number
  // Todos
  todosAssigned: number
  todosOngoing: number
  todosCompleted: number
  todosReassigned: number
  // Finder fees
  finderFeesEarned: number
  finderFeesPaid: number
  finderFeesPending: number
}

/**
 * Calculate comprehensive statistics for a user
 */
export async function calculateUserStatistics(
  userId: string,
  options?: {
    startDate?: Date
    endDate?: Date
  }
): Promise<UserStatistics> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
    },
  })

  if (!user) {
    throw new Error("User not found")
  }

  const dateFilter = options?.startDate || options?.endDate
    ? {
        ...(options.startDate && { gte: options.startDate }),
        ...(options.endDate && { lte: options.endDate }),
      }
    : undefined

  // Billed amount (from paid bill items where personId matches)
  const billedBillItems = await prisma.billItem.findMany({
    where: {
      personId: userId,
      bill: {
        status: "PAID",
        ...(dateFilter && { paidAt: dateFilter }),
      },
    },
    include: {
      bill: true,
    },
  })
  const billedHours = billedBillItems
    .filter((item) => item.type === "TIMESHEET")
    .reduce((sum, item) => sum + (item.billedHours || item.quantity || 0), 0)
  const billedAmount = billedBillItems.reduce((sum, item) => sum + item.amount, 0)

  // Clients found (as Client Finder)
  const clientsFound = await prisma.clientFinder.count({
    where: {
      userId,
      ...(dateFilter && { createdAt: dateFilter }),
    },
  })

  // Clients managed (as Client Manager)
  const clientsManaged = await prisma.client.count({
    where: {
      clientManagerId: userId,
      deletedAt: null, // Exclude deleted clients
      ...(dateFilter && { createdAt: dateFilter }),
    },
  })

  // Retained shape for compatibility with existing API/UI.
  const projectsManaged = 0
  const todosAssigned = 0
  const todosOngoing = 0
  const todosCompleted = 0
  const todosReassigned = 0

  // Finder fees
  const finderFeesWhere: any = {
    finderId: userId,
  }
  if (dateFilter) {
    finderFeesWhere.earnedAt = dateFilter
  }

  const finderFees = await prisma.finderFee.findMany({
    where: finderFeesWhere,
  })

  const finderFeesEarned = finderFees.reduce((sum, fee) => sum + fee.finderFeeAmount, 0)
  const finderFeesPaid = finderFees.reduce((sum, fee) => sum + fee.paidAmount, 0)
  const finderFeesPending = finderFees.reduce((sum, fee) => sum + fee.remainingAmount, 0)

  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    billedHours,
    billedAmount,
    clientsFound,
    clientsManaged,
    projectsManaged,
    todosAssigned,
    todosOngoing,
    todosCompleted,
    todosReassigned,
    finderFeesEarned,
    finderFeesPaid,
    finderFeesPending,
  }
}

/**
 * Calculate statistics for all users (admin view)
 */
export async function calculateAllUsersStatistics(
  options?: {
    startDate?: Date
    endDate?: Date
  }
): Promise<UserStatistics[]> {
  const users = await prisma.user.findMany({
    where: {
      role: { not: "CLIENT" },
    },
    select: {
      id: true,
    },
  })

  const statistics = await Promise.all(
    users.map((user) => calculateUserStatistics(user.id, options))
  )

  return statistics
}




