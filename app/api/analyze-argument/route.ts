import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"

const ArgumentElementSchema = z.object({
  text: z.string().default(""),
  effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
  diagnosis: z.string().default(""),
  feedback: z.array(z.string()).default([]),
  suggestion: z.string().default(""),
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

function normalizeFeedback(data: any): any {
  function walk(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(walk)
    }
    if (obj && typeof obj === "object") {
      const out: any = {}
      for (const k of Object.keys(obj)) {
        if (k === "feedback") {
          out[k] = Array.isArray(obj[k])
            ? obj[k]
            : obj[k]
            ? [obj[k]]
            : []
        } else {
          out[k] = walk(obj[k])
        }
      }
      return out
    }
    return obj
  }

  return walk(data)
}

// ensure every element has feedback/suggestions/reason fields
// Updated enrichElements function
function enrichElements(raw: any): any {
  function enrich(el: any) {
    if (!el) {
      return { 
        text: "", 
        effectiveness: "Missing", 
        diagnosis: "", 
        feedback: [], 
        suggestion: "", 
        reason: "" 
      }
    }

    let text = ""
    if (typeof el === "string") {
      text = el
    } else {
      text = el.text ?? el.sentence ?? ""
    }

    return {
      text,
      effectiveness: el.effectiveness ?? "Missing",
      diagnosis: "",
      feedback: [],
      suggestion: "",
      reason: "",
    }
  }

  const data = raw.elements ?? raw
  const getFirstOrEmpty = (item: any) => {
    if (Array.isArray(item)) return item.length > 0 ? item[0] : null
    return item || null
  }

  // --- helper for padding arrays ---
  function padArray(arr: any[], targetLength: number) {
    const result = [...arr]
    while (result.length < targetLength) {
      result.push(enrich(null)) // push Missing element
    }
    return result
  }

  return {
    elements: {
      lead: enrich(data.lead),
      position: enrich(data.position),
      // ✅ enforce 2 claims
      claims: padArray(Array.isArray(data.claims) ? data.claims.map(enrich) : [], 2),
      counterclaim: enrich(getFirstOrEmpty(data.counterclaims)),
      counterclaim_evidence: enrich(getFirstOrEmpty(data.counterclaim_evidence)),
      rebuttal: enrich(getFirstOrEmpty(data.rebuttals)),
      rebuttal_evidence: enrich(getFirstOrEmpty(data.rebuttal_evidence)),
      // ✅ enforce 3 evidence
      evidence: padArray(Array.isArray(data.evidence) ? data.evidence.map(enrich) : [], 3),
      conclusion: enrich(data.conclusion),
    },
  }
}

// Helper function to collect all elements into a flat array with metadata
function collectElements(enriched: any): Array<{element: any, path: string, name: string, index?: number}> {
  const elements: Array<{element: any, path: string, name: string, index?: number}> = []
  
  // Single elements
  const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
  for (const name of singleElements) {
    elements.push({
      element: enriched.elements[name],
      path: `elements.${name}`,
      name
    })
  }
  
  // Array elements
  enriched.elements.claims.forEach((claim: any, index: number) => {
    elements.push({
      element: claim,
      path: `elements.claims[${index}]`,
      name: 'claim',
      index
    })
  })
  
  enriched.elements.evidence.forEach((evidence: any, index: number) => {
    elements.push({
      element: evidence,
      path: `elements.evidence[${index}]`,
      name: 'evidence',
      index
    })
  })
  
  return elements
}

// Helper function to reconstruct the structure from flat array
function reconstructStructure(enriched: any, processedElements: any[]): any {
  const result = JSON.parse(JSON.stringify(enriched)) // Deep clone
  
  let elementIndex = 0
  
  // Single elements
  const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
  for (const name of singleElements) {
    result.elements[name] = processedElements[elementIndex++]
  }
  
  // Array elements
  for (let i = 0; i < result.elements.claims.length; i++) {
    result.elements.claims[i] = processedElements[elementIndex++]
  }
  
  for (let i = 0; i < result.elements.evidence.length; i++) {
    result.elements.evidence[i] = processedElements[elementIndex++]
  }
  
  return result
}

// 4-Step GPT Chain Functions
async function generateDiagnosis(element: any, elementName: string, prompt: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: 
        `You are an expert writing coach analyzing argumentative essay elements.

        The essay prompt is: """${prompt}"""

        Provide a diagnosis for the ${elementName} element:
        1. Explains the role of this element in argumentative writing
        2. Evaluates how well it serves the essay prompt

        Be specific and direct. Do not provide suggestions or feedback yet.`
      },
      {
        role: "user", 
        content: `Element: ${elementName}
Text: "${element.text}"
Effectiveness: ${element.effectiveness}

Provide diagnosis:`
      }
    ]
  })
  
  return completion.choices[0].message.content?.trim() || ""
}

