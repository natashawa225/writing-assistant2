export type InteractionEventType =
  | "initial_draft"
  | "edit"
  | "feedback_level_1"
  | "feedback_level_2"
  | "feedback_level_3"
  | "analyze_clicked"
  | "final_submission"

export interface InteractionLogRow {
  id: number
  session_id: string
  timestamp: string
  event_type: InteractionEventType
  essay_text: string | null
  feedback_level: number | null
  metadata: Record<string, unknown> | null
}

interface InsertInteractionLogInput {
  session_id: string
  event_type: InteractionEventType
  essay_text?: string | null
  feedback_level?: number | null
  metadata?: Record<string, unknown> | null
  timestamp?: string
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase environment is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
  }

  return { supabaseUrl, serviceRoleKey }
}

export async function insertInteractionLog(input: InsertInteractionLogInput): Promise<InteractionLogRow> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const response = await fetch(`${supabaseUrl}/rest/v1/interaction_logs`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      session_id: input.session_id,
      event_type: input.event_type,
      essay_text: input.essay_text ?? null,
      feedback_level: input.feedback_level ?? null,
      metadata: input.metadata ?? null,
      timestamp: input.timestamp ?? new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to insert interaction log: ${response.status} ${body}`)
  }

  const rows = (await response.json()) as InteractionLogRow[]
  return rows[0]
}

export async function getSessionLogs(sessionId: string): Promise<InteractionLogRow[]> {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig()

  const url = new URL(`${supabaseUrl}/rest/v1/interaction_logs`)
  url.searchParams.set("session_id", `eq.${sessionId}`)
  url.searchParams.set("select", "id,session_id,timestamp,event_type,essay_text,feedback_level,metadata")
  url.searchParams.set("order", "timestamp.asc")

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to fetch interaction logs: ${response.status} ${body}`)
  }

  return (await response.json()) as InteractionLogRow[]
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? []
}

function jaccardSimilarity(a: string, b: string): number {
  const aSet = new Set(tokenize(a))
  const bSet = new Set(tokenize(b))

  if (aSet.size === 0 && bSet.size === 0) return 1
  if (aSet.size === 0 || bSet.size === 0) return 0

  let intersection = 0
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1
  }

  const union = aSet.size + bSet.size - intersection
  return union === 0 ? 1 : intersection / union
}

function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ""
  const match = trimmed.match(/[^.!?]+[.!?]?/)
  return (match?.[0] ?? trimmed).trim()
}

function countMarkers(text: string, markers: string[]): number {
  const lower = text.toLowerCase()
  return markers.reduce((sum, marker) => {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`\\b${escaped}\\b`, "g")
    return sum + (lower.match(regex)?.length ?? 0)
  }, 0)
}

function sectionLabel(index: number, total: number): string {
  if (index === 0) return "introduction"
  if (index === total - 1) return "conclusion"
  return `body_paragraph_${index}`
}

function sectionChangeMagnitude(a: string, b: string): number {
  const aTokens = tokenize(a)
  const bTokens = tokenize(b)
  const aSet = new Set(aTokens)
  const bSet = new Set(bTokens)

  let symmetricDelta = 0
  for (const token of aSet) {
    if (!bSet.has(token)) symmetricDelta += 1
  }
  for (const token of bSet) {
    if (!aSet.has(token)) symmetricDelta += 1
  }

  return Math.abs(aTokens.length - bTokens.length) + symmetricDelta
}

export interface RevisionBehaviorData {
  totalEditsAfterAnalyze: number
  feedbackLevelCounts: {
    level1: number
    level2: number
    level3: number
  }
  revisionWindowMinutes: number
  thesisChangedSignificantly: boolean
  claimEvidenceStructureChanged: boolean
  mostRevisedSections: string[]
  firstDraftWordCount: number
  finalDraftWordCount: number
  firstToFinalWordDelta: number
  totalLogsAnalyzed: number
}

