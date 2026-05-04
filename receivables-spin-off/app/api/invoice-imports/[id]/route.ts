export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const batch = await prisma.invoiceImportBatch.findUnique({
    where: { id: params.id },
    include: {
      rows: {
        orderBy: { rowIndex: "asc" },
      },
    },
  })

  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 })
  return NextResponse.json(batch)
}

