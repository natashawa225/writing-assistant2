import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"

const ArgumentElementSchema = z.object({
  text: z.string().default(""),
  effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
  feedback: z.string().default(""),
  suggestions: z.string().default(""),
  reason: z.string().default(""),
})

const AnalysisResultSchema = z.object({
  elements: z.object({
    lead: ArgumentElementSchema,
    position: ArgumentElementSchema,
    claims: z.array(ArgumentElementSchema).default([]),
    counterclaim: ArgumentElementSchema,
    counterclaim_evidence: ArgumentElementSchema,
    rebuttal: ArgumentElementSchema,
    rebuttal_evidence: ArgumentElementSchema,
    evidence: z.array(ArgumentElementSchema).default([]),
    conclusion: ArgumentElementSchema,
  }),
})

const FeedbackResultSchema = AnalysisResultSchema

// ensure every element has feedback/suggestions/reason fields
// Updated enrichElements function to handle missing individual effectiveness ratings
function enrichElements(raw: any): any {
  function enrich(el: any) {
    if (!el) {
      return { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" }
    }
    
    // Handle both string content and object with sentence/text
    let text = "";
    if (typeof el === "string") {
      text = el;
    } else {
      text = el.text ?? el.sentence ?? "";
    }
    
    return {
      text: text,
      effectiveness: el.effectiveness ?? "Missing", // Will be "Missing" for strings
      feedback: el.feedback ?? "",
      suggestions: el.suggestions ?? "",
      reason: el.reason ?? "",
    }
  }

  // Handle both nested and flat structures
  const data = raw.elements ?? raw;
  
  // Helper function to get first item from array or return the item itself
  const getFirstOrEmpty = (item: any) => {
    if (Array.isArray(item)) {
      return item.length > 0 ? item[0] : null;
    }
    return item || null;
  };

  return {
    elements: {
      lead: enrich(data.lead),
      position: enrich(data.position),
      claims: Array.isArray(data.claims) ? data.claims.map(enrich) : [],
      counterclaim: enrich(getFirstOrEmpty(data.counterclaims)),
      counterclaim_evidence: enrich(getFirstOrEmpty(data.counterclaim_evidence)),
      rebuttal: enrich(getFirstOrEmpty(data.rebuttals)),
      rebuttal_evidence: enrich(getFirstOrEmpty(data.rebuttal_evidence)),
      evidence: Array.isArray(data.evidence) ? data.evidence.map(enrich) : [],
      conclusion: enrich(data.conclusion),
    },
  }
}

// Updated system prompt for the fine-tuned model
const FINE_TUNED_SYSTEM_PROMPT = `You are an argument-mining classifier for argumentative essays. 

Return JSON with this EXACT structure:
{
  "lead": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"},
  "position": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"},
  "claims": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "counterclaims": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "counterclaim_evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "rebuttals": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "rebuttal_evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
  "conclusion": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}
}

CRITICAL: Each element must have both "text" and "effectiveness" fields. Do not include a top-level "effectiveness" field.`;

// Updated POST function
export async function POST(request: NextRequest) {
  try {
    const { essay } = await request.json()
    const FT_MODEL = process.env.FT_MODEL

    let completion
    try {
      // STEP 1 → Fine-tuned model gives structure + effectiveness
      completion = await openai.chat.completions.create({
        model: FT_MODEL ?? "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: FINE_TUNED_SYSTEM_PROMPT,
          },
          { role: "user", content: essay },
        ],
        response_format: { type: "json_object" },
      })
    } catch (err: any) {
      console.warn("⚠️ FT model unavailable, falling back to gpt-5-mini:", err.message)
      completion = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: FINE_TUNED_SYSTEM_PROMPT,
          },
          { role: "user", content: essay },
        ],
        response_format: { type: "json_object" },
      })
    }

    const rawContent = completion.choices[0].message.content
    const analysis = JSON.parse(rawContent ?? "{}")

    console.log("🔍 Raw FT analysis:", JSON.stringify(analysis, null, 2))

    // Check if we got the old format and need to assign default effectiveness
    if ('effectiveness' in analysis && typeof analysis.effectiveness === 'string') {
      console.warn("⚠️ Model returned old format with top-level effectiveness. Assigning 'Adequate' to all elements.");
      
      // Convert old format to new format with default effectiveness
      const convertElement = (text: any) => {
        if (typeof text === 'string') {
          return { text, effectiveness: text ? 'Adequate' : 'Missing' };
        }
        return text;
      };

      analysis.lead = convertElement(analysis.lead);
      analysis.position = convertElement(analysis.position);
      analysis.claims = (analysis.claims || []).map(convertElement);
      analysis.evidence = (analysis.evidence || []).map(convertElement);
      analysis.counterclaims = (analysis.counterclaims || []).map(convertElement);
      analysis.counterclaim_evidence = (analysis.counterclaim_evidence || []).map(convertElement);
      analysis.rebuttals = (analysis.rebuttals || []).map(convertElement);
      analysis.rebuttal_evidence = (analysis.rebuttal_evidence || []).map(convertElement);
      analysis.conclusion = convertElement(analysis.conclusion);
      
      // Remove the top-level effectiveness
      delete analysis.effectiveness;
    }

    function lockEffectiveness(
      original: Record<string, any>,
      updated: Record<string, any>
    ): Record<string, any> {
      const lock = (o: Record<string, any>, u: Record<string, any>) => {
        if (!o || !u) return u;
        u.effectiveness = o.effectiveness;
        for (const key of Object.keys(o)) {
          if (Array.isArray(o[key]) && Array.isArray(u[key])) {
            for (let i = 0; i < o[key].length; i++) lock(o[key][i], u[key][i]);
          } else if (
            typeof o[key] === "object" &&
            o[key] !== null &&
            typeof u[key] === "object" &&
            u[key] !== null
          ) {
            lock(o[key], u[key]);
          }
        }
      };
      lock(original, updated);
      return updated;
    }
    
    // STEP 2 → Enrich with empty feedback/suggestions/reason
    const enriched = enrichElements(analysis)

    // STEP 3 → Feedback generation (rest of your code remains the same)
    const feedbackCompletion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert essay coach giving structured, detailed, and insightful feedback on argumentative essays.

            You will receive JSON where each element already has two fields: "text" and "effectiveness".
            Do not change or remove these fields. Keep their values exactly as provided.

            For each element:
            - If "effectiveness" is "Effective":
                • Add a "feedback" field with 2–3 sentences explaining why it is effective.
                • Leave "suggestions" and "reason" as empty strings.
            - If "effectiveness" is "Adequate", "Ineffective", or "Missing":
                • Add a "feedback" field with 3–5 sentences of reflective guidance, encouraging the student to start revising.
                • Include a sentence like "Once you finish revising, you can click the button to regenerate visual feedback to see if your revision works."
                • Add a "suggestions" field with one improved sentence.
                • Add a "reason" field with 2–4 sentences explaining why the suggestion improves clarity or argumentation.

            Return the same structure back, strictly matching ArgumentElementSchema.`
        },
        {
          role: "user",
          content: JSON.stringify(enriched),
        },
      ],
    })

    const feedbackJSON = JSON.parse(feedbackCompletion.choices[0].message?.content ?? "{}")

    // STEP 4 → Lock element-level effectiveness
    const finalFeedback = lockEffectiveness(enriched, feedbackJSON)

    const parsed = FeedbackResultSchema.safeParse(finalFeedback)
    if (!parsed.success) {
      console.error("❌ Zod validation failed", parsed.error.format())
      return NextResponse.json(
        { error: "Schema validation failed", issues: parsed.error.format() },
        { status: 400 },
      )
    }

    return NextResponse.json(finalFeedback)
  } catch (error) {
    console.error("Error analyzing argumentative structure:", error)
    return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
  }
}

// import { type NextRequest, NextResponse } from "next/server"
// import { z } from "zod"
// import { openai } from "@/lib/openai"

// const ArgumentElementSchema = z.object({
//   text: z.string().default(""),
//   effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
//   feedback: z.string().default(""),
//   suggestions: z.string().default(""),
//   reason: z.string().default(""),
// })

// const AnalysisResultSchema = z.object({
//   effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
//   elements: z.object({
//     lead: ArgumentElementSchema,
//     position: ArgumentElementSchema,
//     claims: z.array(ArgumentElementSchema).default([]),
//     counterclaim: ArgumentElementSchema,
//     counterclaim_evidence: ArgumentElementSchema,
//     rebuttal: ArgumentElementSchema,
//     rebuttal_evidence: ArgumentElementSchema,
//     evidence: z.array(ArgumentElementSchema).default([]),
//     conclusion: ArgumentElementSchema,
//   }),
// })

// // schema for feedback on the full set of elements
// const FeedbackResultSchema = AnalysisResultSchema

// // helper: map any FT element → ArgumentElementSchema
// function mapElement(element: any) {
//   if (!element) {
//     return { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" }
//   }

//   if (typeof element === "string") {
//     return { text: element, effectiveness: "Adequate", feedback: "", suggestions: "", reason: "" }
//   }

//   return {
//     text: element.text ?? element.sentence ?? (typeof element === "string" ? element : ""),
//     effectiveness: element.effectiveness ?? "Missing",
//     feedback: "",
//     suggestions: "",
//     reason: "",
//   }
// }

// // helper: normalize arrays from FT model → match fixed schema
// function normalizeAnalysis(raw: any) {
//   const overallEffectiveness = raw.effectiveness ?? "Missing"
//   const e = raw.elements ?? raw ?? {}

//   // --- Claims ---
//   const allClaims = [...(e.claims ?? []), ...(e.counterclaims ?? [])]
//   const claims = allClaims.map(mapElement)
//   const counterclaim =
//     (e.counterclaims ?? [])[0]
//       ? mapElement((e.counterclaims ?? [])[0])
//       : { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" }

//   // --- Evidence ---
//   const evidence = (e.evidence ?? []).map(mapElement)
//   const counterclaim_evidence = (e.counterclaim_evidence ?? [])[0]
//     ? mapElement(e.counterclaim_evidence[0])
//     : { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" }
//   const rebuttal_evidence = (e.rebuttal_evidence ?? [])[0]
//     ? mapElement(e.rebuttal_evidence[0])
//     : { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" }

//   // --- Rebuttals ---
//   const rebuttalsArray = Array.isArray(e.rebuttals) ? e.rebuttals : e.rebuttal ? [e.rebuttal] : []
//   const rebuttal = rebuttalsArray[0]
//     ? mapElement(rebuttalsArray[0])
//     : { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" }

//   return {
//     effectiveness: overallEffectiveness,
//     elements: {
//       lead: mapElement(e.lead),
//       position: mapElement(e.position),
//       claims,
//       counterclaim,
//       counterclaim_evidence,
//       rebuttal,
//       rebuttal_evidence,
//       evidence,
//       conclusion: mapElement(e.conclusion),
//     },
//   }
// }

// export async function POST(request: NextRequest) {
//   try {
//     const { essay } = await request.json()
//     const FT_MODEL = process.env.FT_MODEL

//     let completion
//     try {
//       // STEP 1 → Try fine-tuned model
//       completion = await openai.chat.completions.create({
//         model: FT_MODEL ?? "gpt-5-mini",
//         messages: [
//           {
//             role: "system",
//             content:
//               "You are a classifier for argumentative essays. Return only valid JSON with fields: effectiveness, lead, position, claims[], evidence[], counterclaims[], counterclaim_evidence[], rebuttals[], rebuttal_evidence[], and conclusion.",
//           },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     } catch (err: any) {
//       console.warn("⚠️ FT model unavailable, falling back to gpt-4.1-mini:", err.message)
//       completion = await openai.chat.completions.create({
//         model: "gpt-4.1-mini",
//         messages: [
//           {
//             role: "system",
//             content:
//               "You are a classifier for argumentative essays. Return only valid JSON with fields: effectiveness, lead, position, claims[], evidence[], counterclaims[], counterclaim_evidence[], rebuttals[], rebuttal_evidence[], and conclusion.",
//           },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     }

//     const rawContent = completion.choices[0].message.content
//     const analysis = JSON.parse(rawContent ?? "{}")

//     console.log("🔍 Raw analysis:", JSON.stringify(analysis, null, 2))

//     // STEP 2 → Normalize
//     const normalized = normalizeAnalysis(analysis)

//     // STEP 3 → Feedback
//     const feedbackCompletion = await openai.chat.completions.create({
//       model: "gpt-5-mini",
//       response_format: { type: "json_object" },
//       messages: [
//         {
//           role: "system",
//           content: `You are an expert essay coach giving structured, detailed, and insightful feedback on argumentative essays.
    
