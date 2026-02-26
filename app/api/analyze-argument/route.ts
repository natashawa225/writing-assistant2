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

  function padArray(arr: any[], targetLength: number) {
    const result = [...arr]
    while (result.length < targetLength) {
      result.push(enrich(null))
    }
    return result
  }

  return {
    elements: {
      lead: enrich(data.lead),
      position: enrich(data.position),
      claims: padArray(Array.isArray(data.claims) ? data.claims.map(enrich) : [], 2),
      counterclaim: enrich(getFirstOrEmpty(data.counterclaims)),
      counterclaim_evidence: enrich(getFirstOrEmpty(data.counterclaim_evidence)),
      rebuttal: enrich(getFirstOrEmpty(data.rebuttals)),
      rebuttal_evidence: enrich(getFirstOrEmpty(data.rebuttal_evidence)),
      evidence: padArray(Array.isArray(data.evidence) ? data.evidence.map(enrich) : [], 3),
      conclusion: enrich(data.conclusion),
    },
  }
}

function collectElements(enriched: any): Array<{element: any, path: string, name: string, index?: number}> {
  const elements: Array<{element: any, path: string, name: string, index?: number}> = []
  
  const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
  for (const name of singleElements) {
    elements.push({
      element: enriched.elements[name],
      path: `elements.${name}`,
      name
    })
  }
  
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

function reconstructStructure(enriched: any, processedElements: any[]): any {
  const result = JSON.parse(JSON.stringify(enriched))
  
  let elementIndex = 0
  
  const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
  for (const name of singleElements) {
    result.elements[name] = processedElements[elementIndex++]
  }
  
  for (let i = 0; i < result.elements.claims.length; i++) {
    result.elements.claims[i] = processedElements[elementIndex++]
  }
  
  for (let i = 0; i < result.elements.evidence.length; i++) {
    result.elements.evidence[i] = processedElements[elementIndex++]
  }
  
  return result
}

// ============================================================================
// ✅ OPTIMIZED 4-STEP LLM CHAIN - Works with Fine-Tuned Model Output
// ============================================================================
// Your fine-tuned model ALREADY provides: text + effectiveness
// The 4-step chain adds: diagnosis + feedback + suggestion + reason
// ============================================================================

// STEP 1: Diagnose ALL elements in ONE call
async function batchDiagnoseAll(
  elements: Array<{element: any, name: string, index?: number}>,
  prompt: string
): Promise<string[]> {
  
  // Build a numbered list of all elements with their FT-model effectiveness
  const elementsList = elements.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Text: "${e.element.text}"
   Effectiveness (from fine-tuned model): ${e.element.effectiveness}`
  }).join('\n\n')

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach analyzing argumentative essay elements.

Essay prompt: """${prompt}"""

A fine-tuned model has already classified each element's effectiveness. Your job is to provide DIAGNOSIS for each element.

For EACH element, provide a diagnosis that:
1. Explains the role of this element in argumentative writing
2. Evaluates how well it serves the essay prompt
3. Considers the effectiveness rating from the fine-tuned model

Be specific and direct. Do not provide suggestions or feedback yet - only diagnose.

Return JSON: {"diagnoses": ["diagnosis for element 0", "diagnosis for element 1", ...]}`
      },
      {
        role: "user",
        content: `Elements to diagnose:\n\n${elementsList}\n\nProvide diagnosis for each element in order:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"diagnoses": []}')
  return result.diagnoses || []
}

// STEP 2: Generate feedback for ALL elements in ONE call
async function batchFeedbackAll(
  elements: Array<{element: any, name: string, index?: number}>,
  diagnoses: string[]
): Promise<string[][]> {
  
  const elementsList = elements.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Text: "${e.element.text}"
   Effectiveness: ${e.element.effectiveness}
   Diagnosis: ${diagnoses[i]}`
  }).join('\n\n')

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach providing constructive feedback.

For EACH element below, provide 3-4 bullet points of indirect feedback.

Rules:
- If effectiveness is "Effective": 
  * Give positive reinforcement
  * Explain why the element is strong (clarity, persuasiveness, alignment)
  * Include suggestions to improve even further
  
- If "Adequate", "Ineffective", or "Missing": 
  * Provide guidance for improvement
  * Use <strong>...</strong> tags to highlight important concepts
  * Be encouraging but specific
  * Give reflective prompts that guide the student to revise
  * Do NOT supply exact rewritten sentences or replacement words

Example feedback point:
"Your <strong>claim is clear</strong>, but instead of <strong>repeating it</strong> in every paragraph, state it once strongly in the introduction and let each body paragraph focus on <strong>one reason</strong>."

Return JSON: {"feedback": [["point1", "point2", "point3"], ["point1", "point2", "point3"], ...]}`
      },
      {
        role: "user",
        content: `Elements with diagnoses:\n\n${elementsList}\n\nProvide feedback for each element in order:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"feedback": []}')
  return result.feedback || []
}

