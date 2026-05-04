import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getOutstandingInvoices } from "@/lib/invoice-helpers"
import { notifyOutstandingInvoice } from "@/lib/invoice-notifications"

export const dynamic = 'force-dynamic'

/**
 * Cron job endpoint to check for outstanding invoices and send reminders
 * Should be called daily (e.g., via Vercel Cron or external service)
 */
export async function GET(request: Request) {
  try {
    // Optional: Add authentication/authorization check for cron jobs
    // For Vercel Cron, you can use a secret header
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const outstandingInvoices = await getOutstandingInvoices()
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    
    let processedCount = 0
    let notifiedCount = 0

    for (const invoice of outstandingInvoices) {
      const isFirstTime = !invoice.becameOutstandingAt
      const needsReminder = 
        !invoice.lastReminderSentAt || 
        new Date(invoice.lastReminderSentAt) < sevenDaysAgo

      if (isFirstTime) {
        // First time becoming outstanding - set timestamp and send notification
        await prisma.bill.update({
          where: { id: invoice.id },
          data: {
            becameOutstandingAt: now,
            lastReminderSentAt: now,
            reminderCount: 1,
          },
        })
        
        await notifyOutstandingInvoice(invoice as any, true, 1)
        notifiedCount++
      } else if (needsReminder) {
        // Send reminder (7 days have passed)
        const newReminderCount = (invoice.reminderCount || 0) + 1
        
        await prisma.bill.update({
          where: { id: invoice.id },
          data: {
            lastReminderSentAt: now,
            reminderCount: newReminderCount,
          },
        })
        
        await notifyOutstandingInvoice(invoice as any, false, newReminderCount)
        notifiedCount++
      }
      
      processedCount++
    }

    return NextResponse.json({
      success: true,
      processed: processedCount,
      notified: notifiedCount,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error("Error checking outstanding invoices:", error)
    return NextResponse.json(
      { error: "Internal server error", details: (error as Error).message },
      { status: 500 }
    )
  }
}