export function buildRevisionBehaviorData(logs: InteractionLogRow[]): RevisionBehaviorData {
  const analyzeLog = logs.find((log) => log.event_type === "analyze_clicked")
  const finalSubmissionLog = [...logs].reverse().find((log) => log.event_type === "final_submission")
  const firstDraftLog = logs.find((log) => log.event_type === "initial_draft")

  const analyzeTime = analyzeLog ? Date.parse(analyzeLog.timestamp) : Date.now()
  const finalTime = finalSubmissionLog ? Date.parse(finalSubmissionLog.timestamp) : Date.now()

  const logsAfterAnalyze = logs.filter((log) => Date.parse(log.timestamp) >= analyzeTime)
  const editLogs = logsAfterAnalyze.filter((log) => log.event_type === "edit")

  const feedbackLevelCounts = {
    level1: logsAfterAnalyze.filter((log) => log.event_type === "feedback_level_1").length,
    level2: logsAfterAnalyze.filter((log) => log.event_type === "feedback_level_2").length,
    level3: logsAfterAnalyze.filter((log) => log.event_type === "feedback_level_3").length,
  }

  const firstDraftText = firstDraftLog?.essay_text ?? ""
  const finalDraftText = finalSubmissionLog?.essay_text ?? ""

  const firstThesis = firstSentence(firstDraftText)
  const finalThesis = firstSentence(finalDraftText)
  const thesisSimilarity = jaccardSimilarity(firstThesis, finalThesis)
  const thesisChangedSignificantly = thesisSimilarity < 0.55

  const claimMarkers = ["claim", "argue", "because", "therefore", "should", "must", "position", "thesis"]
  const evidenceMarkers = [
    "for example",
    "for instance",
    "according to",
    "evidence",
    "study",
    "research",
    "data",
    "statistic",
  ]

  const firstClaimCount = countMarkers(firstDraftText, claimMarkers)
  const finalClaimCount = countMarkers(finalDraftText, claimMarkers)
  const firstEvidenceCount = countMarkers(firstDraftText, evidenceMarkers)
  const finalEvidenceCount = countMarkers(finalDraftText, evidenceMarkers)

  const claimEvidenceStructureChanged =
    Math.abs(firstClaimCount - finalClaimCount) >= 2 || Math.abs(firstEvidenceCount - finalEvidenceCount) >= 2

  const sectionScores = new Map<string, number>()
  const snapshots = logsAfterAnalyze
    .map((log) => log.essay_text)
    .filter((text): text is string => Boolean(text && text.trim()))

  for (let i = 1; i < snapshots.length; i += 1) {
    const prev = snapshots[i - 1]
    const next = snapshots[i]

    const prevSections = prev.split(/\n\s*\n/).map((s) => s.trim())
    const nextSections = next.split(/\n\s*\n/).map((s) => s.trim())
    const maxSections = Math.max(prevSections.length, nextSections.length)

    for (let sectionIndex = 0; sectionIndex < maxSections; sectionIndex += 1) {
      const prevSection = prevSections[sectionIndex] ?? ""
      const nextSection = nextSections[sectionIndex] ?? ""
      const change = sectionChangeMagnitude(prevSection, nextSection)

      if (change === 0) continue

      const label = sectionLabel(sectionIndex, Math.max(nextSections.length, 1))
      sectionScores.set(label, (sectionScores.get(label) ?? 0) + change)
    }
  }

  const mostRevisedSections = [...sectionScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([section]) => section)

  const firstDraftWordCount = tokenize(firstDraftText).length
  const finalDraftWordCount = tokenize(finalDraftText).length

  return {
    totalEditsAfterAnalyze: editLogs.length,
    feedbackLevelCounts,
    revisionWindowMinutes: Math.max(0, Math.round((finalTime - analyzeTime) / 60000)),
    thesisChangedSignificantly,
    claimEvidenceStructureChanged,
    mostRevisedSections,
    firstDraftWordCount,
    finalDraftWordCount,
    firstToFinalWordDelta: finalDraftWordCount - firstDraftWordCount,
    totalLogsAnalyzed: logsAfterAnalyze.length,
  }
}
