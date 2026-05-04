import { BillAttributionRole, ManagementAttributionRole, Prisma, PrismaClient } from "@prisma/client"

type TxClient = Prisma.TransactionClient | PrismaClient

export type BillAttributionRowInput = {
  userId: string
  role: BillAttributionRole
  splitPercent: number
  fixedAmount?: number | null
  sourceClientFinderId?: string | null
  sourceManagementSplitId?: string | null
  sourceProjectManagerId?: string | null
}

type SnapshotOptions = {
  tx: TxClient
  billId: string
  clientId?: string | null
  projectId?: string | null
  version?: number
  isBackfilled?: boolean
}

type ManagementRowForSnapshot = {
  id: string
  userId: string
  role: ManagementAttributionRole
  splitPercent: number
  fixedAmount: number | null
}

type ProjectManagerPick = { id: string; userId: string }

function ensurePercentTotalWithinLimit(rows: Array<{ splitPercent: number }>, label: string) {
  const total = rows.reduce((sum, row) => sum + row.splitPercent, 0)
  if (total > 100.0001) {
    throw new Error(`${label} split percentage cannot exceed 100`)
  }
}

/** Create a snapshot from explicit rows (invoice overrides); all source FKs optional. */
export async function createBillAttributionSnapshotFromRows(options: {
  tx: TxClient
  billId: string
  clientId?: string | null
  projectId?: string | null
  version?: number
  isBackfilled?: boolean
  rows: BillAttributionRowInput[]
}) {
  const { tx, billId, clientId = null, projectId = null, version = 1, isBackfilled = false, rows } = options
  const txAny = tx as any
  if (!txAny?.billAttributionSnapshot) {
    return null as any
  }

  const byRole = {
    FINDER: rows.filter((r) => r.role === BillAttributionRole.FINDER),
    CLIENT_MANAGER: rows.filter((r) => r.role === BillAttributionRole.CLIENT_MANAGER),
    PROJECT_MANAGER: rows.filter((r) => r.role === BillAttributionRole.PROJECT_MANAGER),
  }
  for (const [label, list] of Object.entries(byRole)) {
    ensurePercentTotalWithinLimit(
      list.map((r) => ({ splitPercent: r.splitPercent || 0 })),
      label
    )
  }

  return tx.billAttributionSnapshot.create({
    data: {
      billId,
      version,
      sourceClientId: clientId,
      sourceProjectId: projectId,
      isBackfilled,
      rows: {
        create: rows.map((row) => ({
          userId: row.userId,
          role: row.role,
          splitPercent: row.splitPercent ?? 0,
          fixedAmount: row.fixedAmount ?? null,
          sourceClientFinderId: row.sourceClientFinderId ?? null,
          sourceManagementSplitId: row.sourceManagementSplitId ?? null,
          sourceProjectManagerId: row.sourceProjectManagerId ?? null,
        })),
      },
    },
    include: { rows: true },
  })
}

