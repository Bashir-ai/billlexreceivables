export interface Notification {
  type: string
  id: string
  itemId: string
  title: string
  proposalNumber?: string
  invoiceNumber?: string
  client?: {
    name: string
    company?: string | null
  } | null
  createdAt: string
}

export async function getNotifications(userId: string, userRole: string): Promise<{ count: number; notifications: Notification[] }> {
  try {
    const notifications = await getOutstandingInvoiceNotifications(userId)
    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return {
      count: notifications.length,
      notifications: notifications.slice(0, 20),
    }
  } catch (error) {
    console.error("Error fetching notifications:", error)
    return { count: 0, notifications: [] }
  }
}

export async function createTodoNotification(
  todoId: string,
  assigneeId: string,
  creatorId: string
): Promise<void> {
  // Todo notifications are disabled in internal-only mode.
  void todoId
  void assigneeId
  void creatorId
}

export async function createOutstandingInvoiceNotification(
  billId: string,
  userId: string,
  reminderNumber: number = 0,
  isFirstTime: boolean = false
): Promise<void> {
  // Outstanding invoice notifications are computed dynamically in getOutstandingInvoiceNotifications.
  void billId
  void userId
  void reminderNumber
  void isFirstTime
}

export async function getOutstandingInvoiceNotifications(userId: string): Promise<Notification[]> {
  try {
    const { getOutstandingInvoices } = await import("@/lib/invoice-helpers")
    const { getOutstandingInvoiceRecipients } = await import("@/lib/invoice-notifications")

    const outstandingInvoices = await getOutstandingInvoices()
    const notifications: Notification[] = []

    for (const invoice of outstandingInvoices) {
      const recipients = await getOutstandingInvoiceRecipients(invoice as any)
      if (!recipients.includes(userId)) continue

      const clientOrLead = invoice.client || invoice.lead
      if (!clientOrLead) continue

      notifications.push({
        type: "invoice_outstanding",
        id: `invoice-outstanding-${invoice.id}`,
        itemId: invoice.id,
        title: `Outstanding Invoice ${invoice.invoiceNumber || invoice.id}`,
        invoiceNumber: invoice.invoiceNumber || undefined,
        client: {
          name: clientOrLead.name,
          company: clientOrLead.company || undefined,
        },
        createdAt: invoice.becameOutstandingAt?.toISOString() || invoice.createdAt.toISOString(),
      })
    }

    return notifications
  } catch (error) {
    console.error("Error fetching outstanding invoice notifications:", error)
    return []
  }
}
