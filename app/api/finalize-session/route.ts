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
            content: `
            Generate a report titled \"Revision Insights\".

            Use ONLY the revision behavior data provided.

            Structure the report using these sections:

            1) How You Revised
              - Describe what the student’s revision behavior suggests about their writing process.
              - Explain how their time use and edit pattern likely influenced essay quality.

            2) What Improved
              - Identify signs of growth or stability in their argument or structure.
              - Explain what their behavior suggests about developing writing control.

            3) Revision Habits to Strengthen
              - Identify one helpful habit shown in the data.
              - Identify one limiting habit shown in the data.

            4) What to Try Next Time
              - Give 2–4 specific, practical revision strategies.
              - Suggestions must be concrete (e.g., “revise one paragraph deeply” instead of “improve structure”).

            Avoid technical language like "Level 2 feedback frequency".
            Translate feedback patterns into meaningful explanations.

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
