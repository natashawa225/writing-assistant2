import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { openai } from "@/lib/openai"

const ReasonSchema = z.union([
  z.string(),
  z.object({
    rhetorical_function: z.string().optional(),
    reader_impact: z.string().optional(),
    text_quality: z.string().optional(),
  }).transform((obj) =>
    [obj.rhetorical_function, obj.reader_impact, obj.text_quality]
      .filter(Boolean)
      .join(" ")
  ),
]).default("")

const ArgumentElementSchema = z.object({
  id: z.string().optional(),
  parentClaimId: z.string().optional(),
  text: z.string().default(""),
  effectiveness: z.enum(["Effective", "Adequate", "Ineffective", "Missing"]).default("Missing"),
  feedback: z.array(z.string()).default([]),
  suggestion: z.string().default(""),
  reason: ReasonSchema,  // <-- was z.string().default("")
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

// ============================================================================
// XML PARSING — matches the new fine-tuned model's output format
// ============================================================================

const TAG_MAP: Record<string, string> = {
  L1:   "lead",
  P1:   "position",
  C1:   "claims",
  D1:   "evidence",
  CT1:  "counterclaims",
  CD1:  "counterclaim_evidence",
  R1:   "rebuttals",
  RD1:  "rebuttal_evidence",
  S1:   "conclusion",
}

type ParsedElement = { text: string; effectiveness: string; id?: string; parentClaimId?: string }
type ParsedXML = {
  lead?: ParsedElement
  position?: ParsedElement
  claims: ParsedElement[]
  evidence: ParsedElement[]
  counterclaims: ParsedElement[]
  counterclaim_evidence: ParsedElement[]
  rebuttals: ParsedElement[]
  rebuttal_evidence: ParsedElement[]
  conclusion?: ParsedElement
}

function parseXMLOutput(xml: string): ParsedXML {
  const result: ParsedXML = {
    claims: [],
    evidence: [],
    counterclaims: [],
    counterclaim_evidence: [],
    rebuttals: [],
    rebuttal_evidence: [],
  }

  const tagPattern = /<(L1|P1|C1|D1|CT1|CD1|R1|RD1|S1)([^>]*)>([\s\S]*?)<\/\1>/g
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(xml)) !== null) {
    const [, tag, attributes, rawText] = match
    const key = TAG_MAP[tag]
    if (!key) continue
    const effectiveness = attributes.match(/effectiveness="([^"]+)"/i)?.[1] ?? "Missing"
    const parentClaimId = attributes.match(/parent(?:ClaimId)?="([^"]+)"/i)?.[1]
    const id = attributes.match(/id="([^"]+)"/i)?.[1]

    const element: ParsedElement = {
      text: rawText.trim(),
      effectiveness: normalizeEffectiveness(effectiveness),
      ...(id ? { id } : {}),
      ...(parentClaimId ? { parentClaimId } : {}),
    }

    const arrayKeys = ["claims", "evidence", "counterclaims", "counterclaim_evidence", "rebuttals", "rebuttal_evidence"]
    if (arrayKeys.includes(key)) {
      (result as any)[key].push(element)
    } else {
      (result as any)[key] = element
    }
  }

  return result
}

function normalizeEffectiveness(raw: string): "Effective" | "Adequate" | "Ineffective" | "Missing" {
  const map: Record<string, "Effective" | "Adequate" | "Ineffective" | "Missing"> = {
    effective: "Effective",
    adequate: "Adequate",
    ineffective: "Ineffective",
    missing: "Missing",
  }
  return map[raw.toLowerCase()] ?? "Missing"
}

// ============================================================================
// ENRICHMENT — normalises parsed XML into the internal structure
// ============================================================================

function makeEmpty() {
  return {
    id: undefined,
    parentClaimId: undefined,
    text: "",
    effectiveness: "Missing" as const,
    feedback: [],
    suggestion: "",
    reason: "",
  }
}

function toElement(el: ParsedElement | undefined, id?: string, parentClaimId?: string) {
  if (!el) return makeEmpty()
  return {
    id: id ?? (el as any).id,
    parentClaimId: parentClaimId ?? (el as any).parentClaimId,
    text: el.text,
    effectiveness: el.effectiveness as any,
    feedback: [],
    suggestion: "",
    reason: "",
  }
}

