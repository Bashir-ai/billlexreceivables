"use client"

import { Button } from "@/components/ui/button"
import { UserRole } from "@prisma/client"

interface ApprovalButtonProps {
  proposalId?: string
  billId?: string
  currentUserRole: UserRole
}

export function ApprovalButton({ proposalId, billId, currentUserRole }: ApprovalButtonProps) {
  return (
    <div className="space-y-2" role="group" aria-label="Approval actions disabled">
      <Button variant="outline" disabled>
        Approval Disabled (Internal Mode)
      </Button>
      <p className="text-xs text-gray-500">
        Internal approvals were removed for this simplified receivables workflow.
      </p>
    </div>
  )
}




