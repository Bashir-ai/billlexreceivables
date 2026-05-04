"use client"

import { useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import type { PeriodComparisonMode } from "@/lib/period-comparison-report"

type Payload = {
  ranges: {
    rulesNote: string
    mode: PeriodComparisonMode
    current: { label: string; start: string; end: string }
    previous: { label: string; start: string; end: string }
  }
  previous: Record<string, number>
  current: Record<string, number>
  snapshots: {
    outstandingApprox: number
    payrollOwedApprox: number
  }
  deltas: {
    invoicedAmountPct: number
    paidAmountPct: number
    invoiceCountPct: number
  }
}

export default function PerformanceComparisonReportPage() {
  const { data: session } = useSession()
  const [mode, setMode] = useState<PeriodComparisonMode>("month")
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [data, setData] = useState<Payload | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const q = new URLSearchParams({ mode })
      if (asOf) q.set("asOf", asOf)
      const res = await fetch(`/api/reports/period-comparison?${q.toString()}`, { cache: "no-store" })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.message || body?.error || "Failed")
      setData(body as Payload)
    } catch (e: any) {
      setError(e?.message || "Failed to load report")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [mode, asOf])

  const downloadCsv = () => {
    const q = new URLSearchParams({ mode, format: "csv" })
    if (asOf) q.set("asOf", asOf)
    window.open(`/api/reports/period-comparison?${q.toString()}`, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Period comparison report</h1>
        <p className="text-muted-foreground mt-1">
          Compare the current period to date vs the immediately preceding comparable calendar window ({`month / quarter / semester`}).
          See the rules note below for exact definitions.
        </p>
        <Button variant="link" className="px-0 h-auto" asChild>
          <Link href="/dashboard/reports">← Back to Reports</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>As-of anchors the boundaries for month, quarter, and semester.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={mode} onChange={(e) => setMode(e.target.value as PeriodComparisonMode)}>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="semester">Semester (H1 / H2)</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="asOfDate">As of</Label>
            <Input id="asOfDate" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2 inline" /> : null}
            Generate
          </Button>
          <Button type="button" variant="outline" onClick={downloadCsv}>
            Export CSV
          </Button>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {data ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Rules</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>{data.ranges.rulesNote}</p>
              <div className="grid sm:grid-cols-2 gap-3 text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Previous:</span> {data.ranges.previous.label}
                  <br />
                  <span className="text-xs">{new Date(data.ranges.previous.start).toLocaleString()} →{" "}
                  {new Date(data.ranges.previous.end).toLocaleString()}</span>
                </div>
                <div>
                  <span className="font-medium text-foreground">Current:</span> {data.ranges.current.label}
                  <br />
                  <span className="text-xs">{new Date(data.ranges.current.start).toLocaleString()} →{" "}
                  {new Date(data.ranges.current.end).toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border text-sm">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3">Metric</th>
                      <th className="text-right p-3">Previous</th>
                      <th className="text-right p-3">Current</th>
                      <th className="text-right p-3">Δ %</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="p-3">Invoiced amount</td>
                      <td className="p-3 text-right">{formatCurrency(data.previous.invoicedAmount)}</td>
                      <td className="p-3 text-right">{formatCurrency(data.current.invoicedAmount)}</td>
                      <td className="p-3 text-right">{data.deltas.invoicedAmountPct.toFixed(1)}%</td>
                    </tr>
                    <tr className="border-b">
                      <td className="p-3">Paid amount</td>
                      <td className="p-3 text-right">{formatCurrency(data.previous.paidAmount)}</td>
                      <td className="p-3 text-right">{formatCurrency(data.current.paidAmount)}</td>
                      <td className="p-3 text-right">{data.deltas.paidAmountPct.toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td className="p-3">Issued invoice count</td>
                      <td className="p-3 text-right">{data.previous.invoiceCountIssuedInRange}</td>
                      <td className="p-3 text-right">{data.current.invoiceCountIssuedInRange}</td>
                      <td className="p-3 text-right">{data.deltas.invoiceCountPct.toFixed(1)}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Snapshots (as of)</CardTitle>
              <CardDescription>Point-in-time balances from the database at the selected as-of date.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>
                <span className="font-medium">Outstanding (unpaid bills, approx):</span>{" "}
                {formatCurrency(data.snapshots.outstandingApprox)}
              </p>
              {session?.user.role === "ADMIN" || session?.user.role === "MANAGER" || session?.user.role === "STAFF" ? (
                <p>
                  <span className="font-medium">Payroll liabilities (positive comp balance){session?.user.role === "STAFF" ? ", your entries" : ""}:</span>{" "}
                  {formatCurrency(data.snapshots.payrollOwedApprox)}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Compensation (by entry period overlapping window)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border text-sm">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3"></th>
                      <th className="text-right p-3">Previous</th>
                      <th className="text-right p-3">Current</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="p-3">Earned</td>
                      <td className="p-3 text-right">{formatCurrency(data.previous.compensationEarnedInRange)}</td>
                      <td className="p-3 text-right">{formatCurrency(data.current.compensationEarnedInRange)}</td>
                    </tr>
                    <tr>
                      <td className="p-3">Paid (per entry totals)</td>
                      <td className="p-3 text-right">{formatCurrency(data.previous.compensationPaidInRange)}</td>
                      <td className="p-3 text-right">{formatCurrency(data.current.compensationPaidInRange)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        !loading && <p className="text-muted-foreground text-sm">Pick filters and generate.</p>
      )}
    </div>
  )
}
