export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  return NextResponse.json(
    { error: "Approval workflow is disabled in internal-only mode" },
    { status: 410 }
  )
}