function enrichElements(parsed: ParsedXML) {
  const parseIndexedId = (value: string | undefined, prefix: string): number | null => {
    if (!value) return null
    const match = value.toLowerCase().match(new RegExp(`${prefix}[\\s_-]*(\\d+)`))
    if (!match) return null
    const n = Number.parseInt(match[1], 10)
    return Number.isNaN(n) ? null : n
  }

  const claims = [toElement(undefined, "claim-1"), toElement(undefined, "claim-2")]
  const evidence = [
    toElement(undefined, "evidence-1", "claim-1"),
    toElement(undefined, "evidence-2", "claim-2"),
  ]

  const claimSlotsUsed = new Set<number>()
  parsed.claims.forEach((claim) => {
    const fromId = parseIndexedId((claim as any).id, "claim")
    let slot = fromId !== null && fromId >= 1 && fromId <= 2 ? fromId - 1 : -1
    if (slot === -1 || claimSlotsUsed.has(slot)) {
      slot = [0, 1].find((idx) => !claimSlotsUsed.has(idx)) ?? -1
    }
    if (slot === -1) return
    claims[slot] = toElement(claim, `claim-${slot + 1}`)
    claimSlotsUsed.add(slot)
  })

  const evidenceSlotsUsed = new Set<number>()
  parsed.evidence.forEach((ev) => {
    const fromParent = parseIndexedId((ev as any).parentClaimId, "claim")
    const fromId = parseIndexedId((ev as any).id, "evidence")
    let slot =
      fromParent !== null && fromParent >= 1 && fromParent <= 2
        ? fromParent - 1
        : fromId !== null && fromId >= 1 && fromId <= 2
          ? fromId - 1
          : -1
    if (slot === -1 || evidenceSlotsUsed.has(slot)) {
      slot = [0, 1].find((idx) => !evidenceSlotsUsed.has(idx)) ?? -1
    }
    if (slot === -1) return
    evidence[slot] = toElement(ev, `evidence-${slot + 1}`, `claim-${slot + 1}`)
    evidenceSlotsUsed.add(slot)
  })

  return {
    elements: {
      lead:                 toElement(parsed.lead, "lead-1"),
      position:             toElement(parsed.position, "position-1"),
      claims,
      counterclaim:         toElement(parsed.counterclaims[0], "counterclaim-1"),
      counterclaim_evidence:toElement(parsed.counterclaim_evidence[0], "counterclaim-evidence-1"),
      rebuttal:             toElement(parsed.rebuttals[0], "rebuttal-1"),
      rebuttal_evidence:    toElement(parsed.rebuttal_evidence[0], "rebuttal-evidence-1"),
      evidence,
      conclusion:           toElement(parsed.conclusion, "conclusion-1"),
    },
  }
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

function shouldSplitEvidenceCandidate(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const citationSignals =
    countMatches(trimmed, /\b\d{4}\b/g) +
    countMatches(trimmed, /%/g) +
    countMatches(trimmed, /\b(study|research|according to|report|survey|data|statistic)\b/gi)

  const discourseSignals = countMatches(
    trimmed,
    /\b(first|second|third|also|moreover|however|furthermore|in addition|for example|for instance)\b|;/gi,
  )

  const isLong = trimmed.length > 220 || trimmed.split(/\s+/).length > 40

  return citationSignals >= 2 || discourseSignals >= 2 || isLong
}

function dedupeEvidenceParts(parts: string[]): string[] {
  const normalized = new Set<string>()
  const result: string[] = []
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    const key = part.toLowerCase().replace(/\s+/g, " ")
    if (key.length < 8) continue
    if (normalized.has(key)) continue
    normalized.add(key)
    result.push(part)
  }
  return result
}