// STEP 3: Generate suggestions for ALL non-effective elements in ONE call
async function batchSuggestionsAll(
  elements: Array<{element: any, name: string, index?: number}>
): Promise<string[]> {
  
  // Filter elements that need suggestions (not "Effective")
  const needsSuggestion = elements.map((e, i) => ({ ...e, originalIndex: i }))
    .filter(e => e.element.effectiveness !== "Effective")
  
  if (needsSuggestion.length === 0) {
    console.log('   ℹ️ All elements are Effective - skipping suggestions')
    return elements.map(() => "")
  }
  
  const elementsList = needsSuggestion.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Original text: "${e.element.text}"
   Effectiveness: ${e.element.effectiveness}`
  }).join('\n\n')

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach providing improved versions of essay elements.

For EACH element below, provide ONE improved sentence that is:
- Stronger and more precise while keeping core meaning
- More compelling with stronger academic language
- More specific and clear

Guidelines by effectiveness level:
- If "Adequate": Rewrite into a stronger, more precise version
- If "Ineffective": Create a clear, specific, academic example that fulfills the role
- If "Missing": Create an appropriate example

Always return ONE improved sentence per element, no extra text.

Return JSON: {"suggestions": ["suggestion 1", "suggestion 2", ...]}`
      },
      {
        role: "user",
        content: `Elements to improve:\n\n${elementsList}\n\nProvide one improved sentence for each:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"suggestions": []}')
  const suggestions = result.suggestions || []
  
  // Map suggestions back to original array positions
  const fullSuggestions = new Array(elements.length).fill("")
  needsSuggestion.forEach((e, i) => {
    fullSuggestions[e.originalIndex] = suggestions[i] || ""
  })
  
  return fullSuggestions
}

// STEP 4: Generate reasons for ALL suggestions in ONE call
async function batchReasonsAll(
  elements: Array<{element: any, name: string, index?: number}>,
  suggestions: string[]
): Promise<string[]> {
  
  // Filter elements that need reasons (have suggestions and not "Effective")
  const needsReason = elements.map((e, i) => ({ ...e, suggestion: suggestions[i], originalIndex: i }))
    .filter(e => e.suggestion && e.element.effectiveness !== "Effective")
  
  if (needsReason.length === 0) {
    console.log('   ℹ️ No suggestions generated - skipping reasons')
    return elements.map(() => "")
  }
  
  const elementsList = needsReason.map((e, i) => {
    const displayName = e.index !== undefined 
      ? `${e.name} #${e.index + 1}` 
      : e.name
    return `${i}. ${displayName}
   Original: "${e.element.text}"
   Suggestion: "${e.suggestion}"
   Effectiveness: ${e.element.effectiveness}`
  }).join('\n\n')

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert writing coach explaining improvements.

For EACH element below, explain in 2-4 sentences why the suggested improvement is stronger than the original.
Focus on clarity, persuasiveness, and argumentative effectiveness.

Return JSON: {"reasons": ["reason 1", "reason 2", ...]}`
      },
      {
        role: "user",
        content: `Elements with suggestions:\n\n${elementsList}\n\nExplain why each suggestion is better:`
      }
    ]
  })
  
  const result = JSON.parse(completion.choices[0].message.content || '{"reasons": []}')
  const reasons = result.reasons || []
  
  // Map reasons back to original array positions
  const fullReasons = new Array(elements.length).fill("")
  needsReason.forEach((e, i) => {
    fullReasons[e.originalIndex] = reasons[i] || ""
  })
  
  return fullReasons
}

// MAIN OPTIMIZED CHAIN: 4 calls total instead of 48+!
async function optimizedProcess4StepChain(
  elements: Array<{element: any, path: string, name: string, index?: number}>,
  prompt: string
): Promise<any[]> {
  
  const startTime = Date.now()
  console.log(`\n🔗 Starting optimized 4-step LLM chain for ${elements.length} elements`)
  
  // Count elements by effectiveness for logging
  const effectiveCounts = elements.reduce((acc, e) => {
    acc[e.element.effectiveness] = (acc[e.element.effectiveness] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log('📊 Element effectiveness from fine-tuned model:', effectiveCounts)
  
  // STEP 1: Diagnose ALL (1 API call)
  console.log('\n📍 Step 1/4: Diagnosing ALL elements...')
  const diagnoses = await batchDiagnoseAll(elements, prompt)
  console.log(`✅ Step 1/4 complete (${Date.now() - startTime}ms)`)
  
  // STEP 2: Feedback for ALL (1 API call)
  console.log('📍 Step 2/4: Generating feedback for ALL elements...')
  const feedbacks = await batchFeedbackAll(elements, diagnoses)
  console.log(`✅ Step 2/4 complete (${Date.now() - startTime}ms)`)
  
  // STEP 3: Suggestions for ALL non-effective (1 API call)
  console.log('📍 Step 3/4: Generating suggestions for non-Effective elements...')
  const suggestions = await batchSuggestionsAll(elements)
  console.log(`✅ Step 3/4 complete (${Date.now() - startTime}ms)`)
  
  // STEP 4: Reasons for ALL suggestions (1 API call)
  console.log('📍 Step 4/4: Generating reasons for ALL suggestions...')
  const reasons = await batchReasonsAll(elements, suggestions)
  console.log(`✅ Step 4/4 complete (${Date.now() - startTime}ms)`)
  
  console.log(`\n🎉 Total chain time: ${Date.now() - startTime}ms`)
  console.log(`🚀 Estimated speedup: ~${Math.floor((elements.length * 4) / 4)}x faster\n`)
  
  // Combine all results
  return elements.map((e, i) => ({
    ...e.element,
    diagnosis: diagnoses[i] || "",
    feedback: feedbacks[i] || [],
    suggestion: suggestions[i] || "",
    reason: reasons[i] || ""
  }))
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

CRITICAL: Each element must have both "text" and "effectiveness" fields. Do not include a top-level "effectiveness" field.`

