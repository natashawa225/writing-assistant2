import { NextResponse } from "next/server"
import { z } from "zod"
import { insertInteractionLog, type InteractionEventType } from "@/lib/interaction-logs-server"

const bodySchema = z.object({
  session_id: z.string().uuid(),
  event_type: z.enum([
    "initial_draft",
    "edit",
    "feedback_level_1",
    "feedback_level_2",
    "feedback_level_3",
    "analyze_clicked",
    "final_submission",
  ]),
  essay_text: z.string().optional().nullable(),
  feedback_level: z.number().int().min(1).max(3).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  timestamp: z.string().datetime().optional(),
})

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 })
    }

    const row = await insertInteractionLog({
      session_id: parsed.data.session_id,
      event_type: parsed.data.event_type as InteractionEventType,
      essay_text: parsed.data.essay_text,
      feedback_level: parsed.data.feedback_level,
      metadata: parsed.data.metadata ?? null,
      timestamp: parsed.data.timestamp,
    })

    return NextResponse.json({ success: true, row })
  } catch (error) {
    console.error("interaction-log POST failed", error)
    return NextResponse.json({ error: "Failed to log interaction" }, { status: 500 })
  }
}
