"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SubmitInvoiceModal } from "./SubmitInvoiceModal"

interface SubmitInvoiceButtonProps {
  invoiceId: string
  canSubmit: boolean
}

export function SubmitInvoiceButton({ invoiceId, canSubmit }: SubmitInvoiceButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  if (!canSubmit) return null

  return (
    <>
      <Button onClick={() => setIsModalOpen(true)}>
        Finalize Invoice
      </Button>
      <SubmitInvoiceModal
        invoiceId={invoiceId}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => setIsModalOpen(false)}
      />
    </>
  )
}