export async function POST(request: NextRequest) {
  const totalStartTime = Date.now()
  
  try {
    const { essay, prompt } = await request.json()
    const FT_MODEL = process.env.FT_MODEL

    let completion
    let modelUsed = FT_MODEL ?? "gpt-4o-mini"

    try {
      console.log("⚡ Using model:", modelUsed)

      // STEP 1 → Fine-tuned model gives structure + effectiveness
      completion = await openai.chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
          { role: "user", content: essay },
        ],
        response_format: { type: "json_object" },
      })
    } catch (err: any) {
      console.warn("⚠️ FT model unavailable, falling back to gpt-4o-mini:", err.message)
      modelUsed = "gpt-4o-mini"
      console.log("⚡ Using model:", modelUsed)

      completion = await openai.chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
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
      console.warn("⚠️ Model returned old format with top-level effectiveness. Assigning 'Adequate' to all elements.")
      
      const convertElement = (text: any) => {
        if (typeof text === 'string') {
          return { text, effectiveness: text ? 'Adequate' : 'Missing' }
        }
        return text
      }

      analysis.lead = convertElement(analysis.lead)
      analysis.position = convertElement(analysis.position)
      analysis.claims = (analysis.claims || []).map(convertElement)
      analysis.evidence = (analysis.evidence || []).map(convertElement)
      analysis.counterclaims = (analysis.counterclaims || []).map(convertElement)
      analysis.counterclaim_evidence = (analysis.counterclaim_evidence || []).map(convertElement)
      analysis.rebuttals = (analysis.rebuttals || []).map(convertElement)
      analysis.rebuttal_evidence = (analysis.rebuttal_evidence || []).map(convertElement)
      analysis.conclusion = convertElement(analysis.conclusion)
      
      delete analysis.effectiveness
    }

    function lockEffectiveness(
      original: Record<string, any>,
      updated: Record<string, any>
    ): Record<string, any> {
      const lock = (o: Record<string, any>, u: Record<string, any>) => {
        if (!o || !u) return u
        u.effectiveness = o.effectiveness
        for (const key of Object.keys(o)) {
          if (Array.isArray(o[key]) && Array.isArray(u[key])) {
            for (let i = 0; i < o[key].length; i++) lock(o[key][i], u[key][i])
          } else if (
            typeof o[key] === "object" &&
            o[key] !== null &&
            typeof u[key] === "object" &&
            u[key] !== null
          ) {
            lock(o[key], u[key])
          }
        }
      }
      lock(original, updated)
      return updated
    }
    
    console.log(`⏱️ Structure detection: ${Date.now() - totalStartTime}ms`)
    
    // STEP 2 → Enrich with empty fields
    const enriched = enrichElements(analysis)

    // STEP 3 → OPTIMIZED 4-Step Chain (4 calls instead of 48+!)
    console.log("🔄 Starting OPTIMIZED 4-step GPT chain processing...")
    
    const allElements = collectElements(enriched)
    const processedElements = await optimizedProcess4StepChain(allElements, prompt || "")
    
    const finalFeedback = reconstructStructure(enriched, processedElements)

    // STEP 4 → Lock element-level effectiveness (preserve from FT model)
    const lockedFeedback = lockEffectiveness(enriched, finalFeedback)

    // STEP 5 → Normalize feedback field
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

    console.log(`🎉 TOTAL TIME: ${Date.now() - totalStartTime}ms`)
    console.log(`✅ Successfully completed with optimized LLM chaining!`)

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
//   diagnosis: z.string().default(""),
//   feedback: z.array(z.string()).default([]),
//   suggestion: z.string().default(""),
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