async function conditionalSplitEvidence(parsed: ParsedXML): Promise<ParsedXML> {
  if (parsed.evidence.length >= 2) return parsed

  const firstEvidence = parsed.evidence[0]
  if (!firstEvidence || !shouldSplitEvidenceCandidate(firstEvidence.text)) {
    return parsed
  }

  type SplitResponse = { split: boolean; parts: string[] }
  type LegacyChatCompletionClient = {
    createChatCompletion: (params: {
      model: string
      temperature: number
      response_format: { type: "json_object" }
      messages: Array<{ role: "system" | "user"; content: string }>
    }) => Promise<{
      data: {
        choices: Array<{ message?: { content?: string } }>
      }
    }>
  }

  try {
    const client = openai as unknown as LegacyChatCompletionClient
    const completion = await client.createChatCompletion({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Return valid json only with exact shape {"split": boolean, "parts": string[]}. If split=true, return at most 2 parts.',
        },
        {
          role: "user",
          content: `Analyze ONLY this first evidence chunk. Decide whether it should be split into at most two parts.\n\nEvidence:\n${firstEvidence.text}`,
        },
      ],
    })

    const raw = completion.data.choices[0]?.message?.content ?? '{"split": false, "parts": []}'
    const parsedJson = JSON.parse(raw) as SplitResponse
    const parts = dedupeEvidenceParts(Array.isArray(parsedJson.parts) ? parsedJson.parts : []).slice(0, 2)
    const shouldSplit = Boolean(parsedJson.split) && parts.length === 2

    if (!shouldSplit) return parsed

    const replacement: ParsedElement[] = [
      { ...firstEvidence, text: parts[0], id: `${(firstEvidence as any).id ?? "evidence-1"}-part-1` },
      { ...firstEvidence, text: parts[1], id: `${(firstEvidence as any).id ?? "evidence-1"}-part-2` },
    ]

    return {
      ...parsed,
      evidence: [...replacement, ...parsed.evidence.slice(1)],
    }
  } catch {
    return parsed
  }
}

// ============================================================================
// ELEMENT COLLECTION / RECONSTRUCTION
// ============================================================================

type ElementEntry = { element: any; path: string; name: string; index?: number }

function collectElements(enriched: ReturnType<typeof enrichElements>): ElementEntry[] {
  const out: ElementEntry[] = []

  for (const name of ["lead","position","counterclaim","counterclaim_evidence","rebuttal","rebuttal_evidence","conclusion"] as const) {
    out.push({ element: enriched.elements[name], path: `elements.${name}`, name })
  }
  enriched.elements.claims.forEach((el, i) =>
    out.push({ element: el, path: `elements.claims[${i}]`, name: "claim", index: i }))
  enriched.elements.evidence.forEach((el, i) =>
    out.push({ element: el, path: `elements.evidence[${i}]`, name: "evidence", index: i }))

  return out
}

function reconstructStructure(enriched: ReturnType<typeof enrichElements>, processedByPath: Record<string, any>) {
  const result = JSON.parse(JSON.stringify(enriched))

  const singleKeys = ["lead","position","counterclaim","counterclaim_evidence","rebuttal","rebuttal_evidence","conclusion"] as const
  singleKeys.forEach((name) => {
    const path = `elements.${name}`
    if (processedByPath[path]) {
      result.elements[name] = processedByPath[path]
    }
  })

  result.elements.claims.forEach((_: any, i: number) => {
    const path = `elements.claims[${i}]`
    if (processedByPath[path]) {
      result.elements.claims[i] = processedByPath[path]
    }
  })

  result.elements.evidence.forEach((_: any, i: number) => {
    const path = `elements.evidence[${i}]`
    if (processedByPath[path]) {
      result.elements.evidence[i] = processedByPath[path]
    }
  })

  return result
}

// ============================================================================
// STEP 1 — Feedback for ALL elements (one call)
// ============================================================================

function normalizeFeedbackEntry(raw: unknown): string[] {
  const normalizeText = (value: unknown) =>
    String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .trim()

  const sectionLabelMap: Record<string, string> = {
    effective: "Effective",
    positive_reinforcement: "Positive Reinforcement",
    positivereinforcement: "Positive Reinforcement",
    development: "Development",
    issue: "Issue",
    reflection: "Reflection",
    hint: "Hint",
  }

  const withLabel = (key: string, value: string) => {
    const normalizedKey = key.toLowerCase().replace(/[\s-]+/g, "_")
    const label = sectionLabelMap[normalizedKey]
    if (!label) return value
    const hasLabel = new RegExp(`^\\s*${label}\\s*:`, "i").test(value)
    return hasLabel ? value : `${label}: ${value}`
  }

  const collect = (value: unknown, sectionKey?: string): string[] => {
    if (value == null) return []
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = normalizeText(value)
      if (!text) return []
      return [sectionKey ? withLabel(sectionKey, text) : text]
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => collect(item, sectionKey))
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>
      const priorityKeys = ["effective", "positive_reinforcement", "development", "issue", "reflection", "hint"]
      const output: string[] = []
      const handled = new Set<string>()
      priorityKeys.forEach((key) => {
        if (!(key in obj)) return
        handled.add(key)
        output.push(...collect(obj[key], key))
      })
      Object.entries(obj).forEach(([key, nested]) => {
        if (handled.has(key)) return
        output.push(...collect(nested, key))
      })
      return output
    }
    return []
  }

  const normalized = collect(raw)
  if (normalized.length > 0) return normalized

  try {
    const fallback = normalizeText(JSON.stringify(raw))
    return fallback ? [fallback] : []
  } catch {
    return []
  }
}

