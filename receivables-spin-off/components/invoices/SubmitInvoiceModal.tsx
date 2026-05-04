"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { X } from "lucide-react"
import { useRouter } from "next/navigation"

interface SubmitInvoiceModalProps {
  invoiceId: string
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function SubmitInvoiceModal({
  invoiceId,
  isOpen,
  onClose,
  onSuccess,
}: SubmitInvoiceModalProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/bills/${invoiceId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to submit invoice")
      }

      // Trigger notification refresh
      window.dispatchEvent(new Event("notifications:refresh"))
      
      onSuccess?.()
      onClose()
      router.refresh()
    } catch (err: any) {
      setError(err.message || "Failed to submit invoice")
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Finalize Invoice</CardTitle>
              <CardDescription>
                Finalize this invoice now. It will be marked as approved immediately.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="p-4 bg-blue-50 border border-blue-200 rounded">
            <p className="text-sm text-gray-700">
              <strong>Note:</strong> Internal approval is disabled in this version.
              Finalizing will mark the invoice as approved immediately.
            </p>
          </div>

          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Finalizing..." : "Finalize Invoice"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