// function enrichElements(raw: any): any {
//   function enrich(el: any) {
//     if (!el) {
//       return { 
//         text: "", 
//         effectiveness: "Missing", 
//         diagnosis: "", 
//         feedback: [], 
//         suggestion: "", 
//         reason: "" 
//       }
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
//       diagnosis: "",
//       feedback: [],
//       suggestion: "",
//       reason: "",
//     }
//   }

//   const data = raw.elements ?? raw
//   const getFirstOrEmpty = (item: any) => {
//     if (Array.isArray(item)) return item.length > 0 ? item[0] : null
//     return item || null
//   }

//   function padArray(arr: any[], targetLength: number) {
//     const result = [...arr]
//     while (result.length < targetLength) {
//       result.push(enrich(null))
//     }
//     return result
//   }

//   return {
//     elements: {
//       lead: enrich(data.lead),
//       position: enrich(data.position),
//       claims: padArray(Array.isArray(data.claims) ? data.claims.map(enrich) : [], 2),
//       counterclaim: enrich(getFirstOrEmpty(data.counterclaims)),
//       counterclaim_evidence: enrich(getFirstOrEmpty(data.counterclaim_evidence)),
//       rebuttal: enrich(getFirstOrEmpty(data.rebuttals)),
//       rebuttal_evidence: enrich(getFirstOrEmpty(data.rebuttal_evidence)),
//       evidence: padArray(Array.isArray(data.evidence) ? data.evidence.map(enrich) : [], 3),
//       conclusion: enrich(data.conclusion),
//     },
//   }
// }

// function collectElements(enriched: any): Array<{element: any, path: string, name: string, index?: number}> {
//   const elements: Array<{element: any, path: string, name: string, index?: number}> = []
  
//   const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
//   for (const name of singleElements) {
//     elements.push({
//       element: enriched.elements[name],
//       path: `elements.${name}`,
//       name
//     })
//   }
  
//   enriched.elements.claims.forEach((claim: any, index: number) => {
//     elements.push({
//       element: claim,
//       path: `elements.claims[${index}]`,
//       name: 'claim',
//       index
//     })
//   })
  
//   enriched.elements.evidence.forEach((evidence: any, index: number) => {
//     elements.push({
//       element: evidence,
//       path: `elements.evidence[${index}]`,
//       name: 'evidence',
//       index
//     })
//   })
  
//   return elements
// }

// function reconstructStructure(enriched: any, processedElements: any[]): any {
//   const result = JSON.parse(JSON.stringify(enriched))
  
//   let elementIndex = 0
  
//   const singleElements = ['lead', 'position', 'counterclaim', 'counterclaim_evidence', 'rebuttal', 'rebuttal_evidence', 'conclusion']
//   for (const name of singleElements) {
//     result.elements[name] = processedElements[elementIndex++]
//   }
  
//   for (let i = 0; i < result.elements.claims.length; i++) {
//     result.elements.claims[i] = processedElements[elementIndex++]
//   }
  
//   for (let i = 0; i < result.elements.evidence.length; i++) {
//     result.elements.evidence[i] = processedElements[elementIndex++]
//   }
  
//   return result
// }

// const FeedbackBatchSchema = z.object({
//   feedback: z.array(z.array(z.string())),
// })
// function sentenceCount(text: string): number {
//   // Strip HTML tags before counting to avoid periods inside tags being counted
//   const stripped = text.replace(/<[^>]+>/g, "")
//   return stripped
//     .split(/[.!?]+/)
//     .map((part) => part.trim())
//     .filter(Boolean).length
// }

// function wrapWithStrongIfMissing(text: string): string {
//   if (text.includes("<strong>") && text.includes("</strong>")) return text

//   const prefix = text.startsWith("- ") ? "- " : ""
//   const body = prefix ? text.slice(2).trim() : text.trim()
//   const words = body.split(/\s+/).filter(Boolean)
//   const phrase = words.slice(0, Math.min(4, words.length)).join(" ")
//   if (!phrase) return `${prefix}<strong>Revision focus</strong>`

//   const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
//   return `${prefix}${body.replace(new RegExp(escaped), `<strong>${phrase}</strong>`)}`
// }

// function normalizeTwoSentences(text: string): string {
//   // Split on sentence-ending punctuation followed by a space or end-of-string
//   // but avoid splitting inside HTML tags
//   const stripped = text.replace(/<[^>]+>/g, "")
//   const parts = stripped.match(/[^.!?]+[.!?]+/g)?.map((p) => p.trim()).filter(Boolean) ?? []
//   if (parts.length <= 2) return text.trim()

//   // Find the character position of the end of the 2nd sentence in the original
//   let count = 0
//   let cutIndex = text.length
//   for (let i = 0; i < text.length; i++) {
//     const ch = text[i]
//     // Skip over HTML tags
//     if (ch === "<") {
//       while (i < text.length && text[i] !== ">") i++
//       continue
//     }
//     if (/[.!?]/.test(ch)) {
//       count++
//       if (count === 2) {
//         cutIndex = i + 1
//         break
//       }
//     }
//   }
//   return text.slice(0, cutIndex).trim()
// }

