import { type NextRequest, NextResponse } from "next/server"
import { generateObject } from "ai"
import { z } from "zod"
import { openai } from "@/lib/openai"

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

// schema for feedback on the full set of elements
const FeedbackResultSchema = AnalysisResultSchema

// helper: map any FT element → ArgumentElementSchema
function mapElement(element: any) {
  if (!element) return { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" }
  return {
    text: element.sentence ?? "",
    effectiveness: element.effectiveness ?? "Missing",
    feedback: "",
    suggestions: "",
    reason: "",
  }
}

// helper: normalize arrays from FT model → match fixed schema
function normalizeAnalysis(raw: any) {
  const e = raw.elements ?? {};

  // --- Claims ---
  const allClaims = [...(e.claims ?? []), ...(e.counterclaims ?? [])];
  const claims = allClaims.map(mapElement); // all claims in order
  const counterclaim = claims.find((_, idx) => (e.counterclaims ?? []).length > 0 && idx >= (e.claims ?? []).length)
    ?? { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };

  // --- Evidence ---
  const allEvidence = [
    ...(e.evidence ?? []),
    ...(e.counterclaim_evidence ?? []),
    ...(e.rebuttal_evidence ?? [])
  ];
  const evidence = (e.evidence ?? []).map(mapElement);
  const counterclaim_evidence = (e.counterclaim_evidence ?? []).map(mapElement)[0] ?? { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };
  const rebuttal_evidence = (e.rebuttal_evidence ?? []).map(mapElement)[0] ?? { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };

  // --- Rebuttals ---
  const rebuttalsArray = Array.isArray(e.rebuttals) ? e.rebuttals : e.rebuttal ? [e.rebuttal] : [];
  const rebuttal = rebuttalsArray.map(mapElement)[0] ?? { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };

  const claimsArray = (e.claims ?? []).map(mapElement);
  const counterclaimsArray = (e.counterclaims ?? []).map(mapElement);

  // For your diagram:
  const claimsForDiagram = claimsArray.slice(0, 3); // max 3 claims
  const counterclaimForDiagram = counterclaimsArray[0] ?? { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };

  // Optional: if you want to fill the diagram fully with claims + counterclaim
  while (claimsForDiagram.length < 3) {
    if (counterclaimsArray.length > 0) claimsForDiagram.push(counterclaimsArray.shift()!);
    else claimsForDiagram.push({ text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" });
  }

  return {
    elements: {
      lead: mapElement(e.lead),
      position: mapElement(e.position),
      claims,
      counterclaim,
      counterclaim_evidence,
      rebuttal,
      rebuttal_evidence,
      evidence,
      conclusion: mapElement(e.conclusion),
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const { essay } = await request.json()
    const FT_MODEL = process.env.FT_MODEL ?? "gpt-4.1-mini"

    // STEP 1 → Classify structure
    const completion = await openai.chat.completions.create({
      model: FT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a classifier for argumentative essays. Return only valid JSON with fields: lead, position, claims[], evidence[], counterclaims[], counterclaim_evidence[], rebuttals[], rebuttal_evidence[], and conclusion.",
        },
        {
          role: "user",
          content: essay,
        },
      ],
      response_format: { type: "json_object" },
    })

    const analysis = JSON.parse(completion.choices[0].message?.content ?? "{}")

    // STEP 2 → Normalize
    const normalized = normalizeAnalysis(analysis)

    const feedback = await generateObject({
      model: "gpt-5-mini",   // ✅ correct: pass a string, not the client
      system: `You are an expert essay coach giving structured, detailed, and insightful feedback on argumentative essays.
        For each element in the analysis:
        - If "Effective": give 2-3 sentences explaining why it is effective. Leave suggestions and reason empty.
        - If "Adequate", "Ineffective", or "Missing":
            • Feedback: 3-5 sentences of reflective guidance.
            • Suggestions: a suggested sentences to replace the user's current one.
            • Reason: 2-4 sentences explaining why suggestions strengthen clarity or argumentation.
        Output must strictly follow ArgumentElementSchema (text, effectiveness, feedback, suggestions, reason).
      `,
      prompt: `Here is the normalized analysis:\n\n${JSON.stringify(normalized, null, 2)}`,
      schema: FeedbackResultSchema,
    })
    

    return NextResponse.json(feedback.object)
  } catch (error) {
    console.error("Error analyzing argumentative structure:", error)
    return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
  }
}


// export async function POST(request: NextRequest) {
//   try {
//     const { essay } = await request.json()

//     if (!essay || essay.trim().length === 0) {
//       return NextResponse.json({ error: "Essay content is required" }, { status: 400 })
//     }

//     // const rubricPrompt = `
//     // You are an expert writing instructor analyzing argumentative essays using the Crossley argumentative writing rubric.

//     // RUBRIC EFFECTIVENESS LEVELS:
//     // - Effective: Element is strong, clear, and well-developed
//     // - Adequate: Element is present but could be improved
//     // - Ineffective: Element is weak or poorly developed
//     // - Missing: Element is not present in the essay

//     // ARGUMENTATIVE ELEMENTS TO ANALYZE:
//     // 1. Lead: Opening that grabs attention and points toward position
//     // 2. Position: Clear stance on the topic
//     // 3. Claims: Supporting arguments for the position (identify multiple if present)
//     // 4. Counterclaim: Acknowledgment of opposing viewpoint
//     // 5. Counterclaim Evidence: Supporting evidence for the counterclaim
//     // 6. Rebuttal: Response to the counterclaim
//     // 7. Rebuttal Evidence: Supporting evidence for the rebuttal
//     // 8. Evidence: Supporting facts, examples, statistics (identify multiple if present)
//     // 9. Conclusion: Effective summary that restates claims

//     // For each element:
//     // - Extract the specific text from the essay
//     // - Rate effectiveness using the rubric

//     // `

//     // STEP 1 → Call fine-tuned model to identify essay elements
//     const analysis = await generateObject({
//       model: openai("FT_MODEL"), // your fine-tuned GPT model
//       system: `
//       You are a classifier for argumentative essays. 
//       Identify the argumentative elements and rate their effectiveness according to the rubric:
//       - Effective
//       - Adequate
//       - Ineffective
//       - Missing
      
//       Return your analysis in the format of AnalysisResultSchema.
//       `,
//       prompt: `Essay:\n\n${essay}`,
//       schema: AnalysisResultSchema,
//     })

//     // STEP 2 → Call GPT-5-mini to give feedback based on analysis
//     const feedback = await generateObject({
//       model: openai("gpt-5-mini"),
//       system: `
//       You are an expert essay coach giving structured feedback. 
//       For each element in the analysis:
//       - If "Effective": as feedback, Explain (2-3 sentences) CLEARLY *why* the identified text is effective. Do not give suggestions. do not give reason
//       - If "Adequate" | "Ineffective" | "Missing": 
//         • Feedback: Provide HELPFUL reflective guidance to help the student improve, but without directly rewriting their work (2-3 sentences).  
//         • Suggestions: Provide a suggested replacement or addition.  
//         • Reason: Explain CLEARLY why your suggestion is stronger than the original (2-3 sentences).  
//       Always follow ArgumentElementSchema.
//       `,
//       prompt: `Here is the analysis of the essay in AnalysisResultSchema format:\n\n${JSON.stringify(
//         analysis.object,
//         null,
//         2
//       )}`,
//       schema: ArgumentElementSchema,
//     })


//     return NextResponse.json(feedback.object)
//   } catch (error) {
//     console.error("Error analyzing argumentative structure:", error)
//     return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
//   }
// }
