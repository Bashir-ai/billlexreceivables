"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Calendar, DollarSign, TrendingUp } from "lucide-react"

interface Compensation {
  id: string
  compensationType: "SALARY_BONUS" | "PERCENTAGE_BASED"
  baseSalary: number | null
  maxBonusMultiplier: number | null
  percentageType: "PROJECT_TOTAL" | "DIRECT_WORK" | "BOTH" | null
  projectPercentage: number | null
  directWorkPercentage: number | null
  effectiveFrom: string
  effectiveTo: string | null
}

interface CompensationEntry {
  id: string
  periodYear: number
  periodMonth: number
  baseSalary: number | null
  bonusMultiplier: number | null
  bonusAmount: number | null
  percentageEarnings: number | null
  totalEarned: number
  totalPaid: number
  balance: number
  calculatedAt: string
  notes: string | null
}

interface CompensationSectionProps {
  userId: string
  startDate: string | null
  endDate: string | null
  isAdmin: boolean
}

export function CompensationSection({ userId, startDate, endDate, isAdmin }: CompensationSectionProps) {
  const [compensation, setCompensation] = useState<Compensation | null>(null)
  const [entries, setEntries] = useState<CompensationEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [bonusMultiplier, setBonusMultiplier] = useState<string>("")
  const [calculateYear, setCalculateYear] = useState<number>(new Date().getFullYear())
  const [calculateMonth, setCalculateMonth] = useState<number>(new Date().getMonth() + 1)

  useEffect(() => {
    fetchCompensation()
    fetchEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, startDate, endDate])

  const fetchCompensation = async () => {
    try {
      const response = await fetch(`/api/users/${userId}/compensation`)
      const data = await response.json()
      setCompensation(data.compensation)
    } catch (error) {
      console.error("Error fetching compensation:", error)
    }
  }

  const fetchEntries = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (startDate) {
        const start = new Date(startDate)
        params.set("startYear", start.getFullYear().toString())
        params.set("startMonth", (start.getMonth() + 1).toString())
      }
      if (endDate) {
        const end = new Date(endDate)
        params.set("endYear", end.getFullYear().toString())
        params.set("endMonth", (end.getMonth() + 1).toString())
      }

      const response = await fetch(`/api/users/${userId}/compensation/entries?${params.toString()}`)
      const data = await response.json()
      setEntries(data.entries || [])
    } catch (error) {
      console.error("Error fetching entries:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleCalculate = async () => {
    if (!compensation) return

    setCalculating(true)
    try {
      const response = await fetch(`/api/users/${userId}/compensation/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: calculateYear,
          month: calculateMonth,
          bonusMultiplier: bonusMultiplier ? parseFloat(bonusMultiplier) : null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || "Failed to calculate compensation")
        return
      }

      // Refresh entries
      await fetchEntries()
      setBonusMultiplier("")
    } catch (error) {
      console.error("Error calculating compensation:", error)
      alert("Failed to calculate compensation")
    } finally {
      setCalculating(false)
    }
  }

  if (loading) {
    return <div>Loading compensation data...</div>
  }

  if (!compensation) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <p className="text-gray-500">No compensation structure configured for this user.</p>
            {isAdmin && (
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  To configure compensation, go to Settings → User Management and click &quot;Compensation&quot; for this user.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.href = `/dashboard/settings/users/${userId}/compensation`
                  }}
                >
                  Configure Compensation
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Compensation Structure */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Compensation Structure</CardTitle>
              <CardDescription>Current compensation configuration</CardDescription>
            </div>
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.location.href = `/dashboard/settings/users/${userId}/compensation`
                }}
              >
                Edit Compensation
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-gray-600">Type</Label>
              <p className="font-semibold">
                {compensation.compensationType === "SALARY_BONUS" ? "Salary + Bonus + Finder" : "Percentage-Based"}
              </p>
            </div>
            {compensation.compensationType === "SALARY_BONUS" && (
              <>
                <div>
                  <Label className="text-sm text-gray-600">Base Salary</Label>
                  <p className="font-semibold">{formatCurrency(compensation.baseSalary || 0)}</p>
                </div>
                <div>
                  <Label className="text-sm text-gray-600">Max Bonus Multiplier</Label>
                  <p className="font-semibold">{compensation.maxBonusMultiplier}x</p>
                </div>
              </>
            )}
            {compensation.compensationType === "PERCENTAGE_BASED" && (
              <>
                <div>
                  <Label className="text-sm text-gray-600">Percentage Type</Label>
                  <p className="font-semibold">
                    {compensation.percentageType === "PROJECT_TOTAL" && "Project Total"}
                    {compensation.percentageType === "DIRECT_WORK" && "Direct Work"}
                    {compensation.percentageType === "BOTH" && "Both"}
                  </p>
                </div>
                {(compensation.percentageType === "PROJECT_TOTAL" || compensation.percentageType === "BOTH") && (
                  <div>
                    <Label className="text-sm text-gray-600">Project Percentage</Label>
                    <p className="font-semibold">{compensation.projectPercentage}%</p>
                  </div>
                )}
                {(compensation.percentageType === "DIRECT_WORK" || compensation.percentageType === "BOTH") && (
                  <div>
                    <Label className="text-sm text-gray-600">Direct Work Percentage</Label>
                    <p className="font-semibold">{compensation.directWorkPercentage}%</p>
                  </div>
                )}
              </>
            )}
            <div>
              <Label className="text-sm text-gray-600">Effective From</Label>
              <p className="font-semibold">{formatDate(compensation.effectiveFrom)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calculate Compensation (Admin only) */}
      {isAdmin && compensation.compensationType === "SALARY_BONUS" && (
        <Card>
          <CardHeader>
            <CardTitle>Calculate Compensation</CardTitle>
            <CardDescription>Calculate monthly compensation entry</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="calculateYear">Year</Label>
                <Input
                  id="calculateYear"
                  type="number"
                  min="2000"
                  max="2100"
                  value={calculateYear}
                  onChange={(e) => setCalculateYear(parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="calculateMonth">Month</Label>
                <Input
                  id="calculateMonth"
                  type="number"
                  min="1"
                  max="12"
                  value={calculateMonth}
                  onChange={(e) => setCalculateMonth(parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bonusMultiplier">
                  Bonus Multiplier (0 - {compensation.maxBonusMultiplier})
                </Label>
                <Input
                  id="bonusMultiplier"
                  type="number"
                  step="0.1"
                  min="0"
                  max={compensation.maxBonusMultiplier || undefined}
                  value={bonusMultiplier}
                  onChange={(e) => setBonusMultiplier(e.target.value)}
                  placeholder="e.g., 1.5"
                />
              </div>
            </div>
            <Button onClick={handleCalculate} disabled={calculating}>
              {calculating ? "Calculating..." : "Calculate Compensation"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Monthly Entries Table */}
      <Card>
        <CardHeader>
          <CardTitle>Compensation History</CardTitle>
          <CardDescription>Monthly compensation entries</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-gray-500">No compensation entries found for the selected period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Period</th>
                    {compensation.compensationType === "SALARY_BONUS" && (
                      <>
                        <th className="text-right p-2">Base Salary</th>
                        <th className="text-right p-2">Bonus</th>
                      </>
                    )}
                    {compensation.compensationType === "PERCENTAGE_BASED" && (
                      <th className="text-right p-2">Percentage Earnings</th>
                    )}
                    <th className="text-right p-2">Total Earned</th>
                    <th className="text-right p-2">Total Paid</th>
                    <th className="text-right p-2">Balance</th>
                    <th className="text-left p-2">Calculated</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b hover:bg-gray-50">
                      <td className="p-2">
                        {entry.periodYear}-{entry.periodMonth.toString().padStart(2, '0')}
                      </td>
                      {compensation.compensationType === "SALARY_BONUS" && (
                        <>
                          <td className="text-right p-2">{formatCurrency(entry.baseSalary || 0)}</td>
                          <td className="text-right p-2">
                            {entry.bonusMultiplier !== null && entry.bonusMultiplier !== undefined && (
                              <span className="text-xs text-gray-500">
                                {entry.bonusMultiplier}x = {formatCurrency(entry.bonusAmount || 0)}
                              </span>
                            )}
                          </td>
                        </>
                      )}
                      {compensation.compensationType === "PERCENTAGE_BASED" && (
                        <td className="text-right p-2">{formatCurrency(entry.percentageEarnings || 0)}</td>
                      )}
                      <td className="text-right p-2 font-semibold">{formatCurrency(entry.totalEarned)}</td>
                      <td className="text-right p-2">{formatCurrency(entry.totalPaid)}</td>
                      <td className={`text-right p-2 font-semibold ${entry.balance >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {formatCurrency(entry.balance)}
                      </td>
                      <td className="text-left p-2 text-xs text-gray-500">
                        {formatDate(entry.calculatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