// function repairBullet(raw: string): string {
//   let bullet = raw.trim()
//   if (!bullet.startsWith("- ")) {
//     bullet = `- ${bullet}`
//   }
//   bullet = wrapWithStrongIfMissing(bullet)
//   bullet = normalizeTwoSentences(bullet)
//   if (!bullet.includes("?")) {
//     bullet = `${bullet}${bullet.endsWith(".") ? "" : "."} How could you strengthen this?`
//   }
//   return bullet
// }

// function normalizeRow(rawRow: unknown, elementName?: string): string[] {
//   const row = Array.isArray(rawRow) 
//     ? rawRow.filter((item): item is string => typeof item === "string") 
//     : []
//   const repaired = row.map(repairBullet)

//   // Deduplicate — remove bullets that are too similar to a previous one
//   const deduped: string[] = []
//   for (const bullet of repaired) {
//     const stripped = bullet.replace(/<[^>]+>/g, "").toLowerCase().trim()
//     const isDuplicate = deduped.some(existing => {
//       const existingStripped = existing.replace(/<[^>]+>/g, "").toLowerCase().trim()
//       // Consider duplicate if >60% of words overlap
//       const aWords = new Set(stripped.split(/\s+/))
//       const bWords = existingStripped.split(/\s+/)
//       const overlap = bWords.filter(w => aWords.has(w)).length
//       return overlap / Math.max(aWords.size, bWords.length) > 0.6
//     })
//     if (!isDuplicate) deduped.push(bullet)
//   }

//   const name = elementName ?? "element"
//   const fallbacks = [
//     `- What <strong>specific detail</strong> could you add to make this ${name} more convincing?`,
//     `- Consider whether your <strong>reasoning</strong> is clear to a reader who disagrees with you — what would they need to be persuaded?`,
//     `- How does this ${name} connect to your <strong>overall argument</strong>? Making that link explicit would strengthen your essay.`,
//   ]

//   // Fill with distinct fallbacks rather than clones
//   let fallbackIndex = 0
//   while (deduped.length < 3) {
//     const fb = fallbacks[fallbackIndex % fallbacks.length]
//     if (!deduped.includes(fb)) deduped.push(fb)
//     fallbackIndex++
//   }

//   return deduped.slice(0, 4)
// }

// function repairFeedbackMatrix(matrix: unknown, expectedLength: number): string[][] {
//   const rows = Array.isArray(matrix) ? matrix : []
//   const normalized = rows.map((row, i) => normalizeRow(row))

//   if (normalized.length === 0) {
//     normalized.push(normalizeRow(["- <strong>Element diagnosis</strong> needs revision. How could you strengthen this?"]))
//   }
//   while (normalized.length < expectedLength) {
//     normalized.push([...normalized[normalized.length - 1]])
//   }
//   return normalized.slice(0, expectedLength)
// }

// // ============================================================================
// // ✅ OPTIMIZED 4-STEP LLM CHAIN - Works with Fine-Tuned Model Output
// // ============================================================================
// // Your fine-tuned model ALREADY provides: text + effectiveness
// // The 4-step chain adds: diagnosis + feedback + suggestion + reason
// // ============================================================================

// // STEP 1: Diagnose ALL elements in ONE call
// async function batchDiagnoseAll(
//   elements: Array<{element: any, name: string, index?: number}>,
//   prompt: string
// ): Promise<string[]> {
  
//   // Build a numbered list of all elements with their FT-model effectiveness
//   const elementsList = elements.map((e, i) => {
//     const displayName = e.index !== undefined 
//       ? `${e.name} #${e.index + 1}` 
//       : e.name
//     return `${i}. ${displayName}
//    Text: "${e.element.text}"
//    Effectiveness (from fine-tuned model): ${e.element.effectiveness}`
//   }).join('\n\n')

//   const completion = await openai.chat.completions.create({
//     model: "gpt-4o",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: `You are an expert writing coach analyzing argumentative essay elements.

// Essay prompt: """${prompt}"""

// A fine-tuned model has already classified each element's effectiveness. Your job is to provide DIAGNOSIS for each element.

// For EACH element, provide a diagnosis that:
// 1. Explains the role of this element in argumentative writing
// 2. Evaluates how well it serves the essay prompt
// 3. Considers the effectiveness rating from the fine-tuned model

// Be specific and direct. Do not provide suggestions or feedback yet - only diagnose.

// Return JSON: {"diagnoses": ["diagnosis for element 0", "diagnosis for element 1", ...]}`
//       },
//       {
//         role: "user",
//         content: `Elements to diagnose:\n\n${elementsList}\n\nProvide diagnosis for each element in order:`
//       }
//     ]
//   })
  
//   const result = JSON.parse(completion.choices[0].message.content || '{"diagnoses": []}')
//   return result.diagnoses || []
// }

