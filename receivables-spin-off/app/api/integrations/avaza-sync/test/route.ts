export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { AvazaClient } from "@/lib/integrations/avaza-client"

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const client = new AvazaClient()
    const [account, probe] = await Promise.all([client.getAccountSummary(), client.getConnectionProbe()])

    return NextResponse.json({
      success: true,
      message: "Avaza connection is working",
      account,
      sampled: {
        clients: probe.companyCount,
        invoices: probe.invoiceCount,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Avaza connection test failed",
        message: error?.message || String(error),
      },
      { status: 500 }
    )
  }
}
