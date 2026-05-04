"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { AlertCircle, RefreshCw, Check } from "lucide-react"
import Link from "next/link"
import { formatDate, formatClientName, cn } from "@/lib/utils"
import { ChevronDown, ChevronUp } from "lucide-react"

interface Notification {
  type: string
  id: string
  itemId: string
  title: string
  proposalNumber?: string
  invoiceNumber?: string
  client?: {
    name: string
    clientCode?: number | null
    company?: string | null
  } | null
  createdAt: string
}

interface NotificationsBoxProps {
  initialCount: number
  initialNotifications: Notification[]
  isCollapsed?: boolean
  isFloating?: boolean
}

export function NotificationsBox({ initialCount, initialNotifications, isCollapsed = false, isFloating = false }: NotificationsBoxProps) {
  const { data: session } = useSession()
  const role = session?.user?.role

  const initialNotificationsArray = Array.isArray(initialNotifications) ? initialNotifications : []
  const [notifications, setNotifications] = useState<Notification[]>(initialNotificationsArray)
  const [count, setCount] = useState(initialCount)
  const [isOpen, setIsOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  /** Read / dismissed ids — merged from server read-status on refresh (no localStorage; avoids skew with DB) */
  const [viewedNotifications, setViewedNotifications] = useState<Set<string>>(new Set())
  const [lastMarkedAsReadTime, setLastMarkedAsReadTime] = useState<number>(0)
  const [opsCounts, setOpsCounts] = useState<{ collectionsCount: number; payrollCount: number } | null>(null)

  // Use a ref to track viewedNotifications for use in callbacks
  const viewedNotificationsRef = useRef(viewedNotifications)
  
  // Update ref when viewedNotifications changes
  useEffect(() => {
    viewedNotificationsRef.current = viewedNotifications
  }, [viewedNotifications])

  useEffect(() => {
    if (!role || role === "CLIENT") {
      setOpsCounts(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/operations?countsOnly=true&t=${Date.now()}`, { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data && typeof data.collectionsCount === "number") {
          setOpsCounts({
            collectionsCount: data.collectionsCount,
            payrollCount: data.payrollCount ?? 0,
          })
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [role])

  const refreshNotifications = useCallback(async () => {
    // Don't refresh if we just marked a notification as read (within last 5 seconds)
    // This prevents race conditions where refresh happens before database update completes
    const timeSinceLastMark = Date.now() - lastMarkedAsReadTime
    if (timeSinceLastMark < 5000) {
      return
    }

    setIsRefreshing(true)
    try {
      // Fetch read notification records to sync with database state first
      let databaseReadIds: string[] = []
      try {
        const readResponse = await fetch(`/api/notifications/read-status?t=${Date.now()}`, {
          cache: "no-store",
        })
        if (readResponse.ok) {
          const readData = await readResponse.json()
          if (readData && Array.isArray(readData.readIds)) {
            databaseReadIds = readData.readIds
          }
        }
      } catch (error) {
        // If fetching read status fails, continue with existing viewedNotifications
        console.error("Failed to fetch read notification status:", error)
      }

      // Merge database read state with local viewedNotifications
      const mergedReadSet = new Set<string>()
      // Add existing viewed notifications
      viewedNotificationsRef.current.forEach(id => mergedReadSet.add(id))
      // Add database read IDs
      databaseReadIds.forEach((id: string) => mergedReadSet.add(id))
      
      // For each database read ID, also add all possible format variations
      databaseReadIds.forEach((id: string) => {
        // If it's in format "proposal_approval:123", also add "proposal-123"
        if (id.startsWith("proposal_approval:")) {
          const itemId = id.replace("proposal_approval:", "")
          mergedReadSet.add(`proposal-${itemId}`)
        }
        // If it's in format "invoice_approval:123", also add "invoice-123"
        else if (id.startsWith("invoice_approval:")) {
          const itemId = id.replace("invoice_approval:", "")
          mergedReadSet.add(`invoice-${itemId}`)
        }
        // If it's in format "invoice_outstanding:123" or "invoice_reminder:123", also add "invoice-outstanding-123"
        else if (id.startsWith("invoice_outstanding:") || id.startsWith("invoice_reminder:")) {
          const itemId = id.includes(":") ? id.split(":")[1] : id.replace(/^(invoice_outstanding|invoice_reminder):/, "")
          mergedReadSet.add(`invoice-outstanding-${itemId}`)
        }
        // If it's in format "proposal_pending_client:123" or "proposal_pending_client_overdue:123", also add "proposal-client-123"
        else if (id.startsWith("proposal_pending_client")) {
          const itemId = id.includes(":") ? id.split(":")[1] : id.replace(/^proposal_pending_client(_overdue)?:/, "")
          mergedReadSet.add(`proposal-client-${itemId}`)
        }
        // If it's in format "todo-123", also add "todo_assignment:123" (though this might not be used)
        else if (id.startsWith("todo-")) {
          const itemId = id.replace("todo-", "")
          mergedReadSet.add(`todo_assignment:${itemId}`)
        }
      })
      
      // Update state with merged set
      setViewedNotifications(mergedReadSet)

      // Add timestamp to prevent caching
      const response = await fetch(`/api/notifications?t=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      })
      
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json()
      if (data && typeof data === "object") {
        if (Array.isArray(data.notifications)) {
          // Filter notifications using the merged read set
          // Check both the notification ID and the format that getNotifications uses
          const filteredNotifications = data.notifications.filter((n: Notification) => {
            const isReadById = mergedReadSet.has(n.id)
            // Also check the format that getNotifications uses (notificationType:itemId)
            let isReadByFormat = false
            if (n.type === "proposal_approval") {
              isReadByFormat = mergedReadSet.has(`proposal_approval:${n.itemId}`) || mergedReadSet.has(`proposal-${n.itemId}`)
            } else if (n.type === "invoice_approval") {
              isReadByFormat = mergedReadSet.has(`invoice_approval:${n.itemId}`) || mergedReadSet.has(`invoice-${n.itemId}`)
            } else if (n.type === "invoice_outstanding" || n.type === "invoice_reminder") {
              isReadByFormat = mergedReadSet.has(`invoice_outstanding:${n.itemId}`) || 
                              mergedReadSet.has(`invoice_reminder:${n.itemId}`) ||
                              mergedReadSet.has(`invoice-outstanding-${n.itemId}`)
            } else if (n.type === "proposal_pending_client" || n.type === "proposal_pending_client_overdue") {
              isReadByFormat = mergedReadSet.has(`${n.type}:${n.itemId}`) || mergedReadSet.has(`proposal-client-${n.itemId}`)
            } else if (n.type === "todo_assignment") {
              isReadByFormat = mergedReadSet.has(`todo-${n.itemId}`) || mergedReadSet.has(`todo_assignment:${n.itemId}`)
            } else if (n.type === "recurring_payment_due" || n.type === "installment_due") {
              // These use direct notification IDs from the Notification model
              isReadByFormat = mergedReadSet.has(n.id)
            }
            return !isReadById && !isReadByFormat
          })
          setNotifications(filteredNotifications)
          
          // Update count based on filtered notifications
          setCount(filteredNotifications.length)
        } else if (typeof data.count === "number") {
          setCount(data.count)
        }
      }
    } catch (error) {
      console.error("Failed to refresh notifications:", error)
      // Don't update state on error, keep existing notifications
    } finally {
      setIsRefreshing(false)
    }
  }, [lastMarkedAsReadTime])

  useEffect(() => {
    // Refresh on mount to get latest data
    refreshNotifications()
    
    // Refresh notifications every 30 seconds
    const interval = setInterval(refreshNotifications, 30000)
    
    // Refresh when page becomes visible (user switches back to tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshNotifications()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    
    // Listen for custom refresh events (e.g., after approval)
    const handleRefreshEvent = () => {
      refreshNotifications()
    }
    window.addEventListener("notifications:refresh", handleRefreshEvent)
    
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("notifications:refresh", handleRefreshEvent)
    }
  }, [refreshNotifications])

  const getNotificationLink = (notification: Notification): string => {
    if (notification.type === "invoice_outstanding" || notification.type === "invoice_reminder") {
      return `/dashboard/bills/${notification.itemId}`
    }
    return "/dashboard/bills?status=OUTSTANDING"
  }

  const getNotificationLabel = (notification: Notification): string => {
    switch (notification.type) {
      case "invoice_outstanding":
      case "invoice_reminder":
        return "Outstanding invoice"
      default:
        return "Outstanding invoice"
    }
  }

  const handleMarkAsViewed = useCallback(async (notificationId: string) => {
    try {
      // Get the notification to determine its type
      const notification = notifications.find(n => n.id === notificationId)
      if (!notification) return

      // Create the format that getNotifications checks (notificationType:itemId)
      let readIdFormat = ""
      if (notification.type === "proposal_approval") {
        readIdFormat = `proposal_approval:${notification.itemId}`
      } else if (notification.type === "invoice_approval") {
        readIdFormat = `invoice_approval:${notification.itemId}`
      } else if (notification.type === "invoice_outstanding" || notification.type === "invoice_reminder") {
        readIdFormat = `invoice_outstanding:${notification.itemId}`
      } else if (notification.type === "proposal_pending_client" || notification.type === "proposal_pending_client_overdue") {
        readIdFormat = `${notification.type}:${notification.itemId}`
      } else if (notification.type === "todo_assignment") {
        readIdFormat = `todo-${notification.itemId}`
      } else if (notification.type === "recurring_payment_due" || notification.type === "installment_due") {
        // These use direct notification IDs
        readIdFormat = notificationId
      }

      // Mark as read in the database first
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "PUT",
      })
      
      if (!response.ok) {
        // If marking as read failed, don't remove from UI
        console.error("Failed to mark notification as read")
        return
      }

      // Wait 500ms for database transaction to complete
      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify the notification is in the read-status API response
      try {
        const verifyResponse = await fetch(`/api/notifications/read-status?t=${Date.now()}`, {
          cache: "no-store",
        })
        if (verifyResponse.ok) {
          const verifyData = await verifyResponse.json()
          if (verifyData && Array.isArray(verifyData.readIds)) {
            const isVerified = verifyData.readIds.includes(notificationId) || 
                             verifyData.readIds.includes(readIdFormat) ||
                             (readIdFormat && verifyData.readIds.some((id: string) => id.includes(notification.itemId)))
            
            if (!isVerified) {
              // Verification failed, don't remove from UI
              console.warn("Notification read status verification failed")
              return
            }
          }
        }
      } catch (verifyError) {
        // If verification fails, still proceed (might be a network issue)
        console.warn("Could not verify notification read status:", verifyError)
      }

      // Only remove from local state after successful verification
      setNotifications(prev => prev.filter(n => n.id !== notificationId))
      setViewedNotifications(prev => {
        const newSet = new Set(prev)
        newSet.add(notificationId)
        if (readIdFormat) {
          newSet.add(readIdFormat)
        }
        return newSet
      })
      
      // Update the ref immediately so subsequent refreshes respect this
      viewedNotificationsRef.current.add(notificationId)
      if (readIdFormat) {
        viewedNotificationsRef.current.add(readIdFormat)
      }
      // Record the time we marked as read to prevent immediate refresh
      setLastMarkedAsReadTime(Date.now())
    } catch (error) {
      console.error("Error marking notification as read:", error)
      // On error, don't remove from UI
    }
  }, [refreshNotifications, notifications])

  const handleMarkAllAsViewed = useCallback(async () => {
    try {
      // Optimistically clear all notifications from local state
      const notificationsArray = Array.isArray(notifications) ? notifications : []
      const allIds = new Set(notificationsArray.map(n => n.id))
      setNotifications([])
      setViewedNotifications(prev => {
        const merged = new Set(prev)
        allIds.forEach(id => merged.add(id))
        return merged
      })
      
      // Update ref immediately
      allIds.forEach(id => viewedNotificationsRef.current.add(id))
      
      // Mark all notifications as read in the database
      const promises = notificationsArray.map(n => 
        fetch(`/api/notifications/${n.id}/read`, { method: "PUT" })
      )
      const results = await Promise.allSettled(promises)
      
      // Check if any failed
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok))
      if (failed.length > 0) {
        console.error("Some notifications failed to mark as read")
        // Refresh to restore any that failed (after delay)
        setTimeout(() => refreshNotifications(), 2000)
      } else {
        // Record the time we marked as read to prevent immediate refresh
        setLastMarkedAsReadTime(Date.now())
      }
    } catch (error) {
      console.error("Error marking all notifications as read:", error)
      // On error, refresh to restore notifications (after delay)
      setTimeout(() => refreshNotifications(), 2000)
    }
  }, [notifications, refreshNotifications])

  // Filter out viewed notifications and calculate count
  const notificationsArray = Array.isArray(notifications) ? notifications : []
  const unviewedNotifications = notificationsArray.filter(n => !viewedNotifications.has(n.id))
  const displayCount = unviewedNotifications.length

  return (
    <div className="relative">
      <Button
        variant={displayCount > 0 ? "default" : "outline"}
        size={isFloating ? "default" : "sm"}
        onClick={() => setIsOpen(true)}
        className={cn(
          "relative shadow-lg",
          displayCount > 0 && "bg-red-600 hover:bg-red-700 text-white",
          isFloating && "h-12 px-4"
        )}
      >
        <AlertCircle className={cn("h-4 w-4", isFloating && "mr-2")} />
        {(!isCollapsed || isFloating) && "Inbox"}
        {displayCount > 0 && (
          <span className={cn(
            "absolute bg-white text-red-600 text-xs font-bold rounded-full flex items-center justify-center",
            isFloating ? "-top-2 -right-2 h-7 w-7" : isCollapsed ? "-top-1 -right-1 h-5 w-5" : "-top-2 -right-2 h-6 w-6"
          )}>
            {displayCount > 9 ? "9+" : displayCount}
          </span>
        )}
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col max-h-[90vh] gap-0 p-0 [&>button]:top-4"
        >
          <SheetHeader className="p-4 pb-2 space-y-1 border-b shrink-0 text-left">
            <div className="flex items-start justify-between gap-2 pr-8">
              <div>
                <SheetTitle>Inbox</SheetTitle>
                <SheetDescription>Outstanding reminders. Mark read is stored on the server.</SheetDescription>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {unviewedNotifications.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={handleMarkAllAsViewed} className="h-8 px-2 text-xs">
                    Mark all
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => refreshNotifications()} disabled={isRefreshing} className="h-8 w-8 p-0">
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            {unviewedNotifications.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No unread items.</div>
            ) : (
              <div className="divide-y">
                {Array.isArray(unviewedNotifications) &&
                  unviewedNotifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      getNotificationLabel={getNotificationLabel}
                      getNotificationLink={getNotificationLink}
                      onClose={() => setIsOpen(false)}
                      onMarkAsViewed={() => handleMarkAsViewed(notification.id)}
                      isViewed={viewedNotifications.has(notification.id)}
                    />
                  ))}
              </div>
            )}
          </div>
          <div className="border-t p-4 space-y-3 bg-muted/40 shrink-0">
            {opsCounts ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className={cn("text-xs", opsCounts.collectionsCount > 0 && "border-amber-600 text-amber-900")}
                >
                  <Link href="/dashboard/operations">Collections ({opsCounts.collectionsCount})</Link>
                </Button>
                {(role === "ADMIN" || role === "MANAGER") ? (
                  <Button asChild variant="outline" size="sm" className="text-xs">
                    <Link href="/dashboard/operations?tab=payroll">Payroll ({opsCounts.payrollCount})</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Operational queues (collections + payroll) live on the Operations hub — broader than this inbox list.
            </p>
            <Button asChild className="w-full" variant="secondary">
              <Link href="/dashboard/operations" onClick={() => setIsOpen(false)}>
                Open Operations hub →
              </Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function NotificationItem({
  notification,
  getNotificationLabel,
  getNotificationLink,
  onClose,
  onMarkAsViewed,
  isViewed,
}: {
  notification: Notification
  getNotificationLabel: (notification: Notification) => string
  getNotificationLink: (notification: Notification) => string
  onClose: () => void
  onMarkAsViewed?: () => void
  isViewed?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const link = getNotificationLink(notification)

  const handleMarkAsViewed = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await onMarkAsViewed?.()
  }

  return (
    <div className={cn("block", isViewed && "opacity-60")}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "p-3 hover:bg-gray-50 transition-colors cursor-pointer",
          isViewed && "bg-gray-50"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-gray-900">
                {getNotificationLabel(notification)}
              </p>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              )}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              {notification.title}
            </p>
            {isExpanded && (
              <div className="mt-2 space-y-1">
                {notification.client && (
                  <p className="text-xs text-gray-500">
                    <span className="font-medium">Client:</span> {formatClientName(notification.client)}
                    {notification.client.company && ` • ${notification.client.company}`}
                  </p>
                )}
                {notification.proposalNumber && (
                  <p className="text-xs text-gray-500">
                    <span className="font-medium">Proposal:</span> {notification.proposalNumber}
                  </p>
                )}
                {notification.invoiceNumber && (
                  <p className="text-xs text-gray-500">
                    <span className="font-medium">Invoice:</span> {notification.invoiceNumber}
                  </p>
                )}
                <p className="text-xs text-gray-400">
                  {formatDate(notification.createdAt)}
                </p>
              </div>
            )}
            {!isExpanded && (
              <p className="text-xs text-gray-400 mt-1">
                {formatDate(notification.createdAt)}
              </p>
            )}
          </div>
          {onMarkAsViewed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAsViewed}
              className="h-6 w-6 p-0 flex-shrink-0"
              title="Mark as viewed"
            >
              <Check className="h-3.5 w-3.5 text-gray-500" />
            </Button>
          )}
        </div>
      </div>
      <div className="px-3 pb-2 flex items-center justify-between gap-2">
        <Link
          href={link}
          onClick={onClose}
          className="text-xs text-blue-600 hover:text-blue-800 underline"
        >
          View Details →
        </Link>
      </div>
    </div>
  )
}