//           You will receive JSON where each element already has two fields: "text" and "effectiveness".
//           Do not change or remove these fields. Keep their values exactly as provided.
    
//           For each element:
//           - If "effectiveness" is "Effective":
//               • Add a "feedback" field with 2–3 sentences explaining why it is effective.
//               • Leave "suggestions" and "reason" as empty strings.
//           - If "effectiveness" is "Adequate", "Ineffective", or "Missing":
//               • Add a "feedback" field with 3–5 sentences of reflective guidance.
//               • Add a "suggestions" field: one suggested improved sentence.
//               • Add a "reason" field: 2–4 sentences explaining why the suggestion improves clarity or argumentation.
    
//           Return the same structure back, strictly matching ArgumentElementSchema.
    
//           Also provide a top-level "effectiveness" (same scale: Effective, Adequate, Ineffective, Missing) with overall reasoning based on the essay.`,
//         },
//         {
//           role: "user",
//           content: JSON.stringify(normalized),
//         },
//       ],
//     })

//     const feedback = JSON.parse(feedbackCompletion.choices[0].message?.content ?? "{}")

//     const parsed = FeedbackResultSchema.safeParse(feedback)

//     if (!parsed.success) {
//       console.error("❌ Zod validation failed", parsed.error.format())
//       return NextResponse.json({ error: "Schema validation failed", issues: parsed.error.format() }, { status: 400 })
//     }

