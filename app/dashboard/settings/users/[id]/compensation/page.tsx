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
  type RootCompensationFormData,
  buildRootCompensationPostBody,
  defaultRootCompensationForm,
  directBranchApplicable,
  projectBranchApplicable,
  resetInapplicableFieldsRoot,
} from "@/lib/compensation-form-helpers"

export default function UserCompensationPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useParams()
  const userId = params.id as string

  const [user, setUser] = useState<any>(null)
  const [compensation, setCompensation] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState<RootCompensationFormData>(defaultRootCompensationForm())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const t = formData.compensationType
  const showSalary = t === "SALARY_BONUS"
  const showPct = t === "PERCENTAGE_BASED"
  const pt = formData.percentageType
  const prj = showPct && projectBranchApplicable(pt)
  const dir = showPct && directBranchApplicable(pt)

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
          effectiveFrom: new Date(data.compensation.effectiveFrom).toISOString().split("T")[0],
          effectiveTo: data.compensation.effectiveTo
            ? new Date(data.compensation.effectiveTo).toISOString().split("T")[0]
            : "",
        })
      } else {
        setFormData(defaultRootCompensationForm())
        setCompensation(null)
      }
    } catch (e) {
      console.error("Error fetching compensation:", e)
      setError("Failed to load compensation data")
    } finally {
      setLoading(false)
    }
  }

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as RootCompensationFormData["compensationType"]
    setFormData((prev) => resetInapplicableFieldsRoot(prev, v))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const body = buildRootCompensationPostBody(formData)
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
      <div className="flex min-h-screen items-center justify-center">
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
          <CardDescription>Configure how this user is compensated. Only applicable fields are editable for each type.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>Compensation Type *</Label>
              <Select value={formData.compensationType} onChange={handleTypeChange}>
                <option value="SALARY_BONUS">Salary + Bonus + Finder</option>
                <option value="PERCENTAGE_BASED">Percentage-Based</option>
              </Select>
            </div>

            <div className={cn("space-y-2 rounded-md border p-4", !showSalary && "opacity-60")}>
              <Label>Base salary (monthly) {showSalary ? "*" : ""}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={formData.baseSalary}
                onChange={(e) => setFormData({ ...formData, baseSalary: e.target.value })}
                required={showSalary}
                disabled={!showSalary}
                placeholder="e.g., 5000"
              />
            </div>

            <fieldset
              className={cn("space-y-4 rounded-md border p-4", !showSalary && "opacity-60")}
              disabled={!showSalary}
            >
              <legend className="px-1 text-sm font-medium">Bonus multiplier (salary + bonus)</legend>
              <div className="space-y-2">
                <Label>Max Bonus Multiplier {showSalary ? "*" : ""}</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.maxBonusMultiplier}
                  onChange={(e) => setFormData({ ...formData, maxBonusMultiplier: e.target.value })}
                  required={showSalary}
                  placeholder="e.g., 2.0 for up to 2x salary"
                />
                <p className="text-xs text-gray-500">
                  Maximum bonus multiplier. Set to 0 for no bonus compensation.
                </p>
              </div>
            </fieldset>

            <fieldset
              className={cn("space-y-4 rounded-md border p-4", !showPct && "opacity-60")}
              disabled={!showPct}
            >
              <legend className="px-1 text-sm font-medium">Percentage-based</legend>
              <div className="space-y-2">
                <Label>Percentage Type {showPct ? "*" : ""}</Label>
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
                <Label>Project Percentage (%) {prj && showPct ? "*" : ""}</Label>
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
              </div>
              <div className="space-y-2">
                <Label>Direct Work Percentage (%) {dir && showPct ? "*" : ""}</Label>
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
              </div>
            </fieldset>

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
                  {compensation.compensationType === "SALARY_BONUS" ? "Salary + Bonus + Finder" : "Percentage-Based"}
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
                </>
              )}
              <div>
                <span className="text-sm font-medium text-gray-600">Effective From: </span>
                <span className="font-semibold">
                  {new Date(compensation.effectiveFrom).toLocaleDateString()}
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