async function batchFeedbackAll(elements: ElementEntry[], prompt: string): Promise<Record<string, unknown>> {
  const canonicalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "")
  const toCamelCase = (input: string) => input.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  const buildPathAliases = (path: string): string[] => {
    const aliases = new Set<string>([path, path.replace(/\[(\d+)\]/g, ".$1")])
    const claimMatch = path.match(/^elements\.claims\[(\d+)\]$/)
    if (claimMatch) {
      const idx = Number.parseInt(claimMatch[1], 10)
      const oneBased = idx + 1
      aliases.add(`claims[${idx}]`)
      aliases.add(`claims.${idx}`)
      aliases.add(`claim-${idx}`)
      aliases.add(`claim_${idx}`)
      aliases.add(`claim${idx}`)
      aliases.add(`claim-${oneBased}`)
      aliases.add(`claim_${oneBased}`)
      aliases.add(`claim${oneBased}`)
      return [...aliases]
    }

    const evidenceMatch = path.match(/^elements\.evidence\[(\d+)\]$/)
    if (evidenceMatch) {
      const idx = Number.parseInt(evidenceMatch[1], 10)
      const oneBased = idx + 1
      aliases.add(`evidence[${idx}]`)
      aliases.add(`evidence.${idx}`)
      aliases.add(`evidence-${idx}`)
      aliases.add(`evidence_${idx}`)
      aliases.add(`evidence${idx}`)
      aliases.add(`evidence-${oneBased}`)
      aliases.add(`evidence_${oneBased}`)
      aliases.add(`evidence${oneBased}`)
      return [...aliases]
    }

    const singleName = path.replace(/^elements\./, "")
    aliases.add(singleName)
    aliases.add(singleName.replace(/_/g, "-"))
    aliases.add(toCamelCase(singleName))
    return [...aliases]
  }

  const list = elements.map((e, i) => {
    const label = e.index !== undefined ? `${e.name} #${e.index + 1}` : e.name
    return `${i}. key=${e.path}\n   Label: ${label}\n   Text: "${e.element.text}"\n   Effectiveness: ${e.element.effectiveness}`
  }).join("\n\n")
  const expectedKeys = elements.map((e) => e.path)
  const expectedKeysBlock = expectedKeys.map((key) => `- ${key}`).join("\n")
  const expectedJsonLines = expectedKeys.map((key) => `    "${key}": ["..."]`).join(",\n")
  const maxAttempts = 3
  let lastFeedbackByKey: Record<string, unknown> = {}
  let lastMappedSummary: Record<string, number> = {}

  const mapResultToFeedbackByKey = (result: unknown) => {
    const feedbackByKey: Record<string, unknown> = {}
    const setIfAbsent = (path: string, value: unknown) => {
      if (feedbackByKey[path] === undefined && value !== undefined) {
        feedbackByKey[path] = value
      }
    }
    const normalizedLookup = new Map<string, unknown>()
    const addLookupEntries = (source: Record<string, unknown>) => {
      Object.entries(source).forEach(([key, value]) => {
        const canonical = canonicalizeKey(key)
        if (canonical && !normalizedLookup.has(canonical)) {
          normalizedLookup.set(canonical, value)
        }
      })
    }

    if (result && typeof result === "object") {
      const resultObj = result as Record<string, unknown>
      const byKey = resultObj.feedback_by_key
      if (byKey && typeof byKey === "object" && !Array.isArray(byKey)) {
        Object.assign(feedbackByKey, byKey as Record<string, unknown>)
        addLookupEntries(byKey as Record<string, unknown>)
      }

      const feedbackObject = resultObj.feedback
      if (feedbackObject && typeof feedbackObject === "object" && !Array.isArray(feedbackObject)) {
        addLookupEntries(feedbackObject as Record<string, unknown>)
      }

      addLookupEntries(resultObj)

      const orderedFeedback = [resultObj.feedback_in_order, resultObj.feedback, resultObj.items].find((entry) =>
        Array.isArray(entry),
      )
      if (Array.isArray(orderedFeedback)) {
        orderedFeedback.forEach((entry, index) => {
          const path = elements[index]?.path
          if (!path) return
          if (entry && typeof entry === "object" && !Array.isArray(entry) && "feedback" in (entry as Record<string, unknown>)) {
            setIfAbsent(path, (entry as Record<string, unknown>).feedback)
            return
          }
          setIfAbsent(path, entry)
        })
      }

      const legacyFeedback = resultObj.feedback
      if (Array.isArray(legacyFeedback)) {
        legacyFeedback.forEach((entry, index) => {
          const path = elements[index]?.path
          if (path) {
            setIfAbsent(path, entry)
          }
        })
      }

      const elementsObject = resultObj.elements
      if (elementsObject && typeof elementsObject === "object" && !Array.isArray(elementsObject)) {
        const data = elementsObject as Record<string, unknown>
        ;(["lead", "position", "counterclaim", "counterclaim_evidence", "rebuttal", "rebuttal_evidence", "conclusion"] as const).forEach((name) => {
          const value = data[name]
          if (!value || typeof value !== "object" || Array.isArray(value)) return
          const feedback = (value as Record<string, unknown>).feedback
          setIfAbsent(`elements.${name}`, feedback)
        })

        const claims = data.claims
        if (Array.isArray(claims)) {
          claims.forEach((claim, index) => {
            if (!claim || typeof claim !== "object" || Array.isArray(claim)) return
            setIfAbsent(`elements.claims[${index}]`, (claim as Record<string, unknown>).feedback)
          })
        }

        const evidence = data.evidence
        if (Array.isArray(evidence)) {
          evidence.forEach((item, index) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return
            setIfAbsent(`elements.evidence[${index}]`, (item as Record<string, unknown>).feedback)
          })
        }
      }
    }

    elements.forEach((element) => {
      if (feedbackByKey[element.path] !== undefined) return
      const matched = buildPathAliases(element.path)
        .map((alias) => normalizedLookup.get(canonicalizeKey(alias)))
        .find((value) => value !== undefined)
      if (matched !== undefined) {
        feedbackByKey[element.path] = matched
      }
    })

    return { feedbackByKey, normalizedLookup }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const retryInstruction =
      attempt > 1
        ? `\n\nRetry ${attempt}/${maxAttempts}. Missing keys from previous attempt:\n${expectedKeys
            .filter((key) => (lastMappedSummary[key] ?? 0) === 0)
            .map((key) => `- ${key}`)
            .join("\n")}\nReturn all keys now.`
        : ""

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Provide indirect and constructive feedback on argumentative essay elements.