//     return NextResponse.json(parsed.data)
//   } catch (error) {
//     console.error("Error analyzing argumentative structure:", error)
//     return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
//   }
// }





// import { type NextRequest, NextResponse } from "next/server"
// import { z } from "zod"
// import { openai } from "@/lib/openai"

// const ArgumentElementSchema = z.object({
//   text: z.string().default(""),
//   effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
//   feedback: z.string().default(""),
//   suggestions: z.string().default(""),
//   reason: z.string().default(""),
// })

// const AnalysisResultSchema = z.object({
//   effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
//   elements: z.object({
//     lead: ArgumentElementSchema,
//     position: ArgumentElementSchema,
//     claims: z.array(ArgumentElementSchema).default([]),
//     counterclaim: ArgumentElementSchema,
//     counterclaim_evidence: ArgumentElementSchema,
//     rebuttal: ArgumentElementSchema,
//     rebuttal_evidence: ArgumentElementSchema,
//     evidence: z.array(ArgumentElementSchema).default([]),
//     conclusion: ArgumentElementSchema,
//   }),
// })

// // schema for feedback on the full set of elements
// const FeedbackResultSchema = AnalysisResultSchema

// // helper: map any FT element → ArgumentElementSchema
// function mapElement(element: any) {
//   if (!element) {
//     return { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" }
//   }

