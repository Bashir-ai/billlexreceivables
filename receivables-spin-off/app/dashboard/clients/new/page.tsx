"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import { sortedCountries } from "@/lib/countries"

interface ContactPerson {
  name: string
  email: string
  phone: string
  position: string
  isPrimary: boolean
}

interface ClientFinder {
  userId: string
  finderFeePercent: number
}

interface ClientManagementSplit {
  userId: string
  role: "CLIENT_MANAGER" | "PROJECT_MANAGER"
  splitPercent: number
  fixedAmount: number
}

export default function NewClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    contactInfo: "",
    portugueseTaxNumber: "",
    foreignTaxNumber: "",
    kycCompleted: false,
    isIndividual: false,
    fullLegalName: "",
    billingAddressLine: "",
    billingCity: "",
    billingState: "",
    billingZipCode: "",
    billingCountry: "",
    clientManagerId: "",
    clientManagerPercent: 100,
    clientCode: undefined as number | undefined,
    referrerName: "",
    referrerContactInfo: "",
  })
  const [suggestedCode, setSuggestedCode] = useState<number | null>(null)
  const [contacts, setContacts] = useState<ContactPerson[]>([])
  const [finders, setFinders] = useState<ClientFinder[]>([])
  const [managementSplits, setManagementSplits] = useState<ClientManagementSplit[]>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [managementUserSearch, setManagementUserSearch] = useState("")
  const [finderUserSearch, setFinderUserSearch] = useState("")
  const [clientManagerSearch, setClientManagerSearch] = useState("")

  const sortedUsers = useMemo(
    () =>
      [...users].sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          a.email.localeCompare(b.email, undefined, { sensitivity: "base" })
      ),
    [users]
  )

  const filterUsers = (query: string) => {
    const q = query.trim().toLowerCase()
    if (!q) return sortedUsers
    return sortedUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/users").then(res => res.json()),
      fetch("/api/clients/suggested-code").then(res => res.json()),
    ])
      .then(([usersData, codeData]) => {
        setUsers(usersData.filter((u: any) => u.role !== "CLIENT"))
        if (codeData.suggestedCode) {
          setSuggestedCode(codeData.suggestedCode)
          setFormData(prev => ({ ...prev, clientCode: codeData.suggestedCode }))
        }
      })
      .catch(console.error)
  }, [])

  const addContact = () => {
    setContacts([...contacts, { name: "", email: "", phone: "", position: "", isPrimary: contacts.length === 0 }])
  }

  const removeContact = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index))
  }

  const updateContact = (index: number, field: keyof ContactPerson, value: string | boolean) => {
    const updated = [...contacts]
    updated[index] = { ...updated[index], [field]: value }
    // If setting as primary, unset others
    if (field === "isPrimary" && value === true) {
      updated.forEach((contact, i) => {
        if (i !== index) contact.isPrimary = false
      })
    }
    setContacts(updated)
  }

  const addFinder = () => {
    setFinders([...finders, { userId: "", finderFeePercent: 0 }])
  }

  const removeFinder = (index: number) => {
    setFinders(finders.filter((_, i) => i !== index))
  }

  const updateFinder = (index: number, field: keyof ClientFinder, value: string | number) => {
    const updated = [...finders]
    updated[index] = { ...updated[index], [field]: value }
    setFinders(updated)
  }

  const addManagementSplit = () => {
    setManagementSplits([
      ...managementSplits,
      { userId: "", role: "CLIENT_MANAGER", splitPercent: 0, fixedAmount: 0 },
    ])
  }

  const removeManagementSplit = (index: number) => {
    setManagementSplits(managementSplits.filter((_, i) => i !== index))
  }

  const updateManagementSplit = (
    index: number,
    field: keyof ClientManagementSplit,
    value: string | number
  ) => {
    const updated = [...managementSplits]
    updated[index] = { ...updated[index], [field]: value } as ClientManagementSplit
    setManagementSplits(updated)
  }

  const buildManagementSplitsPayload = () => {
    const explicitSplits = managementSplits
      .filter((split) => split.userId.trim() !== "")
      .map((split) => ({
        ...split,
        fixedAmount: Number.isFinite(split.fixedAmount) ? split.fixedAmount : 0,
      }))

    const hasClientManagerRole = explicitSplits.some(
      (split) => split.role === "CLIENT_MANAGER"
    )
    if (!hasClientManagerRole && formData.clientManagerId.trim() !== "") {
      explicitSplits.push({
        userId: formData.clientManagerId,
        role: "CLIENT_MANAGER",
        splitPercent: Number(formData.clientManagerPercent) || 0,
        fixedAmount: 0,
      })
    }
    return explicitSplits
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          clientCode: formData.clientCode || null, // Send null if undefined to let server auto-generate
          contacts: contacts.filter(c => c.name.trim() !== ""), // Only send contacts with names
          finders: finders.filter(f => f.userId.trim() !== ""), // Only send finders with user selected
          managementSplits: buildManagementSplitsPayload(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || "Failed to create client")
      } else {
        router.push("/dashboard/clients")
      }
    } catch (err) {
      setError("An error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Add New Client</h1>
      <Card>
        <CardHeader>
          <CardTitle>Client Information</CardTitle>
          <CardDescription>Enter the client details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Client Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientCode">Client Code</Label>
              <Input
                id="clientCode"
                type="number"
                min="1"
                max="999"
                value={formData.clientCode ?? ""}
                onChange={(e) => setFormData({ ...formData, clientCode: e.target.value === "" ? undefined : parseInt(e.target.value) })}
                placeholder={suggestedCode ? `Suggested: ${suggestedCode}` : "Auto-generated"}
              />
              <p className="text-xs text-gray-500">
                {suggestedCode ? `Suggested code: ${suggestedCode}. Leave empty to use suggested code, or enter a custom code (1-999).` : "Leave empty to auto-generate, or enter a custom code (1-999)."}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Client Type</Label>
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="clientTypeIndividual"
                    name="clientType"
                    checked={formData.isIndividual === true}
                    onChange={() => setFormData({ ...formData, isIndividual: true })}
                    className="rounded"
                  />
                  <Label htmlFor="clientTypeIndividual" className="cursor-pointer">
                    Individual Client
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="clientTypeCompany"
                    name="clientType"
                    checked={formData.isIndividual === false}
                    onChange={() => setFormData({ ...formData, isIndividual: false })}
                    className="rounded"
                  />
                  <Label htmlFor="clientTypeCompany" className="cursor-pointer">
                    Company
                  </Label>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fullLegalName">Full Legal Name</Label>
              <Input
                id="fullLegalName"
                value={formData.fullLegalName}
                onChange={(e) => setFormData({ ...formData, fullLegalName: e.target.value })}
                placeholder="Enter full legal name"
              />
            </div>

            <div className="space-y-4 border-t pt-4">
              <h3 className="font-semibold">Billing Address</h3>
              <div className="space-y-2">
                <Label htmlFor="billingAddressLine">Address Line</Label>
                <Input
                  id="billingAddressLine"
                  value={formData.billingAddressLine}
                  onChange={(e) => setFormData({ ...formData, billingAddressLine: e.target.value })}
                  placeholder="Street address"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="billingCity">City</Label>
                  <Input
                    id="billingCity"
                    value={formData.billingCity}
                    onChange={(e) => setFormData({ ...formData, billingCity: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billingState">State</Label>
                  <Input
                    id="billingState"
                    value={formData.billingState}
                    onChange={(e) => setFormData({ ...formData, billingState: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="billingZipCode">Zip Code</Label>
                  <Input
                    id="billingZipCode"
                    value={formData.billingZipCode}
                    onChange={(e) => setFormData({ ...formData, billingZipCode: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billingCountry">Country</Label>
                  <Select
                    id="billingCountry"
                    value={formData.billingCountry}
                    onChange={(e) => setFormData({ ...formData, billingCountry: e.target.value })}
                  >
                    <option value="">Select a country</option>
                    {sortedCountries.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Management Splits</Label>
                <Button type="button" variant="outline" size="sm" onClick={addManagementSplit}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Split
                </Button>
              </div>
              {managementSplits.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="managementUserSearch">Filter users</Label>
                  <Input
                    id="managementUserSearch"
                    value={managementUserSearch}
                    onChange={(e) => setManagementUserSearch(e.target.value)}
                    placeholder="Type name or email..."
                  />
                </div>
              )}
              {managementSplits.map((split, index) => (
                <Card key={`mgmt-${index}`} className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label>User</Label>
                      <Select value={split.userId} onChange={(e) => updateManagementSplit(index, "userId", e.target.value)}>
                        <option value="">Select a user...</option>
                        {filterUsers(managementUserSearch).map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name} ({user.email})
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={split.role} onChange={(e) => updateManagementSplit(index, "role", e.target.value)}>
                        <option value="CLIENT_MANAGER">Client Manager</option>
                        <option value="PROJECT_MANAGER">Project Manager</option>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Split %</Label>
                      <Input type="number" min="0" max="100" step="0.01" value={split.splitPercent} onChange={(e) => updateManagementSplit(index, "splitPercent", parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Fixed Amount</Label>
                      <Input type="number" min="0" step="0.01" value={split.fixedAmount} onChange={(e) => updateManagementSplit(index, "fixedAmount", parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                  <div className="flex justify-end mt-4">
                    <Button type="button" variant="outline" size="sm" onClick={() => removeManagementSplit(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactInfo">Contact Information</Label>
              <Textarea
                id="contactInfo"
                value={formData.contactInfo}
                onChange={(e) => setFormData({ ...formData, contactInfo: e.target.value })}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="portugueseTaxNumber">Portuguese Tax Number (NIF)</Label>
                <Input
                  id="portugueseTaxNumber"
                  value={formData.portugueseTaxNumber}
                  onChange={(e) => setFormData({ ...formData, portugueseTaxNumber: e.target.value })}
                  placeholder="123456789"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="foreignTaxNumber">Foreign Tax Number</Label>
                <Input
                  id="foreignTaxNumber"
                  value={formData.foreignTaxNumber}
                  onChange={(e) => setFormData({ ...formData, foreignTaxNumber: e.target.value })}
                  placeholder="If applicable"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="kycCompleted"
                checked={formData.kycCompleted}
                onCheckedChange={(checked) => setFormData({ ...formData, kycCompleted: !!checked })}
              />
              <Label htmlFor="kycCompleted" className="cursor-pointer">
                KYC Completed
              </Label>
            </div>

            <div className="space-y-4 border-t pt-4">
              <Label className="text-base font-semibold">Referrer Information</Label>
              <CardDescription>Person or entity who recommended this client</CardDescription>
              <div className="space-y-2">
                <Label htmlFor="referrerName">Referrer Name</Label>
                <Input
                  id="referrerName"
                  value={formData.referrerName}
                  onChange={(e) => setFormData({ ...formData, referrerName: e.target.value })}
                  placeholder="Name of person or entity who recommended this client"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="referrerContactInfo">Referrer Contact Info</Label>
                <Textarea
                  id="referrerContactInfo"
                  value={formData.referrerContactInfo}
                  onChange={(e) => setFormData({ ...formData, referrerContactInfo: e.target.value })}
                  rows={2}
                  placeholder="Email, phone, or other contact information for the referrer"
                />
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Client Finders</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addFinder}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Finder
                </Button>
              </div>
              {finders.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="finderUserSearch">Filter users</Label>
                  <Input
                    id="finderUserSearch"
                    value={finderUserSearch}
                    onChange={(e) => setFinderUserSearch(e.target.value)}
                    placeholder="Type name or email..."
                  />
                </div>
              )}
              {finders.map((finder, index) => {
                const availableUsers = filterUsers(finderUserSearch).filter(u =>
                  !finders.some((f, i) => i !== index && f.userId === u.id)
                )
                return (
                  <Card key={index} className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Finder *</Label>
                        <Select
                          value={finder.userId}
                          onChange={(e) => updateFinder(index, "userId", e.target.value)}
                          required
                        >
                          <option value="">Select a user...</option>
                          {availableUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name} ({user.email})
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Finder Fee Percentage (%)</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={finder.finderFeePercent}
                          onChange={(e) => updateFinder(index, "finderFeePercent", parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeFinder(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                )
              })}
              {finders.length === 0 && (
                <p className="text-sm text-gray-500">No finders added. Click &quot;Add Finder&quot; to add one.</p>
              )}
            </div>

            <div className="space-y-4 border-t pt-4">
              <Label className="text-base font-semibold">Client Manager (default)</Label>
              <Card className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="clientManagerId">Manager</Label>
                    <Input
                      id="clientManagerSearch"
                      value={clientManagerSearch}
                      onChange={(e) => setClientManagerSearch(e.target.value)}
                      placeholder="Type name or email..."
                    />
                    <Select
                      id="clientManagerId"
                      value={formData.clientManagerId}
                      onChange={(e) => setFormData({ ...formData, clientManagerId: e.target.value })}
                    >
                      <option value="">None</option>
                      {filterUsers(clientManagerSearch).map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} ({user.email})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clientManagerPercent">Percentage (%)</Label>
                    <Input
                      id="clientManagerPercent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={formData.clientManagerPercent}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          clientManagerPercent: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
              </Card>
              <CardDescription>
                Default client-level manager used when an invoice has no explicit client manager split override.
              </CardDescription>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Contact Persons</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addContact}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Contact
                </Button>
              </div>
              {contacts.map((contact, index) => (
                <Card key={index} className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Name *</Label>
                      <Input
                        value={contact.name}
                        onChange={(e) => updateContact(index, "name", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={contact.email}
                        onChange={(e) => updateContact(index, "email", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={contact.phone}
                        onChange={(e) => updateContact(index, "phone", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Position</Label>
                      <Input
                        value={contact.position}
                        onChange={(e) => updateContact(index, "position", e.target.value)}
                        placeholder="e.g., CEO, CFO"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={contact.isPrimary}
                        onCheckedChange={(checked) => updateContact(index, "isPrimary", !!checked)}
                      />
                      <Label className="text-sm">Primary Contact</Label>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeContact(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
              {contacts.length === 0 && (
                <p className="text-sm text-gray-500">No contact persons added. Click &quot;Add Contact&quot; to add one.</p>
              )}
            </div>

            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}
            <div className="flex space-x-4">
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create Client"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}