// // STEP 2: Generate feedback for ALL elements in ONE call
// async function batchFeedbackAll(
//   elements: Array<{element: any, name: string, index?: number}>,
//   diagnoses: string[]
// ): Promise<string[][]> {
//   const elementsList = elements.map((e, i) => {
//     const displayName = e.index !== undefined 
//       ? `${e.name} #${e.index + 1}` 
//       : e.name
//     return `${i}. ${displayName}
//    Text: "${e.element.text}"
//    Effectiveness: ${e.element.effectiveness}
//    Diagnosis: ${diagnoses[i]}`
//   }).join('\n\n')

//   //this is chinese public school year 1 feedback, use chinese also? refined prompt. 

//   const systemPrompt = `
//   You are a thoughtful, experienced writing coach giving personalised feedback on a student’s argumentative essay. Your tone is encouraging but honest — like a teacher who knows the student's work well.

// Return STRICT JSON only:
// {"feedback":[["point1","point2","point3"], ...]}
// One array per element. Each array must contain exactly 3 feedback points.

// Global Rules:
// - Each of the 3 points MUST address a different dimension (e.g., reasoning depth, evidence strength, specificity, warrant logic, structure, nuance, counterargument quality).
// - Each point must clearly reference something specific from the student's actual text.
// - Do NOT rewrite the student's sentences.
// - Do NOT repeat the same idea in different wording.
// - No prose outside JSON.

// If effectiveness is "Effective":
// - Provide specific reinforcement.
// - Explain why the element works rhetorically.
// - At least one point must identify a subtle limitation or missed opportunity for refinement.

// If effectiveness is "Adequate", "Ineffective", or "Missing":
// - Provide actionable guidance.
// - Use <strong>...</strong> tags around the key concept being discussed.
// - Include at least one reflective question.
// - Do NOT supply rewritten sentences or replacement wording.

// Avoid generic phrases like:
// - "add more detail"
// - "improve persuasiveness"
// - "develop this further"
// `

//   const runFeedbackRequest = async (repairInstruction?: string) => {
//     const completion = await openai.chat.completions.create({
//       model: "gpt-4o",
//       response_format: { type: "json_object" },
//       messages: [
//         {
//           role: "system",
//           content: systemPrompt,
//         },
//         {
//           role: "user",
//           content: `Elements with diagnoses:\n\n${elementsList}\n\nProvide feedback for each element in order.${repairInstruction ? `\n\nRepair note: ${repairInstruction}` : ""}`,
//         },
//       ],
//     })

//     const parsed = JSON.parse(completion.choices[0].message.content || '{"feedback": []}')
//     return parsed.feedback
//   }

//   try {
//     const rawFeedback = await runFeedbackRequest()

//     const normalized = elements.map((_, i) => {
//       const item = rawFeedback?.[i]
//       if (!Array.isArray(item)) {
//         return []
//       }
//       return item.map((point: unknown) => String(point))
//     })

//     return normalized
//   } catch (error) {
//     console.error("Error while generating batch feedback:", error)
//     return elements.map(() => [])
//   }
// }

// // STEP 3: Generate suggestions for ALL non-effective elements in ONE call
// async function batchSuggestionsAll(
//   elements: Array<{element: any, name: string, index?: number}>
// ): Promise<string[]> {
  
//   // Filter elements that need suggestions (not "Effective")
//   const needsSuggestion = elements.map((e, i) => ({ ...e, originalIndex: i }))
//     .filter(e => e.element.effectiveness !== "Effective")
  
//   if (needsSuggestion.length === 0) {
//     console.log('   ℹ️ All elements are Effective - skipping suggestions')
//     return elements.map(() => "")
//   }
  
//   const elementsList = needsSuggestion.map((e, i) => {
//     const displayName = e.index !== undefined 
//       ? `${e.name} #${e.index + 1}` 
//       : e.name
//     return `${i}. ${displayName}
//    Original text: "${e.element.text}"
//    Effectiveness: ${e.element.effectiveness}`
//   }).join('\n\n')

//   const completion = await openai.chat.completions.create({
//     model: "gpt-5-mini",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: `You are an expert writing coach providing improved versions of essay elements.

// For EACH element below, provide ONE improved sentence that is:
// - Stronger and more precise while keeping core meaning
// - More compelling with stronger academic language
// - More specific and clear

// Guidelines by effectiveness level:
// - If "Adequate": Rewrite into a stronger, more precise version
// - If "Ineffective": Create a clear, specific, academic example that fulfills the role
// - If "Missing": Create an appropriate example

// Always return ONE improved sentence per element, no extra text.

// Return JSON: {"suggestions": ["suggestion 1", "suggestion 2", ...]}`
//       },
//       {
//         role: "user",
//         content: `Elements to improve:\n\n${elementsList}\n\nProvide one improved sentence for each:`
//       }
//     ]
//   })
  