async function generateFeedback(element: any, elementName: string, diagnosis: string): Promise<string[]> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: 
        `You are an expert writing coach providing constructive feedback.

Based on the diagnosis, provide 3-4 bullet points of Indirect feedback for this ${elementName}.

Rules:
If effectiveness is "Effective":
- give positive reinforcement.
- Focus on explaining why the element is strong (clarity, persuasiveness, alignment).
- include suggestions to improve the effective element.

If effectiveness is "Adequate", "Ineffective", or "Missing": Provide guidance for improvement
- Use <strong>...</strong> tags to highlight important concepts
- Be encouraging but specific
- Focus on actionable insights

Give reflective prompts that guide the student to revise, 
but do not supply the exact rewritten sentence or replacement words.

Example:
Your <strong>claim is clear</strong>, but instead of <strong>repeating it</strong> in every paragraph, state it once strongly in the introduction and let each body paragraph focus on <strong>one reason</strong> (effectiveness, effort, responsibility).
<strong>Balance personal anecdotes</strong> with <strong>broader reasoning</strong> so the essay sounds more persuasive and less like a diary.
<strong>Cut down redundancy</strong>—phrases like “to make sure students are effective during the summer break” can be <strong>shortened or rephrased</strong>.
Add <strong>smoother transitions</strong> so each paragraph <strong>flows logically</strong> into the next.

Return JSON format: {"feedback": ["point 1", "point 2", "point 3", "point 4"]}`
      },
      {
        role: "user",
        content: `Element: ${elementName}
Text: "${element.text}"
Effectiveness: ${element.effectiveness}
Diagnosis: ${diagnosis}

Provide feedback:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"feedback": []}')
  return result.feedback || []
}

async function generateSuggestion(element: any, elementName: string): Promise<string> {
  // Only generate suggestions for non-effective elements
  if (element.effectiveness === "Effective") {
    return ""
  }
  
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach providing improved versions of essay elements.

For this ${elementName}:
- If "Adequate": rewrite it into a stronger, more precise version while keeping the core meaning, Keep the core idea but make it more compelling, Use stronger academic language, Make it more specific and precise.
- If "Ineffective": create a clear, specific, academic example that fulfills the role, Keep the core idea but make it more compelling, Use stronger academic language, Make it more specific and precise.
- If "Missing": create an appropriate example, Keep the core idea but make it more compelling, Use stronger academic language, Make it more specific and precise.
Always return ONE improved sentence only, no extra text.`
      },
      {
        role: "user",
        content: `Element: ${elementName}
Original text: "${element.text}"
Effectiveness: ${element.effectiveness}

Provide improved version:`
      }
    ]
  })
  
  return completion.choices[0].message.content?.trim() || ""
}

