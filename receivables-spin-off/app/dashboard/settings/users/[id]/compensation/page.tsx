"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { formatCurrency, cn } from "@/lib/utils"
import {
  type CompensationFormData,
  buildCompensationPostBody,
  defaultCompensationForm,
  directBranchApplicable,
  hasSalaryInCompensationType,
  isBonusScheduleFrequencyEditable,
  isPercentageBlock,
  isSalaryBonusBlock,
  isSbfmBlock,
  isSbfmBonusCompensationReadOnly,
  isScheduleEditable,
  isSalaryBonusFinderFieldsEditable,
  projectBranchApplicable,
  resetInapplicableFields,
} from "@/lib/compensation-form-helpers"

export default function UserCompensationPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useParams()
  const userId = params.id as string

  const [user, setUser] = useState<any>(null)
  const [compensation, setCompensation] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState<CompensationFormData>(defaultCompensationForm())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const t = formData.compensationType
  const showSalaryBlock = isSalaryBonusBlock(t)
  const showPctBlock = isPercentageBlock(t)
  const showSbfmBlock = isSbfmBlock(t)
  const scheduleEditable = isScheduleEditable(t)
  const pt = formData.percentageType
  const prj = showPctBlock && projectBranchApplicable(pt)
  const dir = showPctBlock && directBranchApplicable(pt)
  const prjFixed = showPctBlock && prj
  const dirFixed = showPctBlock && dir
  const bonusScheduleFrequencyEditable = isBonusScheduleFrequencyEditable(t)
  const sbfmBonusCompReadOnly = isSbfmBonusCompensationReadOnly(t)
  const hasSalary = hasSalaryInCompensationType(t)
  const showBonusAnchorRow =
    (formData.bonusDueFrequency === "QUARTERLY" || formData.bonusDueFrequency === "YEARLY") &&
    (bonusScheduleFrequencyEditable || showSbfmBlock)
  const baseSalaryEditable = showSalaryBlock || showSbfmBlock
  const employmentRequired = scheduleEditable
  const bonusFreqControlDisabled = !scheduleEditable || !bonusScheduleFrequencyEditable
  const bonusAnchorControlDisabled = bonusFreqControlDisabled
  const showSalaryBonusFinderSection = isSalaryBonusFinderFieldsEditable(t)

  useEffect(() => {
    if (!session) return

    if (session.user.role !== "ADMIN") {
      router.push("/dashboard/settings")
      return
    }

    fetchUser()
    fetchCompensation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session])

  const fetchUser = async () => {
    try {
      const response = await fetch(`/api/users/${userId}`)
      if (response.ok) {
        const data = await response.json()
        setUser(data)
      }
    } catch (e) {
      console.error("Error fetching user:", e)
    }
  }

  const fetchCompensation = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/users/${userId}/compensation`)
      const data = await response.json()
      if (data.compensation) {
        setCompensation(data.compensation)
        setFormData({
          compensationType: data.compensation.compensationType,
          baseSalary: data.compensation.baseSalary?.toString() || "",
          maxBonusMultiplier: data.compensation.maxBonusMultiplier?.toString() || "",
          percentageType: data.compensation.percentageType || "PROJECT_TOTAL",
          projectPercentage: data.compensation.projectPercentage?.toString() || "",
          directWorkPercentage: data.compensation.directWorkPercentage?.toString() || "",
          projectFixedAmount: data.compensation.projectFixedAmount?.toString() || "",
          directWorkFixedAmount: data.compensation.directWorkFixedAmount?.toString() || "",
          bonusFixedAmount: data.compensation.bonusFixedAmount?.toString() || "",
          bonusPercent: data.compensation.bonusPercent?.toString() || "",
          finderFeePercent: data.compensation.finderFeePercent?.toString() || "",
          finderFeeFixedAmount: data.compensation.finderFeeFixedAmount?.toString() || "",
          managementFeePercent: data.compensation.managementFeePercent?.toString() || "",
          managementFeeFixedAmount: data.compensation.managementFeeFixedAmount?.toString() || "",
          employmentStartDate: data.compensation.employmentStartDate
            ? new Date(data.compensation.employmentStartDate).toISOString().split("T")[0]
            : "",
          bonusDueFrequency: data.compensation.bonusDueFrequency || "MONTHLY",
          bonusDueMonth: data.compensation.bonusDueMonth?.toString() || "12",
          effectiveFrom: new Date(data.compensation.effectiveFrom).toISOString().split("T")[0],
          effectiveTo: data.compensation.effectiveTo
            ? new Date(data.compensation.effectiveTo).toISOString().split("T")[0]
            : "",
        })
      } else {
        setFormData(defaultCompensationForm())
        setCompensation(null)
      }
    } catch (e) {
      console.error("Error fetching compensation:", e)
      setError("Failed to load compensation data")
    } finally {
      setLoading(false)
    }
  }

  const handleCompensationTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as CompensationFormData["compensationType"]
    setFormData((prev) => resetInapplicableFields(prev, v))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const body = buildCompensationPostBody(formData)
      const response = await fetch(`/api/users/${userId}/compensation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Failed to save compensation")
        return
      }

      await fetchCompensation()
      alert("Compensation updated successfully")
    } catch (err) {
      console.error("Error saving compensation:", err)
      setError("Failed to save compensation")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div>Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">User Compensation</h1>
          <p className="text-gray-600 mt-2">Manage compensation structure for {user?.name || "this user"}</p>
        </div>
        <Button variant="outline" onClick={() => router.push("/dashboard/settings")}>
          Back to Settings
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-800">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Compensation Structure</CardTitle>
          <CardDescription>Configure how this user is compensated. Fields are editable only for the selected type.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>Compensation Type *</Label>
              <Select value={formData.compensationType} onChange={handleCompensationTypeChange}>
                <option value="SALARY_BONUS">Salary + Bonus + Finder</option>
                <option value="PERCENTAGE_BASED">Percentage-Based</option>
                <option value="SALARY_BONUS_FINDER_MANAGEMENT">Salary + Finder + Management</option>
              </Select>
            </div>

            <div className={cn("space-y-2 rounded-md border p-4", !baseSalaryEditable && "opacity-60")}>
              <Label>Base salary (monthly) {baseSalaryEditable ? "*" : ""}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={formData.baseSalary}
                onChange={(e) => setFormData({ ...formData, baseSalary: e.target.value })}
                required={baseSalaryEditable}
                disabled={!baseSalaryEditable}
                placeholder="e.g., 5000"
              />
              <p className="text-xs text-gray-500">
                Used for salary + bonus, and for salary + finder + management. Not used for percentage-only.
              </p>
              {hasSalary && (
                <p className="text-xs text-gray-600 border-t pt-2 mt-2">
                  Policy: the monthly <span className="font-medium">salary</span> is set at this full-month amount. It is
                  treated as paid on the last business day of each month; the <span className="font-medium">first</span>{" "}
                  month is pro-rated to the days worked from employment start, and the first-year <span className="font-medium">bonus</span>{" "}
                  components ramp by month.
                </p>
              )}
            </div>

            <fieldset
              className={cn("space-y-4 rounded-md border p-4", !showSalaryBlock && "opacity-60")}
              disabled={!showSalaryBlock}
            >
              <legend className="text-sm font-medium px-1">Bonus multiplier (salary + bonus type)</legend>
              <div className="space-y-2">
                <Label>Max Bonus Multiplier {showSalaryBlock ? "*" : ""}</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.maxBonusMultiplier}
                  onChange={(e) => setFormData({ ...formData, maxBonusMultiplier: e.target.value })}
                  required={showSalaryBlock}
                  placeholder="e.g., 2.0 for up to 2x salary"
                />
                <p className="text-xs text-gray-500">
                  Maximum bonus multiplier (e.g., 2.0 means bonus can be up to 2x the base salary). Set to 0 for no
                  bonus compensation.
                </p>
              </div>
            </fieldset>

            {showSalaryBonusFinderSection && (
              <div className="space-y-4 rounded-md border p-4">
                <p className="text-sm font-medium">Finder (salary + bonus + finder type)</p>
                <p className="text-xs text-gray-500">
                  Optional add-on amounts for finder. Management fee fields are not used for this type.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Finder fee % (reference or adjustment)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={formData.finderFeePercent}
                      onChange={(e) => setFormData({ ...formData, finderFeePercent: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Finder fee fixed add-on (monthly)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.finderFeeFixedAmount}
                      onChange={(e) => setFormData({ ...formData, finderFeeFixedAmount: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 opacity-50">
                  <div className="space-y-2">
                    <Label>Management fee %</Label>
                    <Input type="number" value="" disabled placeholder="N/A" readOnly className="cursor-not-allowed" />
                  </div>
                  <div className="space-y-2">
                    <Label>Management fee fixed</Label>
                    <Input type="number" value="" disabled placeholder="N/A" readOnly className="cursor-not-allowed" />
                  </div>
                </div>
              </div>
            )}

            <fieldset
              className={cn("space-y-4 rounded-md border p-4", !showPctBlock && "opacity-60")}
              disabled={!showPctBlock}
            >
              <legend className="text-sm font-medium px-1">Percentage-based</legend>
              <div className="space-y-2">
                <Label>Percentage Type {showPctBlock ? "*" : ""}</Label>
                <Select
                  value={formData.percentageType || "PROJECT_TOTAL"}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      percentageType: e.target.value as "PROJECT_TOTAL" | "DIRECT_WORK" | "BOTH",
                    })
                  }
                >
                  <option value="PROJECT_TOTAL">Project Total</option>
                  <option value="DIRECT_WORK">Direct Work</option>
                  <option value="BOTH">Both</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Project Percentage (%) {prj && showPctBlock ? "*" : ""}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formData.projectPercentage}
                  onChange={(e) => setFormData({ ...formData, projectPercentage: e.target.value })}
                  required={prj}
                  disabled={!prj}
                  placeholder="e.g., 10"
                />
                <p className="text-xs text-gray-500">Percentage of total project value</p>
              </div>
              <div className="space-y-2">
                <Label>Direct Work Percentage (%) {dir && showPctBlock ? "*" : ""}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formData.directWorkPercentage}
                  onChange={(e) => setFormData({ ...formData, directWorkPercentage: e.target.value })}
                  required={dir}
                  disabled={!dir}
                  placeholder="e.g., 15"
                />
                <p className="text-xs text-gray-500">Percentage of direct work fees/hours</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Project Fixed Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.projectFixedAmount}
                    onChange={(e) => setFormData({ ...formData, projectFixedAmount: e.target.value })}
                    disabled={!prjFixed}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Direct Work Fixed Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.directWorkFixedAmount}
                    onChange={(e) => setFormData({ ...formData, directWorkFixedAmount: e.target.value })}
                    disabled={!dirFixed}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Finder fee % (optional)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.finderFeePercent}
                    onChange={(e) => setFormData({ ...formData, finderFeePercent: e.target.value })}
                    placeholder="e.g., 5"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Finder fee fixed amount (optional)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.finderFeeFixedAmount}
                    onChange={(e) => setFormData({ ...formData, finderFeeFixedAmount: e.target.value })}
                    placeholder="e.g., 250"
                  />
                </div>
              </div>
            </fieldset>

            <div className={cn("space-y-4 rounded-md border p-4", !showSbfmBlock && "opacity-60")}>
              <p className="text-sm font-medium px-0">Salary + finder + management (extra amounts)</p>
              <div className="space-y-2 max-w-md">
                <Label>Bonus compensation — fixed</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.bonusFixedAmount}
                  onChange={(e) => setFormData({ ...formData, bonusFixedAmount: e.target.value })}
                  disabled={!showSbfmBlock || sbfmBonusCompReadOnly}
                />
                <p className="text-xs text-gray-500">
                  {sbfmBonusCompReadOnly
                    ? "Set administratively; not editable here."
                    : "Optional fixed bonus component when this type is selected."}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Bonus compensation — % of base</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.bonusPercent}
                    onChange={(e) => setFormData({ ...formData, bonusPercent: e.target.value })}
                    disabled={!showSbfmBlock || sbfmBonusCompReadOnly}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Finder Fee Percent</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.finderFeePercent}
                    onChange={(e) => setFormData({ ...formData, finderFeePercent: e.target.value })}
                    disabled={!showSbfmBlock}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Finder Fee Fixed Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.finderFeeFixedAmount}
                    onChange={(e) => setFormData({ ...formData, finderFeeFixedAmount: e.target.value })}
                    disabled={!showSbfmBlock}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Management Fee Percent</Label>
                  <p className="text-xs text-muted-foreground max-w-prose">
                    Per-invoice management fees on paid bills are computed as a 10% pool of invoice net with your share set
                    on each bill&apos;s attribution (not from this field). This value is kept for records and any future
                    use; the pool is capped at 10% of net in fee calculations.
                  </p>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.managementFeePercent}
                    onChange={(e) => setFormData({ ...formData, managementFeePercent: e.target.value })}
                    disabled={!showSbfmBlock}
                  />
                </div>
              </div>
              <div className="space-y-2 max-w-md">
                <Label>Management Fee Fixed Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.managementFeeFixedAmount}
                  onChange={(e) => setFormData({ ...formData, managementFeeFixedAmount: e.target.value })}
                  disabled={!showSbfmBlock}
                />
              </div>
            </div>

            <div
              className={cn(
                "grid grid-cols-1 gap-4 rounded-md border p-4 md:grid-cols-2",
                !scheduleEditable && "opacity-60"
              )}
            >
              <div className="space-y-2">
                <Label>Employment start (admission) {employmentRequired ? "*" : ""}</Label>
                <Input
                  type="date"
                  value={formData.employmentStartDate}
                  onChange={(e) => setFormData({ ...formData, employmentStartDate: e.target.value })}
                  required={employmentRequired}
                  disabled={!scheduleEditable}
                />
                <p className="text-xs text-gray-500">Anchor for hire-month salary proration and first-year bonus scale.</p>
              </div>
              <div className="space-y-2">
                <Label>Bonus payment frequency</Label>
                <p className="text-xs text-gray-500 mb-1">Applies to bonus accrual timing, not the base salary pay date.</p>
                <Select
                  value={formData.bonusDueFrequency}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      bonusDueFrequency: e.target.value as "MONTHLY" | "QUARTERLY" | "YEARLY",
                    })
                  }
                  disabled={bonusFreqControlDisabled}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                </Select>
                {showSbfmBlock && (
                  <p className="text-xs text-amber-800/80">For this type, bonus cadence is monthly (fixed). Saved as monthly.</p>
                )}
              </div>
            </div>

            {showBonusAnchorRow && (
              <div
                className={cn("space-y-2 rounded-md border p-4", bonusAnchorControlDisabled && "opacity-60")}
              >
                <Label>Bonus anchor month</Label>
                <Select
                  value={formData.bonusDueMonth}
                  onChange={(e) => setFormData({ ...formData, bonusDueMonth: e.target.value })}
                  disabled={bonusAnchorControlDisabled}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={String(m)}>
                      {new Date(2000, m - 1, 1).toLocaleString("en", { month: "long" })}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-gray-500">
                  Month in which annual bonus is paid, or quarter cycle anchor for quarterly bonus. Only applies when
                  this schedule is used (salary types).
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Effective From *</Label>
                <Input
                  type="date"
                  value={formData.effectiveFrom}
                  onChange={(e) => setFormData({ ...formData, effectiveFrom: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Effective To (Optional)</Label>
                <Input
                  type="date"
                  value={formData.effectiveTo}
                  onChange={(e) => setFormData({ ...formData, effectiveTo: e.target.value })}
                />
                <p className="text-xs text-gray-500">Leave empty for currently active</p>
              </div>
            </div>

            <div className="flex justify-end gap-4 pt-4">
              <Button type="button" variant="outline" onClick={() => router.push("/dashboard/settings")}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save Compensation"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {compensation && (
        <Card>
          <CardHeader>
            <CardTitle>Current Compensation</CardTitle>
            <CardDescription>Active compensation structure</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <span className="text-sm font-medium text-gray-600">Type: </span>
                <span className="font-semibold">
                  {compensation.compensationType === "SALARY_BONUS"
                    ? "Salary + Bonus + Finder"
                    : compensation.compensationType === "PERCENTAGE_BASED"
                      ? "Percentage-Based"
                      : "Salary + Finder + Management"}
                </span>
              </div>
              {compensation.compensationType === "SALARY_BONUS" && (
                <>
                  <div>
                    <span className="text-sm font-medium text-gray-600">Base Salary: </span>
                    <span className="font-semibold">{formatCurrency(compensation.baseSalary || 0)}</span>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-600">Max Bonus Multiplier: </span>
                    <span className="font-semibold">{compensation.maxBonusMultiplier}x</span>
                  </div>
                  {compensation.finderFeePercent != null && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Finder fee %: </span>
                      <span className="font-semibold">{compensation.finderFeePercent}%</span>
                    </div>
                  )}
                  {compensation.finderFeeFixedAmount != null && compensation.finderFeeFixedAmount > 0 && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Finder fee fixed add-on: </span>
                      <span className="font-semibold">{formatCurrency(compensation.finderFeeFixedAmount)}</span>
                    </div>
                  )}
                </>
              )}
              {compensation.compensationType === "PERCENTAGE_BASED" && (
                <>
                  <div>
                    <span className="text-sm font-medium text-gray-600">Percentage Type: </span>
                    <span className="font-semibold">
                      {compensation.percentageType === "PROJECT_TOTAL" && "Project Total"}
                      {compensation.percentageType === "DIRECT_WORK" && "Direct Work"}
                      {compensation.percentageType === "BOTH" && "Both"}
                    </span>
                  </div>
                  {compensation.projectPercentage && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Project Percentage: </span>
                      <span className="font-semibold">{compensation.projectPercentage}%</span>
                    </div>
                  )}
                  {compensation.directWorkPercentage && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Direct Work Percentage: </span>
                      <span className="font-semibold">{compensation.directWorkPercentage}%</span>
                    </div>
                  )}
                  {compensation.finderFeePercent != null && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Finder fee %: </span>
                      <span className="font-semibold">{compensation.finderFeePercent}%</span>
                    </div>
                  )}
                  {compensation.finderFeeFixedAmount != null && compensation.finderFeeFixedAmount > 0 && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Finder fee fixed add-on: </span>
                      <span className="font-semibold">{formatCurrency(compensation.finderFeeFixedAmount)}</span>
                    </div>
                  )}
                </>
              )}
              {compensation.compensationType === "SALARY_BONUS_FINDER_MANAGEMENT" && (
                <>
                  <div>
                    <span className="text-sm font-medium text-gray-600">Base Salary: </span>
                    <span className="font-semibold">{formatCurrency(compensation.baseSalary || 0)}</span>
                  </div>
                  {compensation.bonusFixedAmount !== null && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Bonus Fixed: </span>
                      <span className="font-semibold">{formatCurrency(compensation.bonusFixedAmount || 0)}</span>
                    </div>
                  )}
                  {compensation.bonusPercent !== null && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Bonus Percent: </span>
                      <span className="font-semibold">{compensation.bonusPercent || 0}%</span>
                    </div>
                  )}
                  {compensation.finderFeePercent !== null && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Finder Fee Percent: </span>
                      <span className="font-semibold">{compensation.finderFeePercent || 0}%</span>
                    </div>
                  )}
                  {compensation.managementFeePercent !== null && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Management Fee Percent: </span>
                      <span className="font-semibold">{compensation.managementFeePercent || 0}%</span>
                    </div>
                  )}
                </>
              )}
              <div>
                <span className="text-sm font-medium text-gray-600">Effective From: </span>
                <span className="font-semibold">
                  {new Date(compensation.effectiveFrom).toLocaleDateString()}
                </span>
              </div>
              {compensation.employmentStartDate && (
                <div>
                  <span className="text-sm font-medium text-gray-600">Employment Start: </span>
                  <span className="font-semibold">
                    {new Date(compensation.employmentStartDate).toLocaleDateString()}
                  </span>
                </div>
              )}
              <div>
                <span className="text-sm font-medium text-gray-600">Bonus Due: </span>
                <span className="font-semibold">
                  {compensation.bonusDueFrequency || "MONTHLY"}
                  {compensation.bonusDueMonth ? ` (month ${compensation.bonusDueMonth})` : ""}
                </span>
              </div>
              {compensation.effectiveTo && (
                <div>
                  <span className="text-sm font-medium text-gray-600">Effective To: </span>
                  <span className="font-semibold">
                    {new Date(compensation.effectiveTo).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