/** Build default attribution rows from client finders/management + project managers. */
export async function buildDefaultBillAttributionRows(options: {
  tx: TxClient
  clientId?: string | null
  projectId?: string | null
}): Promise<BillAttributionRowInput[]> {
  const { tx, clientId = null, projectId = null } = options
  const txAny = tx as any

  const finderRows = clientId
    ? await tx.clientFinder.findMany({
        where: { clientId },
        select: { id: true, userId: true, finderFeePercent: true },
      })
    : []

  let managementRows: ManagementRowForSnapshot[] =
    clientId && txAny?.clientManagementSplit
      ? await txAny.clientManagementSplit.findMany({
          where: { clientId },
          select: { id: true, userId: true, role: true, splitPercent: true, fixedAmount: true },
        })
      : []

  const hasClientManagerSplit = managementRows.some(
    (row: ManagementRowForSnapshot) => row.role === ManagementAttributionRole.CLIENT_MANAGER
  )
  if (clientId && !hasClientManagerSplit) {
    const client = await tx.client.findUnique({
      where: { id: clientId },
      select: { clientManagerId: true },
    })
    if (client?.clientManagerId) {
      managementRows = [
        ...managementRows,
        {
          id: "__client_manager_default__",
          userId: client.clientManagerId,
          role: ManagementAttributionRole.CLIENT_MANAGER,
          splitPercent: 100,
          fixedAmount: null as number | null,
        },
      ]
    }
  }

  const projectManagers: ProjectManagerPick[] =
    projectId && txAny?.projectManager
      ? await txAny.projectManager.findMany({
          where: { projectId },
          select: { id: true, userId: true },
        })
      : []

  ensurePercentTotalWithinLimit(
    finderRows.map((row) => ({ splitPercent: row.finderFeePercent || 0 })),
    "Finder"
  )
  ensurePercentTotalWithinLimit(
    managementRows
      .filter((row: ManagementRowForSnapshot) => row.role === ManagementAttributionRole.CLIENT_MANAGER)
      .map((row: ManagementRowForSnapshot) => ({ splitPercent: row.splitPercent || 0 })),
    "Client manager"
  )
  ensurePercentTotalWithinLimit(
    managementRows
      .filter((row: ManagementRowForSnapshot) => row.role === ManagementAttributionRole.PROJECT_MANAGER)
      .map((row: ManagementRowForSnapshot) => ({ splitPercent: row.splitPercent || 0 })),
    "Project manager"
  )

  const projectManagerFallbackPercent =
    projectManagers.length > 0
      ? Number((100 / projectManagers.length).toFixed(6))
      : 0

  const rows: BillAttributionRowInput[] = [
    ...finderRows.map((row) => ({
      userId: row.userId,
      role: BillAttributionRole.FINDER,
      splitPercent: row.finderFeePercent || 0,
      sourceClientFinderId: row.id,
    })),
    ...managementRows.map((row: ManagementRowForSnapshot) => ({
      userId: row.userId,
      role:
        row.role === ManagementAttributionRole.CLIENT_MANAGER
          ? BillAttributionRole.CLIENT_MANAGER
          : BillAttributionRole.PROJECT_MANAGER,
      splitPercent: row.splitPercent || 0,
      fixedAmount: row.fixedAmount ?? null,
      sourceManagementSplitId:
        typeof row.id === "string" && row.id.startsWith("__") ? null : row.id,
    })),
    ...projectManagers
      .filter(
        (pm: ProjectManagerPick) =>
          !managementRows.some(
            (row: ManagementRowForSnapshot) =>
              row.role === ManagementAttributionRole.PROJECT_MANAGER && row.userId === pm.userId
          )
      )
      .map((pm: ProjectManagerPick) => ({
        userId: pm.userId,
        role: BillAttributionRole.PROJECT_MANAGER,
        splitPercent: projectManagerFallbackPercent,
        sourceProjectManagerId: pm.id,
      })),
  ]

  return rows
}

export async function createBillAttributionSnapshot(options: SnapshotOptions) {
  const { tx, billId, clientId = null, projectId = null, version = 1, isBackfilled = false } = options
  const txAny = tx as any
  if (!txAny?.billAttributionSnapshot) {
    return null as any
  }

  const defaultRows = await buildDefaultBillAttributionRows({ tx, clientId, projectId })

  const snapshot = await tx.billAttributionSnapshot.create({
    data: {
      billId,
      version,
      sourceClientId: clientId,
      sourceProjectId: projectId,
      isBackfilled,
      rows: {
        create: defaultRows.map((row) => ({
          userId: row.userId,
          role: row.role,
          splitPercent: row.splitPercent ?? 0,
          fixedAmount: row.fixedAmount ?? null,
          sourceClientFinderId: row.sourceClientFinderId ?? null,
          sourceManagementSplitId: row.sourceManagementSplitId ?? null,
          sourceProjectManagerId: row.sourceProjectManagerId ?? null,
        })),
      },
    },
    include: {
      rows: true,
    },
  })

  return snapshot
}