//   const result = JSON.parse(completion.choices[0].message.content || '{"suggestions": []}')
//   const suggestions = result.suggestions || []
  
//   // Map suggestions back to original array positions
//   const fullSuggestions = new Array(elements.length).fill("")
//   needsSuggestion.forEach((e, i) => {
//     fullSuggestions[e.originalIndex] = suggestions[i] || ""
//   })
  
//   return fullSuggestions
// }

// // STEP 4: Generate reasons for ALL suggestions in ONE call
// async function batchReasonsAll(
//   elements: Array<{element: any, name: string, index?: number}>,
//   suggestions: string[]
// ): Promise<string[]> {
  
//   // Filter elements that need reasons (have suggestions and not "Effective")
//   const needsReason = elements.map((e, i) => ({ ...e, suggestion: suggestions[i], originalIndex: i }))
//     .filter(e => e.suggestion && e.element.effectiveness !== "Effective")
  
//   if (needsReason.length === 0) {
//     console.log('   ℹ️ No suggestions generated - skipping reasons')
//     return elements.map(() => "")
//   }
  
//   const elementsList = needsReason.map((e, i) => {
//     const displayName = e.index !== undefined 
//       ? `${e.name} #${e.index + 1}` 
//       : e.name
//     return `${i}. ${displayName}
//    Original: "${e.element.text}"
//    Suggestion: "${e.suggestion}"
//    Effectiveness: ${e.element.effectiveness}`
//   }).join('\n\n')

//   const completion = await openai.chat.completions.create({
//     model: "gpt-4o",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: `You are an expert writing coach explaining improvements.

// For EACH element below, explain in 2-4 sentences why the suggested improvement is stronger than the original.
// Focus on clarity, persuasiveness, and argumentative effectiveness.

// Return JSON: {"reasons": ["reason 1", "reason 2", ...]}`
//       },
//       {
//         role: "user",
//         content: `Elements with suggestions:\n\n${elementsList}\n\nExplain why each suggestion is better:`
//       }
//     ]
//   })
  
//   const result = JSON.parse(completion.choices[0].message.content || '{"reasons": []}')
//   const reasons = result.reasons || []
  
//   // Map reasons back to original array positions
//   const fullReasons = new Array(elements.length).fill("")
//   needsReason.forEach((e, i) => {
//     fullReasons[e.originalIndex] = reasons[i] || ""
//   })
  
//   return fullReasons
// }

// // MAIN OPTIMIZED CHAIN: 4 calls total instead of 48+!
// async function optimizedProcess4StepChain(
//   elements: Array<{element: any, path: string, name: string, index?: number}>,
//   prompt: string
// ): Promise<any[]> {
  
//   const startTime = Date.now()
//   console.log(`\n🔗 Starting optimized 4-step LLM chain for ${elements.length} elements`)
  
//   // Count elements by effectiveness for logging
//   const effectiveCounts = elements.reduce((acc, e) => {
//     acc[e.element.effectiveness] = (acc[e.element.effectiveness] || 0) + 1
//     return acc
//   }, {} as Record<string, number>)
//   console.log('📊 Element effectiveness from fine-tuned model:', effectiveCounts)
  
//   // STEP 1: Diagnose ALL (1 API call)
//   console.log('\n📍 Step 1/4: Diagnosing ALL elements...')
//   const diagnoses = await batchDiagnoseAll(elements, prompt)
//   console.log(`✅ Step 1/4 complete (${Date.now() - startTime}ms)`)
  
//   // STEP 2: Feedback for ALL (1 API call)
//   console.log('📍 Step 2/4: Generating feedback for ALL elements...')
//   const feedbacks = await batchFeedbackAll(elements, diagnoses)
// // ensure every element has at least an empty array
//   const safeFeedbacks = elements.map((_, i) => feedbacks[i] ?? [])

//   console.log(`✅ Step 2/4 complete (${Date.now() - startTime}ms)`)
  
//   // STEP 3: Suggestions for ALL non-effective (1 API call)
//   console.log('📍 Step 3/4: Generating suggestions for non-Effective elements...')
//   const suggestions = await batchSuggestionsAll(elements)
//   console.log(`✅ Step 3/4 complete (${Date.now() - startTime}ms)`)
  
//   // STEP 4: Reasons for ALL suggestions (1 API call)
//   console.log('📍 Step 4/4: Generating reasons for ALL suggestions...')
//   const reasons = await batchReasonsAll(elements, suggestions)
//   console.log(`✅ Step 4/4 complete (${Date.now() - startTime}ms)`)
  
//   console.log(`\n🎉 Total chain time: ${Date.now() - startTime}ms`)
//   console.log(`🚀 Estimated speedup: ~${Math.floor((elements.length * 4) / 4)}x faster\n`)
  
