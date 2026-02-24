import { NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"
import { buildRevisionBehaviorData, getSessionLogs, insertInteractionLog } from "@/lib/interaction-logs-server"

const bodySchema = z.object({
  session_id: z.string().uuid(),
  final_essay_text: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 })
    }

    const { session_id, final_essay_text } = parsed.data

    const finalLog = await insertInteractionLog({
      session_id,
      event_type: "final_submission",
      essay_text: final_essay_text,
      metadata: { source: "submit_button" },
    })

    const allLogs = await getSessionLogs(session_id)
    const revisionData = buildRevisionBehaviorData(allLogs)

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are an expert writing process analyst. Do NOT summarize essay content. Summarize revision behavior only and provide reflective insights about decision-making.",
        },
        {
          role: "user",
          content: `Generate a structured report with the exact heading \"Revision Insights\".

Requirements:
- Do NOT summarize essay content.
- Use revision-behavior data only.
- Include these sections in order:
  1) Revision Activity Overview
  2) Feedback Escalation Pattern
  3) Structural Changes Observed
  4) Suggested Focus for Future Revision
- Be specific and actionable.

Revision behavior data:
${JSON.stringify(revisionData, null, 2)}`,
        },
      ],
    })

    const summary = completion.choices[0]?.message?.content?.trim()

    if (!summary) {
      return NextResponse.json({ error: "OpenAI returned an empty summary" }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      final_submission_log_id: finalLog.id,
      revision_data: revisionData,
      summary,
      submitted_at: finalLog.timestamp,
    })
  } catch (error) {
    console.error("finalize-session POST failed", error)
    return NextResponse.json({ error: "Failed to finalize session" }, { status: 500 })
  }
}
