"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useRouter } from "next/navigation"
import { UserManagement } from "@/components/settings/UserManagement"
import { JunkBox } from "@/components/settings/JunkBox"
import { LogoUpload } from "@/components/settings/LogoUpload"
import { canCreateUsers } from "@/lib/permissions"

async function readJsonOrTextBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text.slice(0, 2000) }
  }
}

function formatIntegrationFailure(label: string, response: Response, data: unknown): string {
  const bits: string[] = [`HTTP ${response.status}`]
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>
    const err = typeof d.error === "string" ? d.error : ""
    const msg = typeof d.message === "string" ? d.message : ""
    if (err) bits.push(err)
    if (msg && msg !== err) bits.push(msg)
    if ("details" in d && d.details !== undefined)
      bits.push(typeof d.details === "string" ? d.details : JSON.stringify(d.details))
  }
  return bits.length > 1 ? `${label}: ${bits.join(" — ")}` : `${label} (${bits[0]})`
}

export default function SettingsPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [hourlyRate, setHourlyRate] = useState<string>("")
  const [timezone, setTimezone] = useState<string>("UTC")
  const [syncStartDate, setSyncStartDate] = useState<string>("2026-01-01")
  const [syncEndDate, setSyncEndDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [syncDryRun, setSyncDryRun] = useState<boolean>(true)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncResult, setSyncResult] = useState<any>(null)
  const [syncError, setSyncError] = useState("")
  const [avazaTestLoading, setAvazaTestLoading] = useState(false)
  const [avazaTestResult, setAvazaTestResult] = useState<any>(null)
  const [avazaTestError, setAvazaTestError] = useState("")

  useEffect(() => {
    if (session?.user?.id) {
      fetch(`/api/users/${session.user.id}`)
        .then((res) => {
          if (!res.ok) {
            throw new Error("Failed to fetch user data")
          }
          return res.json()
        })
        .then((data) => {
          if (data && data.defaultHourlyRate !== null && data.defaultHourlyRate !== undefined) {
            setHourlyRate(data.defaultHourlyRate.toString())
          }
          if (data && data.timezone) {
            setTimezone(data.timezone)
          }
        })
        .catch((err) => {
          console.error("Error fetching user data:", err)
          // Don't set error state here as it's not critical for page load
        })
    }
  }, [session])

  if (!session) {
    router.push("/login")
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setSaving(true)

    try {
      const response = await fetch(`/api/users/${session.user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultHourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
          timezone: timezone || "UTC",
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || "Failed to update settings")
      } else {
        setSuccess("Settings updated successfully")
        await update() // Refresh session
      }
    } catch (err) {
      setError("An error occurred. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const handleTimezoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setSaving(true)

    try {
      const response = await fetch(`/api/users/${session.user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: timezone || "UTC",
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || "Failed to update timezone")
      } else {
        setSuccess("Timezone updated successfully")
        await update() // Refresh session
      }
    } catch (err) {
      setError("An error occurred. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const handleAvazaSync = async (e: React.FormEvent) => {
    e.preventDefault()
    setSyncError("")
    setSyncResult(null)
    setSyncLoading(true)
    try {
      const response = await fetch("/api/integrations/avaza-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          startDate: syncStartDate || null,
          endDate: syncEndDate || null,
          dryRun: syncDryRun,
        }),
      })
      const data = await readJsonOrTextBody(response)
      if (!response.ok) {
        setSyncError(formatIntegrationFailure("Avaza sync failed", response, data))
      } else {
        setSyncResult(data)
      }
    } catch (err: any) {
      setSyncError(err?.message || "Avaza sync failed")
    } finally {
      setSyncLoading(false)
    }
  }

  const handleAvazaConnectionTest = async () => {
    setAvazaTestError("")
    setAvazaTestResult(null)
    setAvazaTestLoading(true)
    try {
      const response = await fetch("/api/integrations/avaza-sync/test", {
        method: "POST",
        credentials: "same-origin",
      })
      const data = await readJsonOrTextBody(response)
      if (!response.ok) {
        setAvazaTestError(formatIntegrationFailure("Avaza connection test failed", response, data))
      } else {
        setAvazaTestResult(data)
      }
    } catch (err: any) {
      setAvazaTestError(err?.message || "Avaza connection test failed")
    } finally {
      setAvazaTestLoading(false)
    }
  }

  // Common timezones list
  const timezones = [
    { value: "UTC", label: "UTC (Coordinated Universal Time)" },
    { value: "America/New_York", label: "Eastern Time (ET)" },
    { value: "America/Chicago", label: "Central Time (CT)" },
    { value: "America/Denver", label: "Mountain Time (MT)" },
    { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
    { value: "Europe/London", label: "London (GMT/BST)" },
    { value: "Europe/Paris", label: "Paris (CET/CEST)" },
    { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
    { value: "Europe/Rome", label: "Rome (CET/CEST)" },
    { value: "Europe/Madrid", label: "Madrid (CET/CEST)" },
    { value: "Europe/Lisbon", label: "Lisbon (WET/WEST)" },
    { value: "Asia/Tokyo", label: "Tokyo (JST)" },
    { value: "Asia/Shanghai", label: "Shanghai (CST)" },
    { value: "Asia/Hong_Kong", label: "Hong Kong (HKT)" },
    { value: "Asia/Dubai", label: "Dubai (GST)" },
    { value: "Asia/Singapore", label: "Singapore (SGT)" },
    { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
    { value: "Australia/Melbourne", label: "Melbourne (AEST/AEDT)" },
    { value: "America/Sao_Paulo", label: "São Paulo (BRT)" },
    { value: "America/Toronto", label: "Toronto (EST/EDT)" },
    { value: "America/Mexico_City", label: "Mexico City (CST)" },
  ]

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>Your account details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-600">Name</label>
            <p className="mt-1">{session.user.name}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-600">Email</label>
            <p className="mt-1">{session.user.email}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-600">Role</label>
            <p className="mt-1">{session.user.role}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Timezone Settings</CardTitle>
          <CardDescription>Set your timezone for date and time display throughout the application</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleTimezoneSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {timezones.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-gray-500">
                All dates and times will be displayed in your selected timezone.
              </p>
            </div>
            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}
            {success && (
              <div className="text-sm text-green-600">{success}</div>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Timezone"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {(session.user.role === "ADMIN" || session.user.role === "MANAGER" || session.user.role === "STAFF") && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Hourly Rate</CardTitle>
            <CardDescription>Set your default hourly rate for proposals</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="hourlyRate">Default Hourly Rate ($/hr)</Label>
                <Input
                  id="hourlyRate"
                  type="number"
                  step="0.01"
                  min="0"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="0.00"
                />
                <p className="text-xs text-gray-500">
                  This rate will be used as the default when you are selected for hourly billing in proposals.
                </p>
              </div>
              {error && (
                <div className="text-sm text-destructive">{error}</div>
              )}
              {success && (
                <div className="text-sm text-green-600">{success}</div>
              )}
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Hourly Rate"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {(session.user.role === "ADMIN" || session.user.role === "MANAGER") && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Avaza Sync</CardTitle>
            <CardDescription>
              Manually sync clients and invoices from Avaza for a selected period. Default start is Jan 1, 2026.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAvazaSync} className="space-y-4">
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Verify API credentials before syncing.
                </p>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" onClick={handleAvazaConnectionTest} disabled={avazaTestLoading}>
                    {avazaTestLoading ? "Testing..." : "Test Avaza Connection"}
                  </Button>
                </div>
                {avazaTestError ? <p className="text-sm text-destructive">{avazaTestError}</p> : null}
                {avazaTestResult ? (
                  <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded">
                    {JSON.stringify(avazaTestResult, null, 2)}
                  </pre>
                ) : null}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="syncStartDate">Start date</Label>
                  <Input
                    id="syncStartDate"
                    type="date"
                    value={syncStartDate}
                    onChange={(e) => setSyncStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="syncEndDate">End date</Label>
                  <Input
                    id="syncEndDate"
                    type="date"
                    value={syncEndDate}
                    onChange={(e) => setSyncEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="syncDryRun"
                  checked={syncDryRun}
                  onCheckedChange={(checked: boolean | string) => setSyncDryRun(Boolean(checked))}
                />
                <Label htmlFor="syncDryRun" className="cursor-pointer">
                  Dry run (preview only, no database changes)
                </Label>
              </div>
              {syncError ? <p className="text-sm text-destructive">{syncError}</p> : null}
              {syncResult ? (
                <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded">
                  {JSON.stringify(syncResult, null, 2)}
                </pre>
              ) : null}
              <Button type="submit" disabled={syncLoading}>
                {syncLoading ? "Running sync..." : "Run Avaza Sync"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {session.user.role === "ADMIN" && (
        <>
          <LogoUpload />
          
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Payment Details</CardTitle>
              <CardDescription>Manage payment details templates for invoices</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push("/dashboard/settings/payment-details")}>
                Manage Payment Details
              </Button>
            </CardContent>
          </Card>
          
          <UserManagement />
          
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Junk Box</CardTitle>
              <CardDescription>
                Recover or permanently delete proposals, projects, and invoices
              </CardDescription>
            </CardHeader>
            <CardContent>
              <JunkBox />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
