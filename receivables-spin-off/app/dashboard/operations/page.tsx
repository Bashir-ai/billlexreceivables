"use client"

import { useSession } from "next-auth/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { ClipboardList, RefreshCw } from "lucide-react"

type CollectionsRow = {
  id: string
  invoiceNumber: string | null
  amount: number
  dueDate: string | null
  daysPastDue: number
  ageBucket: string
  client: { id: string | null; name: string; company?: string | null } | null
}

type PayrollRow = {
  entryId: string
  balance: number
  periodYear: number
  periodMonth: number
  user: { id: string; name: string; email: string }
}

export default function OperationsPage() {
  const { data: session } = useSession()
  const [tab, setTab] = useState("collections")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [collections, setCollections] = useState<CollectionsRow[]>([])
  const [payroll, setPayroll] = useState<{
    rows: PayrollRow[]
    totalOwed: number
  } | null>(null)
  const [counts, setCounts] = useState({ collectionsCount: 0, payrollCount: 0 })
  const [syncing, setSyncing] = useState(false)

  const role = session?.user?.role

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/operations", { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to load")
      setCollections(data.collections ?? [])
      setPayroll("payroll" in data && data.payroll ? data.payroll : null)
      setCounts(data.counts ?? { collectionsCount: 0, payrollCount: 0 })
    } catch (e: any) {
      setError(e?.message || "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const t = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null
    if (t === "payroll" || t === "collections") setTab(t)
  }, [])

  useEffect(() => {
    if (!loading && tab === "payroll" && payroll === null) setTab("collections")
  }, [loading, tab, payroll])

  const bucketBadge = useMemo(
    () => ({
      "0_30": "secondary",
      "31_60": "default",
      "61_PLUS": "destructive",
    } as const),
    []
  )

  const handleSyncTodos = async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/operations/materialize", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message || "Sync failed")
      await load()
    } catch (e: any) {
      setError(e?.message || "Sync failed")
    } finally {
      setSyncing(false)
    }
  }

  if (!session) return <div className="p-6">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ClipboardList className="h-8 w-8" />
            Operations
          </h1>
          <p className="text-muted-foreground mt-1">
            Late invoice follow-ups and employee payout tracking. Notifications are surfaced here alongside optional linked todos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {(role === "ADMIN" || role === "MANAGER") && (
            <Button variant="secondary" size="sm" onClick={handleSyncTodos} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync queues → ToDos"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Overdue invoices (in queue)</CardDescription>
            <CardTitle className="text-2xl">{counts.collectionsCount}</CardTitle>
          </CardHeader>
        </Card>
        {payroll && (
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Outstanding payroll liabilities (entries)</CardDescription>
              <CardTitle className="text-2xl">{counts.payrollCount}</CardTitle>
            </CardHeader>
          </Card>
        )}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="collections">
            Collections ({counts.collectionsCount})
          </TabsTrigger>
          {payroll ? <TabsTrigger value="payroll">Payroll ({counts.payrollCount})</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="collections" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Late invoices</CardTitle>
              <CardDescription>Invoices past due date — same rules as inbox notifications.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No overdue invoices in your queue.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Invoice</th>
                        <th className="text-left p-3 font-medium">Client</th>
                        <th className="text-right p-3 font-medium">Amount</th>
                        <th className="text-left p-3 font-medium">Days late</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {collections.map((row) => (
                        <tr key={row.id} className="border-b">
                          <td className="p-3 font-medium">{row.invoiceNumber || row.id.slice(0, 8)}</td>
                          <td className="p-3">
                            {row.client?.name}
                            {row.client?.company ? (
                              <span className="text-muted-foreground text-xs block">{row.client.company}</span>
                            ) : null}
                          </td>
                          <td className="p-3 text-right">{formatCurrency(row.amount)}</td>
                          <td className="p-3">
                            <Badge variant={bucketBadge[row.ageBucket as keyof typeof bucketBadge] ?? "secondary"}>
                              {row.daysPastDue} d · {row.ageBucket.replace("_", "–")}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Button asChild variant="outline" size="sm">
                              <Link href={`/dashboard/bills/${row.id}`}>Open</Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Employee amounts due</CardTitle>
              <CardDescription>
                Compensation periods with unpaid balance (&gt; {formatCurrency(0.01)}).
                {payroll ? ` Total owed ${formatCurrency(payroll.totalOwed)}.` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!payroll ? (
                <p className="text-sm text-muted-foreground">
                  Payroll queue is visible to admins and managers only.
                </p>
              ) : loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : payroll.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open compensation balances.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Person</th>
                        <th className="text-left p-3 font-medium">Period</th>
                        <th className="text-right p-3 font-medium">Balance due</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {payroll.rows.map((row) => (
                        <tr key={row.entryId} className="border-b">
                          <td className="p-3 font-medium">{row.user.name}</td>
                          <td className="p-3">
                            {row.periodYear}-{String(row.periodMonth).padStart(2, "0")}
                          </td>
                          <td className="p-3 text-right">{formatCurrency(row.balance)}</td>
                          <td className="p-3">
                            <Button asChild variant="outline" size="sm">
                              <Link href={`/dashboard/settings/users/${row.user.id}/compensation`}>Compensation</Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
