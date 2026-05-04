"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"

type AttributionRole = "FINDER" | "CLIENT_MANAGER" | "PROJECT_MANAGER"

type Row = {
  userId: string
  userName: string
  role: AttributionRole
  splitPercent: number
  fixedAmount: number | null
}

export function BillAttributionEditor({
  billId,
  editable,
  initialRows,
}: {
  billId: string
  editable: boolean
  initialRows: Row[]
}) {
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [staffUsers, setStaffUsers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [userSearch, setUserSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((data: Array<{ id: string; name: string; email: string; role: string }>) => {
        if (!Array.isArray(data)) return
        setStaffUsers(
          data
            .filter((u) => u.role !== "CLIENT")
            .map((u) => ({ id: u.id, name: u.name, email: u.email }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      })
      .catch(() => {})
  }, [])

  const totals = useMemo(() => {
    const byRole: Record<AttributionRole, number> = {
      FINDER: 0,
      CLIENT_MANAGER: 0,
      PROJECT_MANAGER: 0,
    }
    rows.forEach((row) => {
      byRole[row.role] += row.splitPercent || 0
    })
    return byRole
  }, [rows])

  const filteredStaffUsers = useMemo(() => {
    const sorted = [...staffUsers].sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.email.localeCompare(b.email, undefined, { sensitivity: "base" })
    )
    const q = userSearch.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }, [staffUsers, userSearch])

  const updateRow = (index: number, patch: Partial<Row>) => {
    const next = [...rows]
    next[index] = { ...next[index], ...patch }
    setRows(next)
  }

  const addRow = () => {
    setRows([
      ...rows,
      { userId: "", userName: "Unassigned", role: "FINDER", splitPercent: 0, fixedAmount: 0 },
    ])
  }

  const removeRow = (index: number) => {
    setRows(rows.filter((_, i) => i !== index))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setOk(null)
    try {
      const response = await fetch(`/api/bills/${billId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributionRows: rows
            .filter((row) => row.userId.trim() !== "")
            .map((row) => ({
              userId: row.userId,
              role: row.role,
              splitPercent: row.splitPercent || 0,
              fixedAmount: row.fixedAmount || 0,
            })),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || "Failed to save attribution")
      }
      setOk("Attribution snapshot updated")
    } catch (err: any) {
      setError(err.message || "Failed to save attribution")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 max-w-sm">
        <Label htmlFor={`attr-user-search-${billId}`}>Filter users</Label>
        <Input
          id={`attr-user-search-${billId}`}
          placeholder="Type name or email..."
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          disabled={!editable && staffUsers.length === 0}
        />
      </div>
      {rows.map((row, index) => (
        <div key={`attr-${billId}-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 border rounded p-3">
          <div className="space-y-1">
            <Label>User</Label>
            <Select
              value={row.userId}
              disabled={!editable}
              onChange={(e) => {
                const userId = e.target.value
                const u = staffUsers.find((x) => x.id === userId)
                updateRow(index, {
                  userId,
                  userName: u?.name || row.userName,
                })
              }}
            >
              <option value="">Select user…</option>
              {row.userId && !staffUsers.some((u) => u.id === row.userId) && (
                <option value={row.userId}>
                  {row.userName ? `${row.userName} (on snapshot)` : `${row.userId.slice(0, 8)}… (not in directory)`}
                </option>
              )}
              {filteredStaffUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={row.role} disabled={!editable} onChange={(e) => updateRow(index, { role: e.target.value as AttributionRole })}>
              <option value="FINDER">Finder</option>
              <option value="CLIENT_MANAGER">Client manager</option>
              <option value="PROJECT_MANAGER">Project manager</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>
              {row.role === "CLIENT_MANAGER" || row.role === "PROJECT_MANAGER"
                ? "Split % of 10% management pool"
                : "Split % of invoice net"}
            </Label>
            {row.role === "CLIENT_MANAGER" || row.role === "PROJECT_MANAGER" ? (
              <p className="text-[11px] text-muted-foreground">
                10% of invoice net is the management pool. This split is your share of that pool (e.g. 100% = the full
                10% of net; 50% = 5% of net).
              </p>
            ) : null}
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              disabled={!editable}
              value={row.splitPercent}
              onChange={(e) => updateRow(index, { splitPercent: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1">
            <Label>Fixed</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              disabled={!editable}
              value={row.fixedAmount || 0}
              onChange={(e) => updateRow(index, { fixedAmount: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="flex items-end">
            {editable && (
              <Button variant="outline" onClick={() => removeRow(index)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      ))}
      <div className="text-xs text-gray-500">
        Finder: {totals.FINDER.toFixed(2)}% | Client manager: {totals.CLIENT_MANAGER.toFixed(2)}% | Project manager: {totals.PROJECT_MANAGER.toFixed(2)}%
      </div>
      {editable ? (
        <p className="text-xs text-muted-foreground">
          Save behavior: invoice rows override by role. If you only set management rows, finder defaults from the client record remain.
        </p>
      ) : null}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ok && <p className="text-sm text-green-700">{ok}</p>}
      {editable && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={addRow}>
            Add Row
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save Attribution"}
          </Button>
        </div>
      )}
    </div>
  )
}