Essay prompt: """${prompt}"""

You MUST generate feedback for every element listed below.
Do not skip any element.
Even if an element is Effective or Adequate, provide short constructive feedback.
Return feedback for all keys exactly as given.

Required keys:
${expectedKeysBlock}

Purpose: Help the student understand what is wrong and how to improve in general

Language requirement:
- The feedback content MUST be written in Simplified Chinese.
- Do NOT write English explanations.

Feedback style:
- Use simple, student-friendly language.
- Use a supportive, teacher-like tone.

Your explanation may implicitly reflect ONE of the following:
- rhetorical function
- reader impact
- text quality

Rules:
- If effectiveness is "Effective":
  * Give positive reinforcement and explain why the element works well.
  * Suggest how it could be developed further
- If "Adequate", "Ineffective", or "Missing":
  * Goal: Help the student notice the issue and reflect on how to improve it.
  * Write three short sections:
    - Issue: Briefly explain what may be unclear, missing, or underdeveloped.
    - Guidance: Suggest how the student could improve this element in general terms.
    - Example (optional): Give a short, generic illustration of the idea, not a corrected sentence. The example should describe the type of content the student could add, rather than writing the exact sentence.

Avoid:
- Writing a full sentence that could replace the student’s text
- Directly correcting the student’s wording
- Quoting or rewriting the student’s sentence

