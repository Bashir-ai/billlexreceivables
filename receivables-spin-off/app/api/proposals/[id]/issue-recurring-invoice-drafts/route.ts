import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  return NextResponse.json(
    { error: "Proposal recurring invoice workflow is disabled in internal-only mode" },
    { status: 410 }
  )
}

