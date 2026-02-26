import { NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"
import {
  buildRevisionBehaviorData,
  getSessionDraftSnapshots,
  getSessionLogs,
  insertDraftSnapshot,
  insertInteractionLog,
  updateSessionReflectiveSummary,
  updateSessionSubmittedAt,
} from "@/lib/interaction-logs-server"

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
      metadata: { source: "submit_button" },
    })

    await insertDraftSnapshot({
      session_id,
      issue_id: null,
      stage: "final",
      draft_text: final_essay_text,
    })

    const sessionRow = await updateSessionSubmittedAt(session_id)

    const allLogs = await getSessionLogs(session_id)
    const allSnapshots = await getSessionDraftSnapshots(session_id)
    const revisionData = buildRevisionBehaviorData(allLogs, allSnapshots)

    const fallbackSummary = `Revision Insights

Revision Activity Overview
- Total revisions after analysis: ${revisionData.totalEditsAfterAnalyze}
- Revision window: ${revisionData.revisionWindowMinutes} minutes
- Draft length change: ${revisionData.firstDraftWordCount} -> ${revisionData.finalDraftWordCount} words (${revisionData.firstToFinalWordDelta >= 0 ? "+" : ""}${revisionData.firstToFinalWordDelta})

Feedback Escalation Pattern
- Level 1 views: ${revisionData.feedbackLevelCounts.level1}
- Level 2 views: ${revisionData.feedbackLevelCounts.level2}
- Level 3 views: ${revisionData.feedbackLevelCounts.level3}

Structural Changes Observed
- Most revised sections: ${revisionData.mostRevisedSections.join(", ") || "none detected"}

Suggested Focus for Future Revision
- Continue escalating to deeper feedback levels when revising key argument sections.
- Make one final cohesion pass after substantive edits to stabilize structure.
- Track revision goals per paragraph before editing to improve efficiency.`

    let summary = fallbackSummary
    try {
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
      summary = completion.choices[0]?.message?.content?.trim() || fallbackSummary
    } catch (openAiError) {
      console.error("OpenAI summary generation failed, returning fallback summary", openAiError)
    }

    try {
      await updateSessionReflectiveSummary(session_id, summary)
    } catch (persistError) {
      console.error("Failed to persist reflective_summary", persistError)
    }

    return NextResponse.json({
      success: true,
      final_submission_log_id: finalLog.id,
      revision_data: revisionData,
      summary,
      submitted_at: sessionRow.submitted_at,
    })
  } catch (error) {
    console.error("finalize-session POST failed", error)
    return NextResponse.json({ error: "Failed to finalize session" }, { status: 500 })
  }
}