Return JSON with this exact shape:
{
  "feedback_by_key": {
${expectedJsonLines}
  }
}
Every required key must be present exactly once. Return valid json only.`,
        },
        {
          role: "user",
          content: `Elements:\n\n${list}\n\nProvide feedback for each element key listed above.${retryInstruction}`,
        },
      ],
    })

    const rawContent = completion.choices[0].message.content || "{}"
    console.log(`🧾 Step 1 feedback raw JSON (attempt ${attempt}/${maxAttempts}):\n`, rawContent)

    let result: unknown
    try {
      result = JSON.parse(rawContent)
    } catch {
      result = {}
    }

    const { feedbackByKey, normalizedLookup } = mapResultToFeedbackByKey(result)
    const mappedSummary = elements.reduce(
      (acc, element) => {
        acc[element.path] = normalizeFeedbackEntry(feedbackByKey[element.path]).length
        return acc
      },
      {} as Record<string, number>,
    )
    console.log(`🧭 Step 1 mapped feedback counts by element path (attempt ${attempt}/${maxAttempts}):`, mappedSummary)

    const missing = expectedKeys.filter((key) => (mappedSummary[key] ?? 0) === 0)
    if (missing.length > 0) {
      console.warn(`⚠️ Missing feedback for attempt ${attempt}/${maxAttempts}:`, missing)
      console.warn("⚠️ Raw keys seen:", Object.keys(normalizedLookup))
      lastFeedbackByKey = feedbackByKey
      lastMappedSummary = mappedSummary
      if (attempt < maxAttempts) continue
    }

    return feedbackByKey
  }

  console.warn("⚠️ Returning last Step 1 mapping after retries exhausted.")
  return lastFeedbackByKey
}

// ============================================================================
// STEP 2 — Suggestions + Reasons for ALL non-Effective elements (one call)
// ============================================================================

async function batchSuggestionsAndReasonsAll(
  elements: ElementEntry[],
  prompt: string  // ← add this
): Promise<{ suggestionsByPath: Record<string, string>; reasonsByPath: Record<string, string> }> {
  const needs = elements
    .map((e, i) => ({ ...e, originalIndex: i }))
    .filter(e => e.element.effectiveness !== "Effective")

  const suggestionsByPath = elements.reduce((acc, element) => {
    acc[element.path] = ""
    return acc
  }, {} as Record<string, string>)
  const reasonsByPath = elements.reduce((acc, element) => {
    acc[element.path] = ""
    return acc
  }, {} as Record<string, string>)

  if (needs.length === 0) {
    console.log("   ℹ️ All elements are Effective — skipping suggestions & reasons")
    return { suggestionsByPath, reasonsByPath }
  }

  const list = needs.map((e, i) => {
    const label = e.index !== undefined ? `${e.name} #${e.index + 1}` : e.name
    return `${i}. key=${e.path}\n   Label: ${label}\n   Original: "${e.element.text}"\n   Effectiveness: ${e.element.effectiveness}`
  }).join("\n\n")
  const expectedKeys = needs.map((n) => n.path)
  const expectedKeysBlock = expectedKeys.map((key) => `- ${key}`).join("\n")
  const expectedJsonLines = expectedKeys.map((key) => `    "${key}": {"suggestion":"...", "reason":"..."}`).join(",\n")
  const maxAttempts = 3

  const normalizeReason = (reason: unknown) => {
    if (typeof reason === "string") return reason
    if (!reason || typeof reason !== "object" || Array.isArray(reason)) return ""
    const reasonObj = reason as Record<string, unknown>
    return [reasonObj.rhetorical_function, reasonObj.reader_impact, reasonObj.text_quality]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .join(" ")
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a supportive writing teacher helping students improve their argumentative essays.

For EACH element below, provide TWO parts:

1. Suggestion (ENGLISH ONLY)
Essay prompt: """${prompt}"""
Write ONE clear and specific revision that directly improves the sentence or element.
Prefer rewriting the sentence or a concise portion of it rather than giving a general instruction.

Requirements for Suggestion:
- MUST be written in English.
- This should be a revision that could appear in the student's essay.
- Be concise and natural.

2. Reason (MANDARIN CHINESE ONLY)
Explain why the revision improves the argument.

Your explanation should reflect three aspects:
- 修辞功能: 这个论证要素在论证中的作用
- 读者影响: 它如何影响读者理解或说服力
- 文本质量: 它如何提升写作质量（如清晰度、连贯性、逻辑）。

Requirements for Reason:
- MUST be written entirely in Simplified Chinese.
- Do NOT write any English in this section.
- Use clear, student-friendly language.

Important language rules:
- Suggestion → English only
- Reason → Chinese only

You MUST return every key exactly once.
Do not skip keys.

Required keys:
${expectedKeysBlock}

Return JSON:
{
  "items_by_key": {
${expectedJsonLines}
  }
}

Return valid json only.`,
        },
        {
          role: "user",
          content: `Elements to improve:\n\n${list}`,
        },
      ],
    })

    const raw = completion.choices[0].message.content || "{}"
    console.log(`🧾 Step 2 suggestions raw JSON (attempt ${attempt}/${maxAttempts}):\n`, raw)
    let result: unknown
    try {
      result = JSON.parse(raw)
    } catch {
      result = {}
    }

    const byKey = (result as Record<string, unknown>)?.items_by_key
    if (byKey && typeof byKey === "object" && !Array.isArray(byKey)) {
      Object.entries(byKey as Record<string, unknown>).forEach(([path, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return
        const obj = value as Record<string, unknown>
        if (typeof obj.suggestion === "string") suggestionsByPath[path] = obj.suggestion
        reasonsByPath[path] = normalizeReason(obj.reason)
      })
    }

    const legacyItems = (result as Record<string, unknown>)?.items
    if (Array.isArray(legacyItems)) {
      legacyItems.forEach((item, index) => {
        const path = needs[index]?.path
        if (!path || !item || typeof item !== "object" || Array.isArray(item)) return
        const obj = item as Record<string, unknown>
        if (!suggestionsByPath[path] && typeof obj.suggestion === "string") suggestionsByPath[path] = obj.suggestion
        if (!reasonsByPath[path]) reasonsByPath[path] = normalizeReason(obj.reason)
      })
    }

    const missing = expectedKeys.filter((path) => !suggestionsByPath[path] || !reasonsByPath[path])
    if (missing.length > 0) {
      console.warn(`⚠️ Step 2 missing suggestion/reason for attempt ${attempt}/${maxAttempts}:`, missing)
      if (attempt < maxAttempts) continue
    }
    break
  }

  return { suggestionsByPath, reasonsByPath }
}

// ============================================================================
// MAIN CHAIN — 2 LLM calls total (after FT model)
// ============================================================================

async function runFeedbackChain(elements: ElementEntry[], prompt: string): Promise<Record<string, any>> {
  const start = Date.now()
  console.log(`\n🔗 Starting 2-step feedback chain for ${elements.length} elements`)

  const effectiveCounts = elements.reduce((acc, e) => {
    acc[e.element.effectiveness] = (acc[e.element.effectiveness] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log("📊 Effectiveness distribution:", effectiveCounts)

  // STEP 1: Feedback for ALL (1 call)
  console.log("\n📍 Step 1/2: Generating feedback for ALL elements...")
  const feedbackByKey = await batchFeedbackAll(elements, prompt)
  console.log(`✅ Step 1/2 complete (${Date.now() - start}ms)`)

  // STEP 2: Suggestions + Reasons for non-Effective (1 call)
  console.log("📍 Step 2/2: Generating suggestions + reasons for non-Effective elements...")
  const { suggestionsByPath, reasonsByPath } = await batchSuggestionsAndReasonsAll(elements, prompt)
  console.log(`✅ Step 2/2 complete (${Date.now() - start}ms)`)

  console.log(`\n🎉 Chain complete in ${Date.now() - start}ms`)

  return elements.reduce((acc, e) => {
    acc[e.path] = {
      ...e.element,
      feedback: normalizeFeedbackEntry(feedbackByKey[e.path]),
      suggestion: suggestionsByPath[e.path] || "",
      reason: reasonsByPath[e.path] || "",
    }
    return acc
  }, {} as Record<string, any>)
}

// ============================================================================
// FINE-TUNED MODEL SYSTEM PROMPT (XML output format)
// ============================================================================

const FT_SYSTEM_PROMPT = `Parse the following L2 argumentative essay into argumentative elements using XML tags.

Tag definitions:
L1 = Lead
P1 = Position
C1 = Claim
D1 = Evidence
CT1 = Counterclaim
CD1 = Counterargument_Evidence
R1 = Rebuttal
RD1 = Rebuttal_Evidence
S1 = Concluding Statement

Instructions:
- Wrap each argumentative element in its correct XML tag and include an effectiveness attribute.
- For each claim (C1), include id="claim-N".
- For each evidence (D1), include id="evidence-N" and parentClaimId="claim-N" referencing the claim it supports.
- Do not modify the original wording.
- Output only the tagged essay.`

// ============================================================================
// ROUTE HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  const totalStart = Date.now()

  try {
    const { essay, prompt } = await request.json()
    const FT_MODEL = process.env.FT_MODEL ?? "gpt-4o-mini"

    // ── FT Model: structure + effectiveness via XML ──────────────────────────
    let rawXML: string
    let modelUsed = FT_MODEL

    try {
      console.log("⚡ Using FT model:", modelUsed)
      const completion = await openai.chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FT_SYSTEM_PROMPT },
          { role: "user", content: `Prompt: ${prompt ?? ""}\n\nEssay:\n${essay}` },
        ],
      })
      rawXML = completion.choices[0].message.content ?? ""
    } catch (err: any) {
      console.warn("⚠️ FT model unavailable, falling back to gpt-4o-mini:", err.message)
      modelUsed = "gpt-4o-mini"
      const completion = await openai.chat.completions.create({
        model: modelUsed,
        messages: [
          { role: "system", content: FT_SYSTEM_PROMPT },
          { role: "user", content: `Prompt: ${prompt ?? ""}\n\nEssay:\n${essay}` },
        ],
      })
      rawXML = completion.choices[0].message.content ?? ""
    }

    console.log("🔍 Raw FT XML output:\n", rawXML)
    console.log(`⏱️ FT model: ${Date.now() - totalStart}ms`)

    // ── Parse XML → internal structure ──────────────────────────────────────
    const parsed = parseXMLOutput(rawXML)
    const parsedWithConditionalEvidenceSplit = await conditionalSplitEvidence(parsed)
    const enriched = enrichElements(parsedWithConditionalEvidenceSplit)

    // ── Run 2-step feedback chain ────────────────────────────────────────────
    const allElements = collectElements(enriched)
    const processedByPath = await runFeedbackChain(allElements, prompt ?? "")
    const finalResult = reconstructStructure(enriched, processedByPath)

    // ── Validate with Zod ────────────────────────────────────────────────────
    const validated = FeedbackResultSchema.safeParse(finalResult)
    if (!validated.success) {
      console.error("❌ Zod validation failed", validated.error.format())
      return NextResponse.json(
        { error: "Schema validation failed", issues: validated.error.format() },
        { status: 400 }
      )
    }

    console.log("🧾 /api/analyze-argument response JSON:\n", JSON.stringify(validated.data, null, 2))
    console.log(`🎉 TOTAL TIME: ${Date.now() - totalStart}ms`)
    return NextResponse.json(validated.data)
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

//   const completion = await openai.chat.completions.create({
//     model: "gpt-4o",
//     response_format: { type: "json_object" },
//     messages: [
//       {
//         role: "system",
//         content: `You are an expert writing coach providing constructive feedback.

// For EACH element below, provide 3-4 bullet points of indirect feedback.

// Rules:
// - If effectiveness is "Effective": 
//   * Give positive reinforcement
//   * Explain why the element is strong (clarity, persuasiveness, alignment)
//   * Include suggestions to improve even further
  
// - If "Adequate", "Ineffective", or "Missing": 
//   * Provide guidance for improvement
//   * Use <strong>...</strong> tags to highlight important concepts
//   * Be encouraging but specific
//   * Give reflective prompts that guide the student to revise
//   * Do NOT supply exact rewritten sentences or replacement words

// Example feedback point:
// "Your <strong>claim is clear</strong>, but instead of <strong>repeating it</strong> in every paragraph, state it once strongly in the introduction and let each body paragraph focus on <strong>one reason</strong>."

// Return JSON: {"feedback": [["point1", "point2", "point3"], ["point1", "point2", "point3"], ...]}`
//       },
//       {
//         role: "user",
//         content: `Elements with diagnoses:\n\n${elementsList}\n\nProvide feedback for each element in order:`
//       }
//     ]
//   })
  
//   const result = JSON.parse(completion.choices[0].message.content || '{"feedback": []}')
//   return result.feedback || []
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
//     feedback: feedbacks[i] || [],
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
