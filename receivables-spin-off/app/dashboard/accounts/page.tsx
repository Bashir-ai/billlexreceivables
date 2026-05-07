"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import Link from "next/link"
import {
  Calendar,
  DollarSign,
  TrendingUp,
  Wallet,
  Gift,
  ArrowUpDown,
  Users,
  Trash2,
  Building2,
  BarChart3,
} from "lucide-react"
import { TimeFilter } from "@/components/accounts/TimeFilter"
import { CompensationSection } from "@/components/accounts/CompensationSection"
import { AdvancesSection } from "@/components/accounts/AdvancesSection"
import { BenefitsSection } from "@/components/accounts/BenefitsSection"
import { TransactionsList } from "@/components/accounts/TransactionsList"
import { FinderClientsSection } from "@/components/accounts/FinderClientsSection"

/** API may return `{ error }` on failure; always treat as list for UI. */
function feeListFromApiResponse<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

interface FinderFee {
  id: string
  bill: {
    id: string
    invoiceNumber: string | null
    amount: number
    paidAt: string | null
  }
  client: {
    id: string
    name: string
    company: string | null
  }
  invoiceNetAmount: number
  finderFeePercent: number
  finderFeeAmount: number
  status: "PENDING" | "PARTIALLY_PAID" | "PAID"
  paidAmount: number
  remainingAmount: number
  earnedAt: string
  paidAt: string | null
  payments: Array<{
    id: string
    amount: number
    paymentDate: string
    notes: string | null
  }>
}

interface ManagementFee {
  id: string
  role: string
  bill: {
    id: string
    invoiceNumber: string | null
    amount: number
    paidAt: string | null
  }
  client: {
    id: string
    name: string
    company: string | null
  }
  invoiceNetAmount: number
  attributionBaseAmount: number
  compensationPercentApplied: number
  feeAmount: number
  status: "PENDING" | "PARTIALLY_PAID" | "PAID"
  paidAmount: number
  remainingAmount: number
  earnedAt: string
  paidAt: string | null
  payments: Array<{
    id: string
    amount: number
    paymentDate: string
    notes: string | null
  }>
}

type TabType =
  | "compensation"
  | "advances"
  | "benefits"
  | "transactions"
  | "finderFees"
  | "managementFees"
  | "finderClients"

