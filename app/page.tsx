"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PromptSelector } from "@/components/prompt-selector"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getOrCreateSessionId } from "@/lib/deviceId"
import { EssayEditor } from "@/components/essay-editor"
import { FeedbackPanel } from "@/components/feedback-panel"
import { analyzeArgumentativeStructure } from "@/lib/analysis"
import type { AnalysisResult, LexicalAnalysis, Highlight } from "@/lib/types"
import { Sparkles, BookOpen, Send } from "lucide-react"

type InteractionEventType =
  | "initial_draft"
  | "edit"
  | "feedback_level_1"
  | "feedback_level_2"
  | "feedback_level_3"
  | "analyze_clicked"
  | "final_submission"

interface RevisionBehaviorData {
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

export default function ArgumentativeWritingAssistant() {
  const [essay, setEssay] = useState("")
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(480)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [argumentAnalysis, setArgumentAnalysis] = useState<AnalysisResult | null>(null)
  const [lexicalAnalysis, setLexicalAnalysis] = useState<LexicalAnalysis | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("argumentative")
  const [activeSubTab, setActiveSubTab] = useState<string>("")
  const [currentHighlight, setCurrentHighlight] = useState<{
    text: string
    effectiveness: string
  } | null>(null)
  const [selectedPrompt, setSelectedPrompt] = useState<string>("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [hasLoggedInitialDraft, setHasLoggedInitialDraft] = useState(false)
  const [analyzeClickedAt, setAnalyzeClickedAt] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [showInsightsModal, setShowInsightsModal] = useState(false)
  const [revisionInsights, setRevisionInsights] = useState<string>("")
  const [revisionData, setRevisionData] = useState<RevisionBehaviorData | null>(null)

  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastLoggedEssayRef = useRef("")

  useEffect(() => {
    const id = getOrCreateSessionId()
    setSessionId(id)
  }, [])

  useEffect(() => {
    if (!analyzeClickedAt || isSubmitted) return

    const interval = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => clearInterval(interval)
  }, [analyzeClickedAt, isSubmitted])

  const logInteraction = useCallback(
    async ({
      eventType,
      essayText,
      feedbackLevel,
      metadata,
    }: {
      eventType: InteractionEventType
      essayText?: string
      feedbackLevel?: number
      metadata?: Record<string, unknown>
    }) => {
      if (!sessionId) return

      try {
        await fetch("/api/interaction-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            event_type: eventType,
            essay_text: essayText ?? essay,
            feedback_level: feedbackLevel ?? null,
            metadata: metadata ?? null,
          }),
        })
      } catch (error) {
        console.error("Failed to log interaction", error)
      }
    },
    [essay, sessionId],
  )

  useEffect(() => {
    if (!analyzeClickedAt || !sessionId || isSubmitted) return
    if (!essay.trim()) return
    if (essay === lastLoggedEssayRef.current) return

    if (editDebounceRef.current) {
      clearTimeout(editDebounceRef.current)
    }

    editDebounceRef.current = setTimeout(async () => {
      await logInteraction({
        eventType: "edit",
        essayText: essay,
        metadata: { source: "autosave_30s" },
      })
      lastLoggedEssayRef.current = essay
    }, 30000)

    return () => {
      if (editDebounceRef.current) {
        clearTimeout(editDebounceRef.current)
      }
    }
  }, [essay, analyzeClickedAt, sessionId, isSubmitted, logInteraction])

  const handleAnalyze = async () => {
    if (!essay.trim() || isSubmitted) return

    setIsAnalyzing(true)
    setIsPanelOpen(true)

    try {
      if (!hasLoggedInitialDraft) {
        await logInteraction({ eventType: "initial_draft", essayText: essay })
        setHasLoggedInitialDraft(true)
      }

      await logInteraction({ eventType: "analyze_clicked", essayText: essay })

      if (!analyzeClickedAt) {
        setAnalyzeClickedAt(new Date().toISOString())
      }

      lastLoggedEssayRef.current = essay

      const argResult = await analyzeArgumentativeStructure(essay, selectedPrompt)
      setArgumentAnalysis(argResult)

      const newHighlights: Highlight[] = []

      Object.entries(argResult.elements).forEach(([key, element]) => {
        if (Array.isArray(element)) {
          element.forEach((el, index) => {
            if (el.text && el.text.trim()) {
              const start = essay.indexOf(el.text)
              if (start !== -1) {
                newHighlights.push({
                  id: `${key}-${index}`,
                  elementId: key,
                  start,
                  end: start + el.text.length,
                  text: el.text,
                  type: "argument",
                  subtype: key,
                  color: getHighlightColor(el.effectiveness),
                  feedback: el.feedback,
                  persistent: true,
                })
              }
            }
          })
        } else if (element.text && element.text.trim()) {
          const start = essay.indexOf(element.text)
          if (start !== -1) {
            newHighlights.push({
              id: key,
              elementId: key,
              start,
              end: start + element.text.length,
              text: element.text,
              type: "argument",
              subtype: key,
              color: getHighlightColor(element.effectiveness),
              feedback: element.feedback,
              persistent: true,
            })
          }
        }
      })

      setHighlights(newHighlights)
    } catch (error) {
      console.error("Analysis failed", error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSubmit = async () => {
    if (!sessionId || !canSubmit || isSubmitting || isSubmitted) return

    setIsSubmitting(true)

    try {
      const response = await fetch("/api/finalize-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          final_essay_text: essay,
        }),
      })

      if (!response.ok) {
        throw new Error("Submit failed")
      }

      const payload = await response.json()
      setRevisionInsights(payload.summary ?? "")
      setRevisionData((payload.revision_data as RevisionBehaviorData) ?? null)
      setIsSubmitted(true)
      setShowInsightsModal(true)
    } catch (error) {
      console.error("Final submission failed", error)
      alert("Failed to finalize session. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const getHighlightColor = (effectiveness: string) => {
    switch (effectiveness) {
      case "Effective":
        return "bg-green-200 border-green-300"
      case "Adequate":
        return "bg-yellow-200 border-yellow-300"
      case "Ineffective":
        return "bg-red-200 border-red-300"
      default:
        return "bg-gray-200 border-gray-300"
    }
  }

  const handleHighlightClick = (highlight: Highlight) => {
    setIsPanelOpen(true)
    setSelectedElementId(highlight.elementId)
  }

  const handleHighlightText = (text: string, effectiveness?: string) => {
    setCurrentHighlight({ text, effectiveness: effectiveness ?? "" })
    setSelectedElementId(text)
  }

  const handleElementSelect = (elementId: string | null) => {
    setSelectedElementId(elementId)
  }

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    if (tab === "argumentative") {
      setSelectedElementId(null)
      setActiveSubTab("")
    } else if (tab === "lexical") {
      setSelectedElementId(null)
      setActiveSubTab("academic-coverage")
    }
  }

  const handleSubTabChange = (subTab: string) => {
    setActiveSubTab(subTab)
  }

  const handleFeedbackLevelTriggered = useCallback(
    (level: 1 | 2 | 3, cardId: string) => {
      void logInteraction({
        eventType: `feedback_level_${level}`,
        essayText: essay,
        feedbackLevel: level,
        metadata: { cardId },
      })
    },
    [essay, logInteraction],
  )

  const wordCount = essay.trim().split(/\s+/).filter(Boolean).length
  const analyzeAtMs = analyzeClickedAt ? Date.parse(analyzeClickedAt) : null
  const submitUnlockAtMs = analyzeAtMs ? analyzeAtMs + 5 * 60 * 1000 : null

  const canSubmit = useMemo(() => {
    if (!submitUnlockAtMs || isSubmitted) return false
    return nowMs >= submitUnlockAtMs
  }, [submitUnlockAtMs, nowMs, isSubmitted])

  const remainingMs = submitUnlockAtMs ? Math.max(0, submitUnlockAtMs - nowMs) : 5 * 60 * 1000
  const remainingMinutes = Math.floor(remainingMs / 60000)
  const remainingSeconds = Math.floor((remainingMs % 60000) / 1000)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">Revisage Analytics</h1>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleAnalyze}
                disabled={isAnalyzing || wordCount < 200 || isSubmitted}
                className="flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {isAnalyzing ? "Analyzing..." : "Analyze Essay"}
              </Button>

              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting || isSubmitted}
                className="flex items-center gap-2"
                variant="default"
              >
                <Send className="h-4 w-4" />
                {isSubmitting ? "Submitting..." : "Submit / Finish Session"}
              </Button>
            </div>
          </div>

          <Separator className="my-3" />

          <div className="text-sm text-muted-foreground">
            {!analyzeClickedAt && "Submit is locked until Analyze Essay is clicked and 5 minutes pass."}
            {analyzeClickedAt && !canSubmit &&
              `Submit unlocks in ${remainingMinutes}:${remainingSeconds.toString().padStart(2, "0")}.`}
            {canSubmit && !isSubmitted && "Submit is unlocked."}
            {isSubmitted && "Session finalized. Editing is disabled."}
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-120px)]">
        <div
          className="flex-1 flex flex-col h-full p-4 space-y-4"
          style={{ width: isPanelOpen ? `calc(100% - ${panelWidth}px)` : "100%" }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Select Essay Prompt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PromptSelector onPromptSelect={setSelectedPrompt} selectedPrompt={selectedPrompt} />
            </CardContent>
          </Card>

          <EssayEditor
            essay={essay}
            onEssayChange={setEssay}
            highlights={highlights}
            onHighlightClick={handleHighlightClick}
            selectedElementId={selectedElementId}
            activeTab={activeTab}
            activeSubTab={activeSubTab}
            currentHighlight={currentHighlight}
            isLocked={isSubmitted}
          />
        </div>

        <FeedbackPanel
          isOpen={isPanelOpen}
          onToggle={() => setIsPanelOpen(!isPanelOpen)}
          panelWidth={panelWidth}
          onPanelWidthChange={setPanelWidth}
          argumentAnalysis={argumentAnalysis}
          lexicalAnalysis={lexicalAnalysis}
          essay={essay}
          isAnalyzing={isAnalyzing}
          onHighlightText={handleHighlightText}
          onElementSelect={handleElementSelect}
          onTabChange={handleTabChange}
          onSubTabChange={handleSubTabChange}
          onFeedbackLevelTriggered={handleFeedbackLevelTriggered}
        />
      </div>

      <Dialog open={showInsightsModal} onOpenChange={setShowInsightsModal}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revision Insights</DialogTitle>
          </DialogHeader>

          {revisionData && (
            <div className="text-sm text-muted-foreground space-y-1 mb-4">
              <p>Revisions made: {revisionData.totalEditsAfterAnalyze}</p>
              <p>
                Feedback levels: L1 {revisionData.feedbackLevelCounts.level1}, L2 {revisionData.feedbackLevelCounts.level2},
                L3 {revisionData.feedbackLevelCounts.level3}
              </p>
              <p>Revision window: {revisionData.revisionWindowMinutes} minutes</p>
            </div>
          )}

          <div className="whitespace-pre-wrap text-sm leading-relaxed">{revisionInsights}</div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
