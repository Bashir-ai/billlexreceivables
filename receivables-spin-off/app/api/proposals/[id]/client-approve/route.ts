export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return NextResponse.json(
    { error: "Client proposal approval workflow is disabled in internal-only mode" },
    { status: 410 }
  )
}