async function generateReason(element: any, elementName: string, suggestion: string): Promise<string> {
  // Only generate reasons for non-effective elements
  if (element.effectiveness === "Effective" || !suggestion) {
    return ""
  }
  
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach explaining improvements.

Explain in 2-4 sentences why the suggested improvement is stronger than the original.
Focus on clarity, persuasiveness, and argumentative effectiveness.`
      },
      {
        role: "user",
        content: `Element: ${elementName}
Original: "${element.text}"
Suggestion: "${suggestion}"
Effectiveness: ${element.effectiveness}

Explain why the suggestion is better:`
      }
    ]
  })
  
  return completion.choices[0].message.content?.trim() || ""
}

// Batch processing function to handle multiple elements efficiently
async function process4StepChain(elements: Array<{element: any, path: string, name: string, index?: number}>, prompt: string): Promise<any[]> {
  const results = []
  
  // Process in batches of 5 to avoid rate limits
  const BATCH_SIZE = 5
  for (let i = 0; i < elements.length; i += BATCH_SIZE) {
    const batch = elements.slice(i, i + BATCH_SIZE)
    
    // Step 1: Generate all diagnoses for this batch
    const diagnoses = await Promise.all(
      batch.map(({element, name}) => generateDiagnosis(element, name, prompt))
    )
    
    // Step 2: Generate all feedback for this batch
    const feedbacks = await Promise.all(
      batch.map(({element, name}, index) => 
        generateFeedback(element, name, diagnoses[index])
      )
    )
    
    // Step 3: Generate all suggestions for this batch
    const suggestions = await Promise.all(
      batch.map(({element, name}) => generateSuggestion(element, name))
    )
    
    // Step 4: Generate all reasons for this batch
    const reasons = await Promise.all(
      batch.map(({element, name}, index) => 
        generateReason(element, name, suggestions[index])
      )
    )
    
    // Combine results for this batch
    for (let j = 0; j < batch.length; j++) {
      results.push({
        ...batch[j].element,
        diagnosis: diagnoses[j],
        feedback: feedbacks[j],
        suggestion: suggestions[j],
        reason: reasons[j]
      })
    }
  }
  
  return results
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
    const { essay, prompt } = await request.json() // 👈 also grab prompt
    const FT_MODEL = process.env.FT_MODEL

    let completion
    let modelUsed = FT_MODEL ?? "gpt-5-mini"

    try {
      console.log("⚡ Using model:", modelUsed)

      // STEP 1 → Fine-tuned model gives structure + effectiveness
      completion = await openai.chat.completions.create({
        model: modelUsed,
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
      modelUsed = "gpt-5-mini"
      console.log("⚡ Using model:", modelUsed)

      completion = await openai.chat.completions.create({
        model: modelUsed,
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
    
    // STEP 2 → Enrich with empty fields
    const enriched = enrichElements(analysis)

    // STEP 3 → 4-Step GPT Chain Processing
    console.log("🔄 Starting 4-step GPT chain processing...")
    
    // Collect all elements
    const allElements = collectElements(enriched)
    
    // Process through 4-step chain
    const processedElements = await process4StepChain(allElements, prompt || "")
    
    // Reconstruct the structure
    const finalFeedback = reconstructStructure(enriched, processedElements)

    // STEP 4 → Lock element-level effectiveness (preserve from FT model)
    const lockedFeedback = lockEffectiveness(enriched, finalFeedback)

    // STEP 5 → Normalize feedback field into array form
    const normalized = normalizeFeedback(lockedFeedback)

    // STEP 6 → Validate with Zod
    const parsed = FeedbackResultSchema.safeParse(normalized)
    if (!parsed.success) {
      console.error("❌ Zod validation failed", parsed.error.format())
      return NextResponse.json(
        { error: "Schema validation failed", issues: parsed.error.format() },
        { status: 400 },
      )
    }

    // STEP 7 → Return normalized version
    return NextResponse.json(normalized)
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
//   feedback: z.union([z.string(), z.array(z.string())]).default(""),
//   suggestions: z.string().default(""),
//   reason: z.string().default(""),
// })

// const AnalysisResultSchema = z.object({
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

// const FeedbackResultSchema = AnalysisResultSchema

// function normalizeFeedback(data: any): any {
//   function walk(obj: any): any {
//     if (Array.isArray(obj)) {
//       return obj.map(walk)
//     }
//     if (obj && typeof obj === "object") {
//       const out: any = {}
//       for (const k of Object.keys(obj)) {
//         if (k === "feedback") {
//           out[k] = Array.isArray(obj[k])
//             ? obj[k]
//             : obj[k]
//             ? [obj[k]]
//             : []
//         } else {
//           out[k] = walk(obj[k])
//         }
//       }
//       return out
//     }
//     return obj
//   }

//   return walk(data)
// }

// // ensure every element has feedback/suggestions/reason fields
// // Updated enrichElements function
// function enrichElements(raw: any): any {
//   function enrich(el: any) {
//     if (!el) {
//       return { text: "", effectiveness: "Missing", feedback: [], suggestions: "", reason: "" }
//     }

//     let text = ""
//     if (typeof el === "string") {
//       text = el
//     } else {
//       text = el.text ?? el.sentence ?? ""
//     }

//     return {
//       text,
//       effectiveness: el.effectiveness ?? "Missing",
//       feedback: Array.isArray(el.feedback) ? el.feedback : (el.feedback ? [el.feedback] : []),
//       suggestions: el.suggestions ?? "",
//       reason: el.reason ?? "",
//     }
//   }

//   const data = raw.elements ?? raw
//   const getFirstOrEmpty = (item: any) => {
//     if (Array.isArray(item)) return item.length > 0 ? item[0] : null
//     return item || null
//   }

//   // --- helper for padding arrays ---
//   function padArray(arr: any[], targetLength: number) {
//     const result = [...arr]
//     while (result.length < targetLength) {
//       result.push(enrich(null)) // push Missing element
//     }
//     return result
//   }

//   return {
//     elements: {
//       lead: enrich(data.lead),
//       position: enrich(data.position),
//       // ✅ enforce 2 claims
//       claims: padArray(Array.isArray(data.claims) ? data.claims.map(enrich) : [], 2),
//       counterclaim: enrich(getFirstOrEmpty(data.counterclaims)),
//       counterclaim_evidence: enrich(getFirstOrEmpty(data.counterclaim_evidence)),
//       rebuttal: enrich(getFirstOrEmpty(data.rebuttals)),
//       rebuttal_evidence: enrich(getFirstOrEmpty(data.rebuttal_evidence)),
//       // ✅ enforce 3 evidence
//       evidence: padArray(Array.isArray(data.evidence) ? data.evidence.map(enrich) : [], 3),
//       conclusion: enrich(data.conclusion),
//     },
//   }
// }


// // Updated system prompt for the fine-tuned model
// const FINE_TUNED_SYSTEM_PROMPT = `You are an argument-mining classifier for argumentative essays. 

// Return JSON with this EXACT structure:
// {
//   "lead": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"},
//   "position": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"},
//   "claims": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "counterclaims": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "counterclaim_evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "rebuttals": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "rebuttal_evidence": [{"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}],
//   "conclusion": {"text": "...", "effectiveness": "Effective|Adequate|Ineffective|Missing"}
// }

// CRITICAL: Each element must have both "text" and "effectiveness" fields. Do not include a top-level "effectiveness" field.`;

// // Updated POST function
// export async function POST(request: NextRequest) {
//   try {
//     const { essay, prompt } = await request.json() // 👈 also grab prompt
//     const FT_MODEL = process.env.FT_MODEL

//     let completion
//     try {
//       // STEP 1 → Fine-tuned model gives structure + effectiveness
//       completion = await openai.chat.completions.create({
//         model: FT_MODEL ?? "gpt-5-mini",
//         messages: [
//           {
//             role: "system",
//             content: FINE_TUNED_SYSTEM_PROMPT,
//           },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     } catch (err: any) {
//       console.warn("⚠️ FT model unavailable, falling back to gpt-4o:", err.message)
//       completion = await openai.chat.completions.create({
//         model: "gpt-5-mini",
//         messages: [
//           {
//             role: "system",
//             content: FINE_TUNED_SYSTEM_PROMPT,
//           },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     }

//     const rawContent = completion.choices[0].message.content
//     const analysis = JSON.parse(rawContent ?? "{}")

//     console.log("🔍 Raw FT analysis:", JSON.stringify(analysis, null, 2))

//     // Check if we got the old format and need to assign default effectiveness
//     if ('effectiveness' in analysis && typeof analysis.effectiveness === 'string') {
//       console.warn("⚠️ Model returned old format with top-level effectiveness. Assigning 'Adequate' to all elements.");
      
//       // Convert old format to new format with default effectiveness
//       const convertElement = (text: any) => {
//         if (typeof text === 'string') {
//           return { text, effectiveness: text ? 'Adequate' : 'Missing' };
//         }
//         return text;
//       };

//       analysis.lead = convertElement(analysis.lead);
//       analysis.position = convertElement(analysis.position);
//       analysis.claims = (analysis.claims || []).map(convertElement);
//       analysis.evidence = (analysis.evidence || []).map(convertElement);
//       analysis.counterclaims = (analysis.counterclaims || []).map(convertElement);
//       analysis.counterclaim_evidence = (analysis.counterclaim_evidence || []).map(convertElement);
//       analysis.rebuttals = (analysis.rebuttals || []).map(convertElement);
//       analysis.rebuttal_evidence = (analysis.rebuttal_evidence || []).map(convertElement);
//       analysis.conclusion = convertElement(analysis.conclusion);
      
//       // Remove the top-level effectiveness
//       delete analysis.effectiveness;
//     }

//     function lockEffectiveness(
//       original: Record<string, any>,
//       updated: Record<string, any>
//     ): Record<string, any> {
//       const lock = (o: Record<string, any>, u: Record<string, any>) => {
//         if (!o || !u) return u;
//         u.effectiveness = o.effectiveness;
//         for (const key of Object.keys(o)) {
//           if (Array.isArray(o[key]) && Array.isArray(u[key])) {
//             for (let i = 0; i < o[key].length; i++) lock(o[key][i], u[key][i]);
//           } else if (
//             typeof o[key] === "object" &&
//             o[key] !== null &&
//             typeof u[key] === "object" &&
//             u[key] !== null
//           ) {
//             lock(o[key], u[key]);
//           }
//         }
//       };
//       lock(original, updated);
//       return updated;
//     }
    
//     // STEP 2 → Enrich with empty feedback/suggestions/reason
//     const enriched = enrichElements(analysis)

//     // STEP 3 → Feedback generation
//     const feedbackCompletion = await openai.chat.completions.create({
//       model: "gpt-4o",
//       response_format: { type: "json_object" },
//       messages: [
//         {
//           role: "system",
//           content: `You are an expert essay coach giving structured, detailed, and insightful feedback on argumentative essays.

//             You will receive JSON where each element already has two fields: "text" and "effectiveness".
//             Do not change or remove these fields. Keep their values exactly as provided.
            
//             The essay is based on this prompt:  """${prompt}""" 

//             When giving feedback, always consider how the element’s content contributes to answering the essay prompt.  
//             For each element:
//             - If "effectiveness" is "Effective":
//             • Add a "feedback" field as a list of 3–4 bullet points.
//             • Each bullet point should clearly explain *why* it is effective.
//             • Use bold formatting to highlight important words/phrases to improve readability. Use <strong>...</strong> tags instead of Markdown for bolding key phrases.
//             • Leave "suggestions" and "reason" as empty strings.
//             - If "effectiveness" is "Adequate", "Ineffective", or "Missing":
//             • Add a "feedback" field as a list of 3–4 bullet points of reflective guidance, encouraging the student to revise. INCLUDE encouragement messages. 
//             • Use bold formatting to highlight important words/phrases to improve readability. Use <strong>...</strong> tags instead of Markdown for bolding key phrases.
//             • Add a "suggestions" field with one improved sentence.
//             • Add a "reason" field with 2–4 sentences explaining why the suggestion improves clarity or argumentation.
        
//         For each element: 
//         - The "feedback" field must be an array of strings (["...", "..."]). Never a single string.
//         - The "suggestions" field must be a single string.
//         - The "reason" field must be a single string.

//         Return the same structure back, strictly matching ArgumentElementSchema.`
//         },
//         {
//           role: "user",
//           content: JSON.stringify(enriched),
//         },
//       ],
//     })

//     const feedbackJSON = JSON.parse(feedbackCompletion.choices[0].message?.content ?? "{}")

//     // STEP 4 → Lock element-level effectiveness
//     const finalFeedback = lockEffectiveness(enriched, feedbackJSON)

//     // STEP 5 → Normalize feedback field into array form
//     const normalized = normalizeFeedback(finalFeedback)

//     // STEP 6 → Validate with Zod
//     const parsed = FeedbackResultSchema.safeParse(normalized)
//     if (!parsed.success) {
//       console.error("❌ Zod validation failed", parsed.error.format())
//       return NextResponse.json(
//         { error: "Schema validation failed", issues: parsed.error.format() },
//         { status: 400 },
//       )
//     }

//     // STEP 7 → Return normalized version
//     return NextResponse.json(normalized)
//   } catch (error) {
//     console.error("Error analyzing argumentative structure:", error)
//     return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
//   }
// }