//   // Combine all results
//   return elements.map((e, i) => ({
//     ...e.element,
//     diagnosis: diagnoses[i] || "",
//     feedback: safeFeedbacks[i] || [],
//     suggestion: suggestions[i] || "",
//     reason: reasons[i] || ""
//   }))
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

// CRITICAL: Each element must have both "text" and "effectiveness" fields. Do not include a top-level "effectiveness" field.`

// export async function POST(request: NextRequest) {
//   const totalStartTime = Date.now()
  
//   try {
//     const { essay, prompt } = await request.json()
//     const FT_MODEL = process.env.FT_MODEL

//     let completion
//     let modelUsed = FT_MODEL ?? "gpt-4o-mini"

//     try {
//       console.log("⚡ Using model:", modelUsed)

//       // STEP 1 → Fine-tuned model gives structure + effectiveness
//       completion = await openai.chat.completions.create({
//         model: modelUsed,
//         messages: [
//           { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
//           { role: "user", content: essay },
//         ],
//         response_format: { type: "json_object" },
//       })
//     } catch (err: any) {
//       console.warn("⚠️ FT model unavailable, falling back to gpt-4o-mini:", err.message)
//       modelUsed = "gpt-4o-mini"
//       console.log("⚡ Using model:", modelUsed)

//       completion = await openai.chat.completions.create({
//         model: modelUsed,
//         messages: [
//           { role: "system", content: FINE_TUNED_SYSTEM_PROMPT },
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
//       console.warn("⚠️ Model returned old format with top-level effectiveness. Assigning 'Adequate' to all elements.")
      
//       const convertElement = (text: any) => {
//         if (typeof text === 'string') {
//           return { text, effectiveness: text ? 'Adequate' : 'Missing' }
//         }
//         return text
//       }

//       analysis.lead = convertElement(analysis.lead)
//       analysis.position = convertElement(analysis.position)
//       analysis.claims = (analysis.claims || []).map(convertElement)
//       analysis.evidence = (analysis.evidence || []).map(convertElement)
//       analysis.counterclaims = (analysis.counterclaims || []).map(convertElement)
//       analysis.counterclaim_evidence = (analysis.counterclaim_evidence || []).map(convertElement)
//       analysis.rebuttals = (analysis.rebuttals || []).map(convertElement)
//       analysis.rebuttal_evidence = (analysis.rebuttal_evidence || []).map(convertElement)
//       analysis.conclusion = convertElement(analysis.conclusion)
      
//       delete analysis.effectiveness
//     }

//     function lockEffectiveness(
//       original: Record<string, any>,
//       updated: Record<string, any>
//     ): Record<string, any> {
//       const lock = (o: Record<string, any>, u: Record<string, any>) => {
//         if (!o || !u) return u
//         u.effectiveness = o.effectiveness
//         for (const key of Object.keys(o)) {
//           if (Array.isArray(o[key]) && Array.isArray(u[key])) {
//             for (let i = 0; i < o[key].length; i++) lock(o[key][i], u[key][i])
//           } else if (
//             typeof o[key] === "object" &&
//             o[key] !== null &&
//             typeof u[key] === "object" &&
//             u[key] !== null
//           ) {
//             lock(o[key], u[key])
//           }
//         }
//       }
//       lock(original, updated)
//       return updated
//     }
    
//     console.log(`⏱️ Structure detection: ${Date.now() - totalStartTime}ms`)
    
//     // STEP 2 → Enrich with empty fields
//     const enriched = enrichElements(analysis)

//     // STEP 3 → OPTIMIZED 4-Step Chain (4 calls instead of 48+!)
//     console.log("🔄 Starting OPTIMIZED 4-step GPT chain processing...")
    
//     const allElements = collectElements(enriched)
//     const processedElements = await optimizedProcess4StepChain(allElements, prompt || "")
    
//     const finalFeedback = reconstructStructure(enriched, processedElements)

//     // STEP 4 → Lock element-level effectiveness (preserve from FT model)
//     const lockedFeedback = lockEffectiveness(enriched, finalFeedback)

//     // STEP 5 → Normalize feedback field
//     const normalized = normalizeFeedback(lockedFeedback)

//     // STEP 6 → Validate with Zod
//     const parsed = FeedbackResultSchema.safeParse(normalized)
//     if (!parsed.success) {
//       console.error("❌ Zod validation failed", parsed.error.format())
//       return NextResponse.json(
//         { error: "Schema validation failed", issues: parsed.error.format() },
//         { status: 400 },
//       )
//     }

//     console.log(`🎉 TOTAL TIME: ${Date.now() - totalStartTime}ms`)
//     console.log(`✅ Successfully completed with optimized LLM chaining!`)

//     // STEP 7 → Return normalized version
//     return NextResponse.json(normalized)
//   } catch (error) {
//     console.error("Error analyzing argumentative structure:", error)
//     return NextResponse.json({ error: "Failed to analyze essay" }, { status: 500 })
//   }
// }