export default function AccountsPage() {
  const { data: session } = useSession()
  const [activeTab, setActiveTab] = useState<TabType>("compensation")
  const [startDate, setStartDate] = useState<string | null>(null)
  const [endDate, setEndDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [finderFees, setFinderFees] = useState<FinderFee[]>([])
  const [managementFees, setManagementFees] = useState<ManagementFee[]>([])
  const [selectedStatus, setSelectedStatus] = useState<string>("")
  const [selectedClientId, setSelectedClientId] = useState<string>("")
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [stats, setStats] = useState({
    totalEarned: 0,
    totalPaid: 0,
    totalPending: 0,
  })
  const [mgmtStats, setMgmtStats] = useState({
    totalEarned: 0,
    totalPaid: 0,
    totalPending: 0,
  })
  const [accountsSummary, setAccountsSummary] = useState<any>(null)
  const [selectedUserId, setSelectedUserId] = useState<string>("")
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [finderClients, setFinderClients] = useState<any[]>([])
  const [finderClientsLoading, setFinderClientsLoading] = useState(false)
  const [personnelStart, setPersonnelStart] = useState<string>(
    new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1).toISOString().slice(0, 10)
  )
  const [personnelEnd, setPersonnelEnd] = useState<string>(new Date().toISOString().slice(0, 10))
  const [peopleMetric, setPeopleMetric] = useState<"paidOut" | "accrued" | "netBalance">("paidOut")
  const [personnelAnalytics, setPersonnelAnalytics] = useState<{
    monthlyPersonnelCost: Array<{ monthKey: string; monthLabel: string; totalCost: number }>
    peopleComparison: Array<{
      userId: string
      name: string
      role: string
      paidOut: number
      accrued: number
      netBalance: number
    }>
  } | null>(null)
  const [personnelLoading, setPersonnelLoading] = useState(false)

  useEffect(() => {
    if (!session) return

    // If admin, fetch users list
    if (session.user.role === "ADMIN" || session.user.role === "MANAGER") {
      fetch("/api/users")
        .then((res) => res.json())
        .then((data) => {
          setUsers(data.filter((u: any) => u.role !== "CLIENT"))
          setSelectedUserId(session.user.id)
        })
        .catch(console.error)
    } else if (session.user.role === "EXTERNAL") {
      // EXTERNAL users can only view their own account
      setSelectedUserId(session.user.id)
    }

    // Fetch clients for filter
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => {
        setClients(data.map((c: any) => ({ id: c.id, name: c.name })))
      })
      .catch(console.error)
  }, [session])

  useEffect(() => {
    if (!session) return

    const targetUserId =
      (session.user.role === "ADMIN" || session.user.role === "MANAGER") && selectedUserId
        ? selectedUserId
        : session.user.id

    // Fetch accounts summary
    const params = new URLSearchParams()
    if (startDate) params.set("startDate", startDate)
    if (endDate) params.set("endDate", endDate)
    if (session.user.role === "ADMIN" || session.user.role === "MANAGER") {
      params.set("teamSummary", "true")
    }

    fetch(`/api/users/${targetUserId}/accounts?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setAccountsSummary(data)
      })
      .catch(console.error)

    // Fetch finder fees
    setLoading(true)
    const finderParams = new URLSearchParams()
    if (selectedStatus) finderParams.set("status", selectedStatus)
    if (selectedClientId) finderParams.set("clientId", selectedClientId)
    if (startDate) finderParams.set("startDate", startDate)
    if (endDate) finderParams.set("endDate", endDate)
    if (
      (session.user.role === "ADMIN" || session.user.role === "MANAGER") &&
      selectedUserId
    ) {
      finderParams.set("userId", selectedUserId)
    }

    const mgmtParams = new URLSearchParams(finderParams)
    Promise.all([
      fetch(`/api/finder-fees?${finderParams.toString()}`).then((res) => res.json()),
      fetch(`/api/management-fees?${mgmtParams.toString()}`).then((res) => res.json()),
    ])
      .then(([finderData, mgmtData]) => {
        const finderList = feeListFromApiResponse<FinderFee>(finderData)
        const mgmtList = feeListFromApiResponse<ManagementFee>(mgmtData)

        setFinderFees(finderList)
        const totalEarned = finderList.reduce((sum, fee) => sum + fee.finderFeeAmount, 0)
        const totalPaid = finderList.reduce((sum, fee) => sum + fee.paidAmount, 0)
        const totalPending = finderList.reduce((sum, fee) => sum + fee.remainingAmount, 0)
        setStats({ totalEarned, totalPaid, totalPending })

        setManagementFees(mgmtList)
        const mEarned = mgmtList.reduce((sum, fee) => sum + fee.feeAmount, 0)
        const mPaid = mgmtList.reduce((sum, fee) => sum + fee.paidAmount, 0)
        const mPending = mgmtList.reduce((sum, fee) => sum + fee.remainingAmount, 0)
        setMgmtStats({ totalEarned: mEarned, totalPaid: mPaid, totalPending: mPending })
        setLoading(false)
      })
      .catch((err) => {
        console.error(err)
        setLoading(false)
      })

    // Fetch finder clients for EXTERNAL users
    if (session.user.role === "EXTERNAL") {
      setFinderClientsLoading(true)
      fetch(`/api/users/${targetUserId}/finder-clients`)
        .then((res) => res.json())
        .then((data) => {
          setFinderClients(data.clients || [])
          setFinderClientsLoading(false)
        })
        .catch((err) => {
          console.error(err)
          setFinderClientsLoading(false)
        })
    }
  }, [session, selectedStatus, selectedClientId, selectedUserId, startDate, endDate])

  useEffect(() => {
    if (!session) return
    setPersonnelLoading(true)
    const params = new URLSearchParams({
      startDate: personnelStart,
      endDate: personnelEnd,
    })
    if ((session.user.role === "ADMIN" || session.user.role === "MANAGER") && selectedUserId) {
      params.set("userId", selectedUserId)
    }
    fetch(`/api/accounts/personnel-analytics?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setPersonnelAnalytics(data))
      .catch(console.error)
      .finally(() => setPersonnelLoading(false))
  }, [session, selectedUserId, personnelStart, personnelEnd])

  const handleDeleteFinderFee = async (finderFeeId: string) => {
    if (!confirm("Delete this finder fee line and related payout transactions? This cannot be undone.")) return
    try {
      const response = await fetch(`/api/finder-fees/${finderFeeId}`, {
        method: "DELETE",
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || "Failed to delete finder fee line")
      }

      const targetUserId =
        (session?.user.role === "ADMIN" || session?.user.role === "MANAGER") && selectedUserId
          ? selectedUserId
          : session?.user.id
      if (!targetUserId) return

      const finderParams = new URLSearchParams()
      if (selectedStatus) finderParams.set("status", selectedStatus)
      if (selectedClientId) finderParams.set("clientId", selectedClientId)
      if (startDate) finderParams.set("startDate", startDate)
      if (endDate) finderParams.set("endDate", endDate)
      if (
        (session?.user.role === "ADMIN" || session?.user.role === "MANAGER") &&
        selectedUserId
      ) {
        finderParams.set("userId", selectedUserId)
      }
      const [refreshed, mgmtRefreshed] = await Promise.all([
        fetch(`/api/finder-fees?${finderParams.toString()}`).then((res) => res.json()),
        fetch(`/api/management-fees?${finderParams.toString()}`).then((res) => res.json()),
      ])
      const finderList = feeListFromApiResponse<FinderFee>(refreshed)
      const mgmtList = feeListFromApiResponse<ManagementFee>(mgmtRefreshed)
      setFinderFees(finderList)
      const totalEarned = finderList.reduce((sum, fee) => sum + fee.finderFeeAmount, 0)
      const totalPaid = finderList.reduce((sum, fee) => sum + fee.paidAmount, 0)
      const totalPending = finderList.reduce((sum, fee) => sum + fee.remainingAmount, 0)
      setStats({ totalEarned, totalPaid, totalPending })
      setManagementFees(mgmtList)
      setMgmtStats({
        totalEarned: mgmtList.reduce((s, fee) => s + fee.feeAmount, 0),
        totalPaid: mgmtList.reduce((s, fee) => s + fee.paidAmount, 0),
        totalPending: mgmtList.reduce((s, fee) => s + fee.remainingAmount, 0),
      })
    } catch (error: any) {
      alert(error?.message || "Failed to delete finder fee line")
    }
  }

  if (!session) {
    return <div>Loading...</div>
  }

  const isAdmin = session.user.role === "ADMIN"
  const isManager = session.user.role === "MANAGER"
  const isExternal = session.user.role === "EXTERNAL"
  const targetUserId =
    (isAdmin || isManager) && selectedUserId ? selectedUserId : session.user.id

  const tabs: Array<{ id: TabType; label: string; icon: any }> = [
    { id: "compensation", label: "Compensation", icon: DollarSign },
    { id: "advances", label: "Advances", icon: Wallet },
    { id: "benefits", label: "Benefits", icon: Gift },
    { id: "transactions", label: "Transactions", icon: ArrowUpDown },
    { id: "finderFees", label: "Finder Fees", icon: TrendingUp },
    { id: "managementFees", label: "Management Fees", icon: Building2 },
    ...(isExternal ? [{ id: "finderClients" as TabType, label: "Finder Clients", icon: Users }] : []),
  ]

  const comparisonValue = (row: any) => {
    if (peopleMetric === "accrued") return row.accrued ?? 0
    if (peopleMetric === "netBalance") return row.netBalance ?? 0
    return row.paidOut ?? 0
  }

  const comparisonLabel =
    peopleMetric === "accrued"
      ? "Accrued"
      : peopleMetric === "netBalance"
        ? "Net balance"
        : "Paid out"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Financial Accounts</h1>
          <p className="text-gray-600 mt-2">Comprehensive financial tracking and management</p>
        </div>
      </div>

      {/* User selector for admins and managers (not for EXTERNAL users) */}
      {(isAdmin || isManager) && !isExternal && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium">View Account For:</label>
              <Select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="min-w-[200px]"
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time Filter */}
      <TimeFilter
        startDate={startDate}
        endDate={endDate}
        onDateChange={(start, end) => {
          setStartDate(start)
          setEndDate(end)
        }}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Balance</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {(() => {
              const fp = accountsSummary?.feePosition
              const ledger = fp?.ledgerNet ?? accountsSummary?.balance ?? 0
              const pendingF = fp?.pendingFinderPayout
              const pendingM = fp?.pendingManagementPayout
              const total =
                typeof fp?.totalWithPendingFees === "number"
                  ? fp.totalWithPendingFees
                  : typeof pendingF === "number" && typeof pendingM === "number"
                    ? ledger + pendingF + pendingM
                    : ledger
              return (
                <>
                  <div
                    className={`text-2xl font-bold ${
                      total >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(total)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Posted ledger + pending finder &amp; management fees (all-time, not yet paid out)
                  </p>
                  {typeof pendingF === "number" && typeof pendingM === "number" ? (
                    <p className="text-xs text-muted-foreground mt-2 border-t pt-2 space-y-0.5">
                      <span className="block">
                        Posted ledger:{" "}
                        <span className="font-medium text-foreground">{formatCurrency(ledger)}</span>
                      </span>
                      <span className="block">
                        Pending finder fee payout (all-time):{" "}
                        <span className="font-medium text-foreground">{formatCurrency(pendingF)}</span>
                      </span>
                      <span className="block">
                        Pending management fee payout (all-time):{" "}
                        <span className="font-medium text-foreground">{formatCurrency(pendingM)}</span>
                      </span>
                      <span className="block text-[11px] pt-1">
                        Your share of unpaid client invoices (not cash):{" "}
                        {formatCurrency(fp?.unpaidInvoiceAttributedTotal ?? 0)}
                      </span>
                    </p>
                  ) : null}
                </>
              )
            })()}
            {typeof accountsSummary?.ledgerNetInFilter === "number" && (startDate || endDate) ? (
              <p className="text-xs text-muted-foreground mt-1">
                Net in date filter: {formatCurrency(accountsSummary.ledgerNetInFilter)}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">YTD Earnings</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(accountsSummary?.ytdEarnings || 0)}</div>
            <p className="text-xs text-gray-500 mt-1">Year to date</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Earnings in period</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(accountsSummary?.monthlyEarnings || 0)}</div>
            <p className="text-xs text-gray-500 mt-1">Same window as the detailed cards below (comp. + fees per plan)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Advances</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(accountsSummary?.totalAdvances || 0)}</div>
            <p className="text-xs text-gray-500 mt-1">
              {startDate || endDate ? "Advances in selected date range" : "All-time advances (gross of advance lines)"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Benefits</CardTitle>
            <Gift className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(accountsSummary?.totalBenefits || 0)}</div>
            <p className="text-xs text-gray-500 mt-1">
              {startDate || endDate ? "In selected period" : "This year"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personnel Cost and Team Comparison</CardTitle>
          <CardDescription>
            Cash-flow lens for personnel cost and a multi-metric comparison between people.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <input
                type="date"
                className="w-full rounded border px-2 py-1.5 text-sm"
                value={personnelStart}
                onChange={(e) => setPersonnelStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <input
                type="date"
                className="w-full rounded border px-2 py-1.5 text-sm"
                value={personnelEnd}
                onChange={(e) => setPersonnelEnd(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">People comparison metric</label>
              <Select value={peopleMetric} onChange={(e) => setPeopleMetric(e.target.value as any)}>
                <option value="paidOut">Paid out</option>
                <option value="accrued">Accrued</option>
                <option value="netBalance">Net balance</option>
              </Select>
            </div>
          </div>
          {personnelLoading ? (
            <p className="text-sm text-muted-foreground">Loading personnel analytics...</p>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      Monthly Personnel Cost
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-2xl font-semibold">
                      {formatCurrency(
                        (personnelAnalytics?.monthlyPersonnelCost || []).reduce(
                          (sum, m) => sum + (m.totalCost || 0),
                          0
                        )
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Total paid out in selected range</p>
                    {(personnelAnalytics?.monthlyPersonnelCost || []).map((m) => (
                      <div key={m.monthKey} className="flex items-center justify-between text-xs border-b pb-1">
                        <span>{m.monthLabel}</span>
                        <span className="font-medium">{formatCurrency(m.totalCost)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">People comparison — {comparisonLabel}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(() => {
                      const rows = [...(personnelAnalytics?.peopleComparison || [])].sort(
                        (a, b) => comparisonValue(b) - comparisonValue(a)
                      )
                      const max = Math.max(1, ...rows.map((r) => Math.abs(comparisonValue(r))))
                      return rows.map((row) => {
                        const value = comparisonValue(row)
                        const width = `${(Math.abs(value) / max) * 100}%`
                        return (
                          <div key={row.userId} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span>
                                {row.name} <span className="text-muted-foreground">({row.role})</span>
                              </span>
                              <span className={value < 0 ? "text-red-700 font-medium" : "font-medium"}>
                                {formatCurrency(value)}
                              </span>
                            </div>
                            <div className="h-2 rounded bg-muted overflow-hidden">
                              <div
                                className={`h-full ${value < 0 ? "bg-red-500" : "bg-blue-500"}`}
                                style={{ width }}
                              />
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {accountsSummary && accountsSummary.attributionSnapshotsEnabled === false ? (
        <Card className="border-amber-300 bg-amber-50/80">
          <CardContent className="pt-4 text-sm text-amber-900">
            Invoice attribution snapshots are not available in this environment (schema or client).{" "}
            <span className="font-medium">Your pending attributed share</span> and the team receivables table will show
            zero until snapshots are enabled.
          </CardContent>
        </Card>
      ) : null}

      {accountsSummary?.reconciliation ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Period reconciliation (same window as detail cards below)</CardTitle>
            <CardDescription>
              The summary total in the first card is all-time (ledger + pending finder and management fees). Detail cards
              below use the same window as &quot;Your pending share&quot; and &quot;Ledger (period)&quot; when no custom
              range is set (calendar YTD through today for fee earned dates, or your selected range).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Matured accruals (period)</p>
                <p className="text-lg font-semibold">{formatCurrency(accountsSummary.reconciliation.matured?.total ?? 0)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Advances in period (gross)</p>
                <p className="text-lg font-semibold text-amber-800">
                  {formatCurrency(accountsSummary.reconciliation.advanced?.total ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Payouts in period</p>
                <p className="text-lg font-semibold text-blue-800">
                  {formatCurrency(accountsSummary.reconciliation.reconciled?.total ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">All-time ledger net (current position)</p>
                <p
                  className={`text-lg font-semibold ${
                    (accountsSummary.reconciliation.netBalance ?? 0) >= 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {formatCurrency(accountsSummary.reconciliation.netBalance ?? 0)}
                </p>
                {accountsSummary.reconciliation.reconciled?.lastReconciledAt ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last payout in this window: {formatDate(accountsSummary.reconciliation.reconciled.lastReconciledAt)}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Attributed receivables + ledger (aligned with compensation / finder fees) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Your pending attributed share</CardTitle>
            <CardDescription className="text-xs">
              Unpaid invoices (firm receivables), using locked invoice attribution
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-700">
              {formatCurrency(accountsSummary?.receivables?.outstandingAttributed?.total ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Finder{" "}
              {formatCurrency(accountsSummary?.receivables?.outstandingAttributed?.finder ?? 0)} · Mgmt{" "}
              {formatCurrency(accountsSummary?.receivables?.outstandingAttributed?.management ?? 0)} ·{" "}
              {accountsSummary?.receivables?.outstandingAttributed?.invoiceCount ?? 0} invoices
            </p>
            {accountsSummary?.attributionSnapshotsEnabled !== false &&
            (accountsSummary?.receivables?.outstandingAttributed?.total ?? 0) === 0 &&
            typeof accountsSummary?.receivables?.billsMissingAttribution === "number" &&
            accountsSummary.receivables.billsMissingAttribution > 0 ? (
              <p className="text-xs text-amber-800 mt-2">
                {accountsSummary.receivables.billsMissingAttribution} unpaid invoice(s) have no attribution snapshot yet.
                They are calculated using current client finder/manager rules where available.
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Realized attributed (paid invoices)</CardTitle>
            <CardDescription className="text-xs">
              Client-paid invoices
              {accountsSummary?.receivables?.reportingPeriod?.isCustomRange
                ? " in the selected period"
                : " (calendar year)"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">
              {formatCurrency(accountsSummary?.receivables?.realizedAttributed?.total ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {accountsSummary?.receivables?.realizedAttributed?.billCount ?? 0} paid invoices
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Finder fees (period)</CardTitle>
            <CardDescription className="text-xs">
              Earned when invoices are marked paid
              {!accountsSummary?.receivables?.reportingPeriod?.isCustomRange
                ? " (calendar year, through today for earned dates)"
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending payout</span>
                <span className="font-semibold">
                  {formatCurrency(accountsSummary?.finderFeesRollup?.totalPending ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid out</span>
                <span className="font-semibold">
                  {formatCurrency(accountsSummary?.finderFeesRollup?.totalPaidOut ?? 0)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Management fees (period)</CardTitle>
            <CardDescription className="text-xs">
              Client / project manager fee lines on paid invoices
              {!accountsSummary?.receivables?.reportingPeriod?.isCustomRange
                ? " (calendar year, through today for earned dates)"
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending payout</span>
                <span className="font-semibold">
                  {formatCurrency(accountsSummary?.managementFeesRollup?.totalPending ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid out</span>
                <span className="font-semibold">
                  {formatCurrency(accountsSummary?.managementFeesRollup?.totalPaidOut ?? 0)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ledger (period)</CardTitle>
            <CardDescription className="text-xs">
              Sum of transactions by type
              {!accountsSummary?.receivables?.reportingPeriod?.isCustomRange ? " (calendar year)" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-1 font-mono">
              {accountsSummary?.ledgerByType &&
              Object.keys(accountsSummary.ledgerByType).length > 0 ? (
                Object.entries(accountsSummary.ledgerByType).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span>{k}</span>
                    <span>{formatCurrency(Number(v))}</span>
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">No transactions in range</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {(isAdmin || isManager) &&
        accountsSummary?.teamPendingAttribution &&
        accountsSummary.teamPendingAttribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Team — pending attributed receivables</CardTitle>
              <CardDescription>
                Each person&apos;s share of outstanding invoices (before client payment).{" "}
                {typeof accountsSummary?.receivables?.billsMissingAttribution === "number" &&
                accountsSummary.receivables.billsMissingAttribution > 0 ? (
                  <span className="text-amber-700">
                    {accountsSummary.receivables.billsMissingAttribution} invoice(s) lack attribution snapshots.
                    Fallback client finder/manager rules are used where available
                    {typeof accountsSummary?.receivables?.billsUsingFallbackAttribution === "number"
                      ? ` (${accountsSummary.receivables.billsUsingFallbackAttribution} currently resolved).`
                      : "."}
                  </span>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Person</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4 text-right">Pending total</th>
                    <th className="py-2 pr-4 text-right">Finder</th>
                    <th className="py-2 pr-4 text-right">Management</th>
                    <th className="py-2 pr-4 text-right">Invoices</th>
                  </tr>
                </thead>
                <tbody>
                  {accountsSummary.teamPendingAttribution.map((row: any) => (
                    <tr key={row.userId} className="border-b border-muted/50">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      </td>
                      <td className="py-2 pr-4">{row.role}</td>
                      <td className="py-2 pr-4 text-right font-semibold">
                        {formatCurrency(row.outstanding?.total ?? 0)}
                      </td>
                      <td className="py-2 pr-4 text-right">{formatCurrency(row.outstanding?.finder ?? 0)}</td>
                      <td className="py-2 pr-4 text-right">
                        {formatCurrency(row.outstanding?.management ?? 0)}
                      </td>
                      <td className="py-2 pr-4 text-right">{row.outstanding?.invoiceCount ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

      {/* Tabs */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex space-x-1 border-b mb-6">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-primary text-primary font-semibold"
                      : "border-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Tab Content */}
          {activeTab === "compensation" && (
            <CompensationSection
              userId={targetUserId}
              startDate={startDate}
              endDate={endDate}
              isAdmin={isAdmin}
            />
          )}

          {activeTab === "advances" && (
            <AdvancesSection
              userId={targetUserId}
              startDate={startDate}
              endDate={endDate}
              isAdmin={isAdmin}
            />
          )}

          {activeTab === "benefits" && (
            <BenefitsSection
              userId={targetUserId}
              startDate={startDate}
              endDate={endDate}
              isAdmin={isAdmin || isManager}
            />
          )}

          {activeTab === "transactions" && (
            <TransactionsList
              userId={targetUserId}
              startDate={startDate}
              endDate={endDate}
              isAdmin={isAdmin}
              isManager={isManager}
            />
          )}

          {activeTab === "finderFees" && (
            <div className="space-y-6">
              {/* Finder Fees Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(stats.totalEarned)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(stats.totalPaid)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Pending</CardTitle>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(stats.totalPending)}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Filters */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <label className="text-sm font-medium mr-2">Status:</label>
                      <Select
                        value={selectedStatus}
                        onChange={(e) => setSelectedStatus(e.target.value)}
                      >
                        <option value="">All</option>
                        <option value="PENDING">Pending</option>
                        <option value="PARTIALLY_PAID">Partially Paid</option>
                        <option value="PAID">Paid</option>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mr-2">Client:</label>
                      <Select
                        value={selectedClientId}
                        onChange={(e) => setSelectedClientId(e.target.value)}
                      >
                        <option value="">All Clients</option>
                        {clients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Finder Fees List */}
              {loading ? (
                <div>Loading...</div>
              ) : finderFees.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-gray-500">No finder fees found</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {finderFees.map((fee) => (
                    <Card key={fee.id} className="border-l-4 border-l-blue-500">
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-4 mb-2">
                              <Link
                                href={`/dashboard/bills/${fee.bill.id}`}
                                className="font-semibold text-blue-600 hover:underline"
                              >
                                Invoice: {fee.bill.invoiceNumber || fee.bill.id}
                              </Link>
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  fee.status === "PAID"
                                    ? "bg-green-100 text-green-800"
                                    : fee.status === "PARTIALLY_PAID"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-gray-100 text-gray-800"
                                }`}
                              >
                                {fee.status.replace("_", " ")}
                              </span>
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              <Link
                                href={`/dashboard/clients/${fee.client.id}`}
                                className="hover:underline"
                              >
                                Client: {fee.client.name}
                                {fee.client.company && ` (${fee.client.company})`}
                              </Link>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-gray-600">Fee Amount:</span>
                                <div className="font-semibold">{formatCurrency(fee.finderFeeAmount)}</div>
                              </div>
                              <div>
                                <span className="text-gray-600">Paid:</span>
                                <div className="font-semibold">{formatCurrency(fee.paidAmount)}</div>
                              </div>
                              <div>
                                <span className="text-gray-600">Remaining:</span>
                                <div className="font-semibold">{formatCurrency(fee.remainingAmount)}</div>
                              </div>
                              <div>
                                <span className="text-gray-600">Earned At:</span>
                                <div className="font-semibold">{formatDate(fee.earnedAt)}</div>
                              </div>
                            </div>
                            {fee.payments && fee.payments.length > 0 && (
                              <div className="mt-4 pt-4 border-t">
                                <div className="text-sm font-medium mb-2">Payment History:</div>
                                <div className="space-y-2">
                                  {fee.payments.map((payment) => (
                                    <div key={payment.id} className="flex justify-between text-sm">
                                      <span>{formatDate(payment.paymentDate)}</span>
                                      <span className="font-semibold">{formatCurrency(payment.amount)}</span>
                                      {payment.notes && (
                                        <span className="text-gray-500"> - {payment.notes}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          {(isAdmin || isManager) && fee.status !== "PAID" && (
                            <div className="flex gap-2">
                              <Link href={`/dashboard/accounts/${fee.id}/pay`}>
                                <Button variant="outline" size="sm">
                                  Record Payment
                                </Button>
                              </Link>
                              {isAdmin && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteFinderFee(fee.id)}
                                  title="Delete finder fee line"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "managementFees" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(mgmtStats.totalEarned)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(mgmtStats.totalPaid)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Pending</CardTitle>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(mgmtStats.totalPending)}</div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <label className="text-sm font-medium mr-2">Status:</label>
                      <Select
                        value={selectedStatus}
                        onChange={(e) => setSelectedStatus(e.target.value)}
                      >
                        <option value="">All</option>
                        <option value="PENDING">Pending</option>
                        <option value="PARTIALLY_PAID">Partially Paid</option>
                        <option value="PAID">Paid</option>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mr-2">Client:</label>
                      <Select
                        value={selectedClientId}
                        onChange={(e) => setSelectedClientId(e.target.value)}
                      >
                        <option value="">All Clients</option>
                        {clients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {loading ? (
                <div>Loading...</div>
              ) : managementFees.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-gray-500">No management fees found</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {managementFees.map((fee) => (
                    <Card key={fee.id} className="border-l-4 border-l-emerald-600">
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-4 mb-2">
                              <Link
                                href={`/dashboard/bills/${fee.bill.id}`}
                                className="font-semibold text-blue-600 hover:underline"
                              >
                                Invoice: {fee.bill.invoiceNumber || fee.bill.id}
                              </Link>
                              <span className="text-xs text-muted-foreground">
                                {fee.role.replace("_", " ")}
                              </span>
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  fee.status === "PAID"
                                    ? "bg-green-100 text-green-800"
                                    : fee.status === "PARTIALLY_PAID"
                                      ? "bg-yellow-100 text-yellow-800"
                                      : "bg-gray-100 text-gray-800"
                                }`}
                              >
                                {fee.status.replace("_", " ")}
                              </span>
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              <Link
                                href={`/dashboard/clients/${fee.client.id}`}
                                className="hover:underline"
                              >
                                Client: {fee.client.name}
                                {fee.client.company && ` (${fee.client.company})`}
                              </Link>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-gray-600">Fee amount:</span>
                                <div className="font-semibold">{formatCurrency(fee.feeAmount)}</div>
                              </div>
                              <div>
                                <span className="text-gray-600">Paid:</span>
                                <div className="font-semibold">{formatCurrency(fee.paidAmount)}</div>
                              </div>
                              <div>
                                <span className="text-gray-600">Remaining:</span>
                                <div className="font-semibold">{formatCurrency(fee.remainingAmount)}</div>
                              </div>
                              <div>
                                <span className="text-gray-600">Earned at:</span>
                                <div className="font-semibold">{formatDate(fee.earnedAt)}</div>
                              </div>
                            </div>
                            {fee.payments && fee.payments.length > 0 && (
                              <div className="mt-4 pt-4 border-t">
                                <div className="text-sm font-medium mb-2">Payment history</div>
                                <div className="space-y-2">
                                  {fee.payments.map((payment) => (
                                    <div key={payment.id} className="flex justify-between text-sm">
                                      <span>{formatDate(payment.paymentDate)}</span>
                                      <span className="font-semibold">{formatCurrency(payment.amount)}</span>
                                      {payment.notes && (
                                        <span className="text-gray-500"> — {payment.notes}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          {(isAdmin || isManager) && fee.status !== "PAID" && (
                            <Link href={`/dashboard/accounts/management-fees/${fee.id}/pay`}>
                              <Button variant="outline" size="sm">
                                Record payment
                              </Button>
                            </Link>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "finderClients" && isExternal && (
            <FinderClientsSection clients={finderClients} loading={finderClientsLoading} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
