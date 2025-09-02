import { type NextRequest, NextResponse } from "next/server"
import { openai } from "@ai-sdk/openai"
import { generateObject } from "ai"
import { z } from "zod"

const ArgumentElementSchema = z.object({
  text: z.string(),
  effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]),
  feedback: z.string(),
  suggestions: z.string(),
  reason: z.string(),
})

const AnalysisResultSchema = z.object({
  elements: z.object({
    lead: ArgumentElementSchema,
    position: ArgumentElementSchema,
    claims: z.array(ArgumentElementSchema),
    counterclaim: ArgumentElementSchema,
    counterclaim_evidence: ArgumentElementSchema,
    rebuttal: ArgumentElementSchema,
    rebuttal_evidence: ArgumentElementSchema,
    evidence: z.array(ArgumentElementSchema),
    conclusion: ArgumentElementSchema,
  }),
})

export async function POST(request: NextRequest) {
  try {
    const { essay } = await request.json()

    if (!essay || essay.trim().length === 0) {
      return NextResponse.json({ error: "Essay content is required" }, { status: 400 })
    }

    const rubricPrompt = `
    You are an expert writing instructor analyzing argumentative essays using the Crossley argumentative writing rubric.

    RUBRIC EFFECTIVENESS LEVELS:
    - Effective: Element is strong, clear, and well-developed
    - Adequate: Element is present but could be improved
    - Ineffective: Element is weak or poorly developed
    - Missing: Element is not present in the essay

    ARGUMENTATIVE ELEMENTS TO ANALYZE:
    1. Lead: Opening that grabs attention and points toward position
    2. Position: Clear stance on the topic
    3. Claims: Supporting arguments for the position (identify multiple if present)
    4. Counterclaim: Acknowledgment of opposing viewpoint
    5. Counterclaim Evidence: Supporting evidence for the counterclaim
    6. Rebuttal: Response to the counterclaim
    7. Rebuttal Evidence: Supporting evidence for the rebuttal
    8. Evidence: Supporting facts, examples, statistics (identify multiple if present)
    9. Conclusion: Effective summary that restates claims

    For each element:
    - Extract the specific text from the essay (if found, max 100 characters)
    - Rate effectiveness using the rubric
    - Provide specific feedback
    - Suggest improvements

    `

    const result = await generateObject({
      model: openai("gpt-4o"),
      system: rubricPrompt,
      prompt: `Analyze this argumentative essay:\n\n${essay}`,
      schema: AnalysisResultSchema,
    })

    return NextResponse.json(result.object)
  } catch (error) {
    console.error("Error analyzing argumentative structure:", error)
    return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
  }
}