//   // If FT gave just a string, keep it as text but don't drop effectiveness if model tagged it
//   if (typeof element === "string") {
//     return { text: element, effectiveness: "Adequate", feedback: "", suggestions: "", reason: "" }
//     // 👆 default to "Adequate" or whatever you prefer instead of forcing "Missing"
//   }

//   return {
//     text: element.text ?? element.sentence ?? (typeof element === "string" ? element : ""),
//     effectiveness: element.effectiveness ?? "Missing",
//     feedback: "",
//     suggestions: "",
//     reason: "",
//   }
// }


// // helper: normalize arrays from FT model → match fixed schema
// function normalizeAnalysis(raw: any) {
//   const e = raw.elements ?? raw ?? {} // ✅ don’t assume nested .elements

//   // --- Claims ---
//   const allClaims = [...(e.claims ?? []), ...(e.counterclaims ?? [])];
//   const claims = allClaims.map(mapElement);
//   const counterclaim =
//     (e.counterclaims ?? [])[0] 
//       ? mapElement((e.counterclaims ?? [])[0]) 
//       : { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };

//   // --- Evidence ---
//   const evidence = (e.evidence ?? []).map(mapElement);
//   const counterclaim_evidence = (e.counterclaim_evidence ?? [])[0]
//     ? mapElement(e.counterclaim_evidence[0])
//     : { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };
//   const rebuttal_evidence = (e.rebuttal_evidence ?? [])[0]
//     ? mapElement(e.rebuttal_evidence[0])
//     : { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };

//   // --- Rebuttals ---
//   const rebuttalsArray = Array.isArray(e.rebuttals) ? e.rebuttals : e.rebuttal ? [e.rebuttal] : [];
//   const rebuttal = rebuttalsArray[0] ? mapElement(rebuttalsArray[0]) : { text: "", effectiveness: "Missing", feedback: "", suggestions: "", reason: "" };

//   return {
//     elements: {
//       lead: mapElement(e.lead),
//       position: mapElement(e.position),
//       claims,
//       counterclaim,
//       counterclaim_evidence,
//       rebuttal,
//       rebuttal_evidence,
//       evidence,
//       conclusion: mapElement(e.conclusion),
//     },
//   };
// }

// export async function POST(request: NextRequest) {
//   try {
//     const { essay } = await request.json()
//     const FT_MODEL = process.env.FT_MODEL

//     let completion
//     try {
//       // STEP 1 → Try fine-tuned model
//       completion = await openai.chat.completions.create({
//         model: FT_MODEL ?? "gpt-5-mini",
//         messages: [
//           {
//             role: "system",
//             content:
//               "You are a classifier for argumentative essays. Return only valid JSON with fields: lead, position, claims[], evidence[], counterclaims[], counterclaim_evidence[], rebuttals[], rebuttal_evidence[], and conclusion.",
//           },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     } catch (err: any) {
//       // If the fine-tuned model doesn’t exist → fallback
//       console.warn("⚠️ FT model unavailable, falling back to gpt-4.1-mini:", err.message)
//       completion = await openai.chat.completions.create({
//         model: "gpt-4.1-mini",
//         messages: [
//           {
//             role: "system",
//             content:
//               "You are a classifier for argumentative essays. Return only valid JSON with fields: lead, position, claims[], evidence[], counterclaims[], counterclaim_evidence[], rebuttals[], rebuttal_evidence[], and conclusion.",
//           },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     }

//     const rawContent = completion.choices[0].message.content
//     const analysis = JSON.parse(rawContent ?? "{}")


//     console.log("🔍 Raw analysis:", JSON.stringify(analysis, null, 2));

//     // STEP 2 → Normalize
//     const normalized = normalizeAnalysis(analysis)

//     // STEP 3 → Feedback
//     const feedbackCompletion = await openai.chat.completions.create({
//       model: "gpt-5-mini",
//       response_format: { type: "json_object" },
//       messages: [
//         {
//           role: "system",
//           content: `You are an expert essay coach giving structured, detailed, and insightful feedback on argumentative essays.
    
//           You will receive JSON where each element already has two fields: "text" and "effectiveness".
//           Do not change or remove these fields. Keep their values exactly as provided.
    
//           For each element:
//           - If "effectiveness" is "Effective":
//               • Add a "feedback" field with 2–3 sentences explaining why it is effective.
//               • Leave "suggestions" and "reason" as empty strings.
//           - If "effectiveness" is "Adequate", "Ineffective", or "Missing":
//               • Add a "feedback" field with 3–5 sentences of reflective guidance.
//               • Add a "suggestions" field: one suggested improved sentence.
//               • Add a "reason" field: 2–4 sentences explaining why the suggestion improves clarity or argumentation.
    
//           Return the same structure back, strictly matching ArgumentElementSchema:
//           { text, effectiveness, feedback, suggestions, reason }`
//         },
//         {
//           role: "user",
//           content: JSON.stringify(normalized) // 👈 your normalized elements
//         }
//       ]
//     })    

    
//     const feedback = JSON.parse(feedbackCompletion.choices[0].message?.content ?? "{}")

//     // Optional schema validation
//     const parsed = FeedbackResultSchema.safeParse(feedback)

//     if (!parsed.success) {
//       console.error("❌ Zod validation failed", parsed.error.format())
//       return NextResponse.json({ error: "Schema validation failed", issues: parsed.error.format() }, { status: 400 })
//     }

//     return NextResponse.json(parsed.data)
//   } catch (error) {
//     console.error("Error analyzing argumentative structure:", error)
//     return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
//   }
// }



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
