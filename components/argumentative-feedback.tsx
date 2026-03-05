"use client"

import { useMemo, useState, type ComponentProps } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Eye, Lightbulb, Sparkles, Target, TrendingUp, AlertTriangle, CheckCircle, ArrowBigRight, Info, HelpCircle } from "lucide-react"
import { ArgumentDiagram } from "./argument-diagram"
import type { AnalysisResult, ArgumentElement } from "@/lib/types"
import { SetupGuide } from "@/components/setup-guide"
import ReactMarkdown from "react-markdown"

interface ArgumentativeFeedbackProps {
  analysis: AnalysisResult | null
  essay: string
  isAnalyzing: boolean
  onHighlightText?: (text: string, effectiveness: string) => void
  onElementSelect?: (elementId: string | null) => void
  onFeedbackEvent?: (payload: {
    eventType: "level_viewed" | "suggestion_revealed"
    feedbackLevel: 2 | 3
    issueClientKey: string
    metadata: {
      source: "crossley_diagram_click" | "show_correction"
      elementId: string
      elementType: string
      elementIndex: number | null
    }
  }) => void
}

export function ArgumentativeFeedback({ analysis, essay, isAnalyzing, onHighlightText, onFeedbackEvent }: ArgumentativeFeedbackProps) {
  const [showDiagram, setShowDiagram] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [showCorrections, setShowCorrections] = useState<Set<string>>(new Set())

  const toggleCorrection = (elementId: string) => {
    const isOpening = !showCorrections.has(elementId)
    if (isOpening) {
      const parsed = parseElementId(elementId)
      const elementType = parsed.elementKey
      const elementIndex = parsed.index ?? null

      onFeedbackEvent?.({
        eventType: "level_viewed",
        feedbackLevel: 3,
        issueClientKey: elementId,
        metadata: {
          source: "show_correction",
          elementId,
          elementType,
          elementIndex,
        },
      })
      onFeedbackEvent?.({
        eventType: "suggestion_revealed",
        feedbackLevel: 3,
        issueClientKey: elementId,
        metadata: {
          source: "show_correction",
          elementId,
          elementType,
          elementIndex,
        },
      })
    }
    setShowCorrections((prev) => {
      const next = new Set(prev)
      if (next.has(elementId)) {
        next.delete(elementId)
      } else {
        next.add(elementId)
      }
      return next
    })
  }

  const getEffectivenessColor = (effectiveness: string) => {
    switch (effectiveness) {
      case "Effective":
        return "bg-green-100 text-green-800 border-green-200"
      case "Adequate":
        return "bg-yellow-100 text-yellow-800 border-yellow-200"
      case "Ineffective":
        return "bg-red-100 text-red-800 border-red-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  type ParsedElement = {
    elementKey: keyof AnalysisResult["elements"]
    index?: number
    correctionKey: string
  }

  // Parse only indexed claim/evidence IDs; keep single-node IDs exact.
  const parseElementId = (elementId: string): ParsedElement => {
    const indexedMatch = elementId.match(/^(claim|evidence)-(\d+)$/)
    if (indexedMatch) {
      const base = indexedMatch[1]
      const parsedIndex = parseInt(indexedMatch[2], 10)
      return {
        elementKey: base === "claim" ? "claims" : "evidence",
        index: parsedIndex,
        correctionKey: `${base}-${parsedIndex}`,
      }
    }

    return {
      elementKey: elementId as keyof AnalysisResult["elements"],
      correctionKey: elementId,
    }
  }

  const getElement = (parsed: ParsedElement): ArgumentElement | null => {
    if (!analysis) return null
    const element = analysis.elements[parsed.elementKey]
    if (Array.isArray(element)) {
      return parsed.index !== undefined ? element[parsed.index] ?? null : null
    }
    return (element as ArgumentElement) ?? null
  }

  const handleElementClick = (elementId: string) => {
    const parsed = parseElementId(elementId)
    const uniqueId = parsed.correctionKey
    setSelectedElement((prev) => (prev === uniqueId ? null : uniqueId))

    onFeedbackEvent?.({
      eventType: "level_viewed",
      feedbackLevel: 2,
      issueClientKey: uniqueId,
      metadata: {
        source: "crossley_diagram_click",
        elementId: uniqueId,
        elementType: parsed.elementKey,
        elementIndex: parsed.index ?? null,
      },
    })

    // Highlight text in essay if element has text
    const element = getElement(parsed)
    if (element && element.text && onHighlightText) {
      onHighlightText(element.text, element.effectiveness)
    }
  }

  const handleCardHover = (elementId: string, isHovering: boolean) => {
    if (isHovering) {
      setExpandedCard(elementId)
    } else {
      setExpandedCard(null)
    }
  }

  const selectedParsed = useMemo(
    () => (selectedElement ? parseElementId(selectedElement) : null),
    [selectedElement],
  )
  const currentElement = useMemo(
    () => (selectedParsed ? getElement(selectedParsed) : null),
    [selectedParsed, analysis],
  )
  const normalizedFeedbackItems = useMemo(() => {
    const raw = (currentElement as { feedback?: unknown } | null)?.feedback
    if (raw == null) return []

    const SECTION_ORDER = ["effective", "positive_reinforcement", "development", "issue", "reflection", "hint"] as const
    const SECTION_LABELS: Record<string, string> = {
      effective: "Effective",
      positive_reinforcement: "Positive Reinforcement",
      development: "Development",
      issue: "Issue",
      reflection: "Reflection",
      hint: "Hint",
    }

    const normalizeText = (value: unknown) =>
      String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .trim()

    const normalizeSectionKey = (value: string): string | undefined => {
      const normalized = value.toLowerCase().replace(/[\s-]+/g, "_").trim()
      if (normalized.includes("positive") && normalized.includes("reinforcement")) return "positive_reinforcement"
      if (normalized.startsWith("effective")) return "effective"
      if (normalized.startsWith("development")) return "development"
      if (normalized.startsWith("hint")) return "hint"
      if (normalized.startsWith("reflection")) return "reflection"
      if (normalized.startsWith("issue")) return "issue"
      return undefined
    }

    const splitBulletedLines = (value: string): string[] => {
      const lines = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      const bulletLikeCount = lines.filter((line) => /^([-*•]|\d+[.)])\s+/.test(line)).length
      return bulletLikeCount >= 2 ? lines : [value]
    }

    const splitBySectionLabels = (
      text: string,
      inheritedSection?: string,
    ): Array<{ section?: string; content: string }> => {
      const matches = [...text.matchAll(/(?:^|\n)\s*(effective|positive[\s_-]*reinforcement|development|hint|reflection|issue)\s*:/gim)]
      if (matches.length === 0) return [{ section: inheritedSection, content: text }]

      const result: Array<{ section?: string; content: string }> = []
      const firstStart = matches[0].index ?? 0
      const leading = text.slice(0, firstStart).trim()
      if (leading) result.push({ section: inheritedSection, content: leading })

      for (let i = 0; i < matches.length; i++) {
        const current = matches[i]
        const start = current.index ?? 0
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length
        const section = normalizeSectionKey(current[1]) ?? inheritedSection
        const chunk = text
          .slice(start + current[0].length, end)
          .trim()
        if (chunk) result.push({ section, content: chunk })
      }

      return result
    }

    const collected: Array<{ section?: string; content: string }> = []
    const collect = (value: unknown, sectionHint?: string) => {
      if (value == null) return

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        const text = normalizeText(value)
        if (!text) return
        const splitSections = splitBySectionLabels(text, sectionHint)
        splitSections.forEach((item) => {
          splitBulletedLines(item.content).forEach((piece) => {
            const normalized = normalizeText(piece)
            if (normalized) {
              collected.push({
                section: item.section,
                content: normalized,
              })
            }
          })
        })
        return
      }

      if (Array.isArray(value)) {
        value.forEach((entry) => collect(entry, sectionHint))
        return
      }

      if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        const orderedKeys = [
          "effective",
          "positive_reinforcement",
          "positiveReinforcement",
          "development",
          "issue",
          "reflection",
          "hint",
        ]
        const seen = new Set<string>()

        orderedKeys.forEach((key) => {
          if (!(key in obj)) return
          seen.add(key)
          collect(obj[key], normalizeSectionKey(key) ?? sectionHint)
        })

        Object.entries(obj).forEach(([key, entry]) => {
          if (seen.has(key)) return
          collect(entry, normalizeSectionKey(key) ?? sectionHint)
        })
      }
    }

    collect(raw)
    if (collected.length === 0) return []

    const orderIndex = new Map<string, number>(SECTION_ORDER.map((key, idx) => [key, idx]))
    const ordered = collected
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => {
        const aRank = a.section ? (orderIndex.get(a.section) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
        const bRank = b.section ? (orderIndex.get(b.section) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
        if (aRank !== bRank) return aRank - bRank
        return a.index - b.index
      })

    const seen = new Map<string, number>()
    const hash = (input: string) => {
      let h = 0
      for (let i = 0; i < input.length; i++) {
        h = (h << 5) - h + input.charCodeAt(i)
        h |= 0
      }
      return Math.abs(h).toString(36)
    }

    return ordered.map((entry) => {
      const label = entry.section ? SECTION_LABELS[entry.section] : undefined
      const signature = `${label ?? "unlabeled"}::${entry.content}`
      const count = seen.get(signature) ?? 0
      seen.set(signature, count + 1)
      return {
        id: `fb-${hash(signature)}-${count}`,
        content: entry.content,
        label,
      }
    })
  }, [currentElement?.feedback])

  const renderFeedbackContent = (textClassName: string) => {
    const markdownComponents = {
      strong: (props: ComponentProps<"strong">) => <strong className="font-semibold text-gray-900" {...props} />,
    }

    if (normalizedFeedbackItems.length > 1) {
      return (
        <ul className={`list-disc pl-5 mt-1 space-y-1 ${textClassName}`}>
          {normalizedFeedbackItems.map((item) => (
            <li key={item.id}>
              <ReactMarkdown skipHtml components={markdownComponents}>
                {item.label ? `**${item.label}:** ${item.content}` : item.content}
              </ReactMarkdown>
            </li>
          ))}
        </ul>
      )
    }

    const single = normalizedFeedbackItems[0]
    if (single) {
      return (
        <div className={`${textClassName} mt-1`}>
          <ReactMarkdown skipHtml components={markdownComponents}>
            {single.label ? `**${single.label}:** ${single.content}` : single.content}
          </ReactMarkdown>
        </div>
      )
    }

    return (
      <div className={`${textClassName} mt-1`}>
        <ReactMarkdown skipHtml>No feedback available.</ReactMarkdown>
      </div>
    )
  }
  const isOptionalCounterclaimEvidence = selectedParsed?.elementKey === "counterclaim_evidence"

  if (isAnalyzing) {
    return (
      <div className="p-6 space-y-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Analyzing argumentative structure...</p>
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="p-6 space-y-4">
        <Alert>
          <Target className="h-4 w-4" />
          <AlertDescription>
            Click "Analyze Essay" to get detailed feedback on your argumentative structure.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
      <SetupGuide />

        {/* Diagram and feedback card */}
          <div className="space-y-4">
            <ArgumentDiagram analysis={analysis} essay={essay} onElementClick={handleElementClick} />
            
            {selectedElement && currentElement && (
              <Card className="border-primary/20">
                <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                    <div className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4" />
                    <span>
                      {selectedParsed &&
                        selectedParsed.elementKey.charAt(0).toUpperCase() + selectedParsed.elementKey.slice(1)}
                      {selectedParsed?.index !== undefined && ` ${selectedParsed.index + 1}`} Feedback
                    </span>
                  </div>
                  <Badge className={getEffectivenessColor(currentElement.effectiveness)}>
                    {currentElement.effectiveness}
                  </Badge>
                </CardTitle>
                </CardHeader>
                <CardContent>
                  <div>
                    {/* ✅ If Effective → show Why This Works immediately */}
                    {currentElement.effectiveness === "Effective" ? (
                      <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
                        <h5 className="font-medium mb-2 text-green-800">Why This Works:</h5>
                        {renderFeedbackContent("text-sm text-green-700")}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {isOptionalCounterclaimEvidence && (
                          <p className="font-medium text-red-800 mb-2 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />该要素为可选，可根据需要补充。
                          </p>
                        )}
                        <Card className="bg-blue-50 border-blue-300">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="p-1.5 bg-primary/10 rounded-full">
                                <HelpCircle className="h-4 w-4 text-primary" />
                              </div>
                              <div className="flex-1">
                                <h5 className="font-semibold text-primary mb-2">
                                  To revise the{" "}
                                  <span className="font-bold">
                                    {selectedParsed &&
                                      selectedParsed.elementKey.charAt(0).toUpperCase() + selectedParsed.elementKey.slice(1)}
                                    {selectedParsed?.index !== undefined && ` ${selectedParsed.index + 1}`}
                                  </span>{" "}
                                  we suggest:
                                </h5>
                                <div className="bg-primary/5 p-3 rounded-lg border border-primary/10">
                                  {renderFeedbackContent("text-sm text-gray-700")}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        {/* 🔹 Button separated below */}
                        <div className="flex justify-end mt-2">
                          <Button
                            size="sm"
                            className="bg-white shadow-sm text-primary font-medium hover:bg-white hover:shadow-md hover:text-primary"
                            onClick={() => selectedParsed && toggleCorrection(selectedParsed.correctionKey)}
                          >
                            {selectedParsed && showCorrections.has(selectedParsed.correctionKey)
                              ? "Hide Correction"
                              : "Show Correction"}
                          </Button>
                        </div>

                        {selectedParsed &&
                          showCorrections.has(selectedParsed.correctionKey) &&
                          currentElement.suggestion && (
                            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-in slide-in-from-top-2 duration-200">
                              <h5 className="font-medium mb-2 text-red-800">
                                优化表达示例:
                              </h5>
                              <p className="text-sm text-red-700">
                                {currentElement.suggestion}
                              </p>
                            </div>
                          )}

                        {selectedParsed &&
                          showCorrections.has(selectedParsed.correctionKey) &&
                          currentElement.reason && (
                          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 animate-in slide-in-from-top-2 duration-200">
                            <h5 className="font-medium mb-2 text-amber-800">优化说明:</h5>
                            <p className="text-sm text-amber-700">{currentElement.reason}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>

              </Card>
            )}
          </div>
      </div>
    </div>
  )
}


// <CardContent>
//                   <div>
//                     {/* ✅ If Effective → show Why This Works immediately */}
//                     {currentElement.effectiveness === "Effective" ? (
//                       <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
//                       <h5 className="font-medium mb-2 text-green-800">Why This Works:</h5>
                  
//                       {Array.isArray(currentElement.feedback) ? (
//                         <ul className="list-disc pl-5 text-sm text-green-700 space-y-1">
//                           {currentElement.feedback.map((item: string, i: number) => (
//                             <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
//                           ))}
//                         </ul>
//                       ) : (
//                         <p
//                           className="text-sm text-green-700"
//                           dangerouslySetInnerHTML={{ __html: currentElement.feedback }}
//                         />
//                       )}
//                     </div>
//                     ) : (
                      
//                       /* ❌ For Adequate/Ineffective → keep Suggestions + toggle */
//                       <div className="p-3 rounded-lg border border-black cursor-pointer transition-all duration-200"
//                         onMouseEnter={() => handleCardHover(selectedElement, true)}
//                         onMouseLeave={() => handleCardHover(selectedElement, false)}
//                       >
//                         <p className="text-m text-black-700 font-medium">
//                           To revise the{" "}
//                           <span className="font-bold">
//                             {elementKey && elementKey.charAt(0).toUpperCase() + elementKey.slice(1)}
//                             {index !== undefined && ` ${index + 1}`}
//                           </span>{" "}
//                           we suggest:
//                         </p>

//                         {Array.isArray(currentElement.feedback) ? (
//                           <ul className="list-disc pl-5 text-sm text-black-600 mt-1 space-y-1">
//                             {currentElement.feedback.map((item: string, i: number) => (
//                               <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
//                             ))}
//                           </ul>
//                         ) : (
//                           <p
//                             className="text-sm text-black-600 mt-1"
//                             dangerouslySetInnerHTML={{ __html: currentElement.feedback }}
//                           />
//                         )}
                    
//                         <div className="flex justify-end mt-2">
//                           <Button
//                             variant="outline"
//                             size="sm"
//                             onClick={() => toggleCorrection(selectedElement)}
//                             className="text-sm"
//                           >
//                             {showCorrections.has(selectedElement) ? "Hide Correction" : "Show Correction"}
//                           </Button>
//                         </div>
//                           <div className="space-y-3">
//                             <Card className="bg-blue-50 border-blue-300">
//                               <CardContent className="p-4">
//                                 <div className="flex items-start gap-3">
//                                   <div className="p-1.5 bg-primary/10 rounded-full">
//                                     <HelpCircle className="h-4 w-4 text-primary" />
//                                   </div>
//                                   <div className="flex-1">
//                                     <h5 className="font-semibold text-primary mb-2">
//                                     To revise the{" "}
//                                     <span className="font-bold">
//                                       {elementKey && elementKey.charAt(0).toUpperCase() + elementKey.slice(1)}
//                                       {index !== undefined && ` ${index + 1}`}
//                                     </span>{" "}
//                                     we suggest:
//                                     </h5>
//                                     <p className="text-sm text-foreground/80 mb-3">
//                                     {Array.isArray(currentElement.feedback) ? (
//                                       <ul className="list-disc pl-5 text-sm text-black-600 mt-1 space-y-1">
//                                         {currentElement.feedback.map((item: string, i: number) => (
//                                           <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
//                                         ))}
//                                       </ul>
//                                     ) : (
//                                       <p
//                                         className="text-sm text-black-600 mt-1"
//                                         dangerouslySetInnerHTML={{ __html: currentElement.feedback }}
//                                       />
//                                     )}
//                                     </p>
                                  
//                                   </div>
//                                 </div>
                                  
                                  
//                               </CardContent>
//                             </Card>
//                             <div className="flex justify-end mt-2">
//                             <Button
//                               size="sm"
//                               className="bg-white shadow-sm text-primary font-medium hover:bg-white hover:shadow-md hover:text-primary"
//                               onClick={() => toggleCorrection(selectedElement)}
//                               >
//                               {showCorrections.has(selectedElement) ? "Hide Correction" : "Show Correction"}
//                             </Button>
//                           </div>
                              
//                         </div>


//                         {showCorrections.has(selectedElement) && currentElement.suggestions && (
//                           <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-in slide-in-from-top-2 duration-200">
//                             <h5 className="font-medium mb-2 text-red-800">Suggested Correction:</h5>
                            
//                             <ul className="text-sm space-y-1 text-red-700">
//                               {currentElement.suggestions}
//                             </ul>
//                           </div>
          
//                         )}
//                         {showCorrections.has(selectedElement) && currentElement.reason && (
//                           <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 animate-in slide-in-from-top-2 duration-200">
//                             <h5 className="font-medium mb-2 text-amber-800">Reason:</h5>
//                             <ul className="text-sm space-y-1 text-amber-700">
//                               {currentElement.reason}
//                             </ul>
//                           </div>
//                         )}
//                       </div>
//                     )}
//                   </div>
//                 </CardContent>
// "use client"
// import { useState } from "react"
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Button } from "@/components/ui/button"
// import { Badge } from "@/components/ui/badge"
// import { Alert, AlertDescription } from "@/components/ui/alert"
// import { Lightbulb, Sparkles, Target, ArrowBigRight } from "lucide-react"
// import { ArgumentDiagram } from "./argument-diagram"
// import type { AnalysisResult, ArgumentElement } from "@/lib/types"
// import { SetupGuide } from "@/components/setup-guide"

// interface ArgumentativeFeedbackProps {
//   analysis: AnalysisResult | null
//   essay: string
//   isAnalyzing: boolean
//   onHighlightText: (text: string) => void // Remove the optional marker
// }

// export function ArgumentativeFeedback({ analysis, essay, isAnalyzing, onHighlightText }: ArgumentativeFeedbackProps) {
//   const [showDiagram, setShowDiagram] = useState(false)
//   const [selectedElement, setSelectedElement] = useState<string | null>(null)
//   const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
//   const [expandedCard, setExpandedCard] = useState<string | null>(null)
//   const [showCorrections, setShowCorrections] = useState<Set<string>>(new Set())

//   if (isAnalyzing) {
//     return (
//       <div className="p-6 space-y-4">
//         <div className="text-center">
//           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
//           <p className="text-sm text-muted-foreground">Analyzing argumentative structure...</p>
//         </div>
//       </div>
//     )
//   }

//   if (!analysis) {
//     return (
//       <div className="p-6 space-y-4">
//         <Alert>
//           <Target className="h-4 w-4" />
//           <AlertDescription>
//             Click "Analyze Essay" to get detailed feedback on your argumentative structure.
//           </AlertDescription>
//         </Alert>
//       </div>
//     )
//   }

//   const toggleCorrection = (elementId: string) => {
//     const newShowCorrections = new Set(showCorrections)
//     if (newShowCorrections.has(elementId)) {
//       newShowCorrections.delete(elementId)
//     } else {
//       newShowCorrections.add(elementId)
//     }
//     setShowCorrections(newShowCorrections)
//   }

//   const getEffectivenessColor = (effectiveness: string) => {
//     switch (effectiveness) {
//       case "Effective":
//         return "bg-green-100 text-green-800 border-green-200"
//       case "Adequate":
//         return "bg-yellow-100 text-yellow-800 border-yellow-200"
//       case "Ineffective":
//         return "bg-red-100 text-red-800 border-red-200"
//       default:
//         return "bg-gray-100 text-gray-800 border-gray-200"
//     }
//   }

//   // Helper function to get element by key and index
//   const getElement = (elementKey: string, index?: number): ArgumentElement | null => {
//     console.log("[ArgumentativeFeedback] getElement called:", { elementKey, index })

//     // Convert singular diagram IDs to plural analysis keys
//     let analysisKey = elementKey
//     if (elementKey === "claim") analysisKey = "claims"
//     if (elementKey === "evidence") analysisKey = "evidence"

//     const element = analysis.elements[analysisKey as keyof typeof analysis.elements]
//     console.log("[ArgumentativeFeedback] Raw element from analysis:", element)

//     if (Array.isArray(element)) {
//       const result = index !== undefined ? element[index] || null : null
//       console.log("[ArgumentativeFeedback] Array element result:", result)
//       return result
//     }

//     console.log("[ArgumentativeFeedback] Single element result:", element)
//     return element as ArgumentElement
//   }

//   const handleElementClick = (elementId: string) => {
//     console.log("[ArgumentativeFeedback] Element clicked:", elementId)
//     console.log("[ArgumentativeFeedback] Analysis elements:", analysis.elements)

//     // Parse element ID to extract base name and index
//     const match = elementId.match(/^(.*?)-(\d+)$/)
//     let baseElementId: string
//     let index: number | undefined

//     if (match) {
//       baseElementId = match[1]
//       index = Number.parseInt(match[2], 10)
//       console.log("[ArgumentativeFeedback] Parsed array element:", { baseElementId, index })
//     } else {
//       baseElementId = elementId
//       index = undefined
//       console.log("[ArgumentativeFeedback] Single element:", baseElementId)
//     }

//     // Create unique identifier
//     const uniqueId = elementId
//     console.log("[ArgumentativeFeedback] Unique ID:", uniqueId)

//     setSelectedElement(selectedElement === uniqueId ? null : uniqueId)
//     setSelectedIndex(index !== undefined ? index : null)

//     // Highlight text in essay if element has text
//     const element = getElement(baseElementId, index)
//     console.log("[ArgumentativeFeedback] Retrieved element:", element)

//     if (element && element.text && onHighlightText) {
//       console.log("[ArgumentativeFeedback] Calling onHighlightText with:", element.text)
//       onHighlightText(element.text)
//     } else {
//       console.log("[ArgumentativeFeedback] Not calling onHighlightText:", {
//         hasElement: !!element,
//         hasText: element?.text,
//         hasCallback: !!onHighlightText
//       })
//     }
//   }

//   const handleCardHover = (elementId: string, isHovering: boolean) => {
//     if (isHovering) {
//       setExpandedCard(elementId)
//     } else {
//       setExpandedCard(null)
//     }
//   }

//   // Helper function to parse selected element ID
//   const parseSelectedElement = () => {
//     if (!selectedElement) return { elementKey: null, index: undefined }

//     const match = selectedElement.match(/^(.*?)-(\d+)$/)
//     if (match) {
//       const baseKey = match[1]
//       const index = Number.parseInt(match[2], 10)
//       const elementKey = baseKey === "claim" ? "claims" : baseKey === "evidence" ? "evidence" : baseKey
//       return { elementKey, index }
//     } else {
//       return { elementKey: selectedElement, index: undefined }
//     }
//   }

//   const { elementKey, index } = parseSelectedElement()
//   const currentElement = elementKey ? getElement(elementKey, index) : null

//   return (
//     <div className="h-full overflow-y-auto">
//       <div className="p-6 space-y-6">
//         <SetupGuide />

//         {/* Diagram and feedback card */}
//         <div className="space-y-4">
//           <ArgumentDiagram analysis={analysis} essay={essay} onElementClick={handleElementClick} />

//           {selectedElement && currentElement && (
//             <Card className="border-primary/20 bg-primary/5">
//               <CardHeader className="pb-3">
//                 <CardTitle className="flex items-center gap-2 text-base">
//                   <Lightbulb className="h-4 w-4" />
//                   {elementKey && elementKey.charAt(0).toUpperCase() + elementKey.slice(1)}
//                   {index !== undefined && ` ${index + 1}`} Feedback
//                 </CardTitle>
//               </CardHeader>

//               <CardContent>
//                 <div className="space-y-3">
//                   <div className="flex items-center gap-2">
//                     <Badge className={getEffectivenessColor(currentElement.effectiveness)}>
//                       {currentElement.effectiveness}
//                     </Badge>
//                   </div>

//                   {currentElement.text && (
//                     <div
//                       className="p-3 bg-muted rounded text-sm cursor-pointer hover:bg-muted/80"
//                       onClick={() => {
//                         console.log("[ArgumentativeFeedback] Text clicked, calling onHighlightText with:", currentElement.text)
//                         onHighlightText(currentElement.text)
//                       }}
//                     >
//                       "{currentElement.text}"
//                     </div>
//                   )}

//                   {/* ✅ If Effective → show Why This Works immediately */}
//                   {currentElement.effectiveness === "Effective" ? (
//                     <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
//                       <h5 className="font-medium mb-2 text-green-800">Why This Works:</h5>
//                       <ul className="text-sm space-y-1 text-green-700">{currentElement.suggestions}
//                         {/* {currentElement.suggestions?.map((suggestion, i) => (
//                           <li key={i} className="flex items-start gap-2">
//                             <Sparkles className="h-3 w-3 mt-0.5 flex-shrink-0" />
//                             {suggestion}
//                           </li>
//                         ))} */}
//                       </ul>
//                     </div>
//                   ) : (
//                     /* ❌ For Adequate/Ineffective → keep Suggestions + toggle */
//                     <div
//                       className="p-3 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer hover:bg-blue-100 transition-all duration-200"
//                       onMouseEnter={() => handleCardHover(selectedElement, true)}
//                       onMouseLeave={() => handleCardHover(selectedElement, false)}
//                     >
//                       <p className="text-sm text-blue-700 font-medium">Suggestions for Improvement</p>
//                       <p className="text-xs text-blue-600 mt-1">{currentElement.feedback}</p>

//                       {expandedCard === selectedElement && (
//                         <div className="mt-3 pt-3 border-t border-blue-200 animate-in slide-in-from-top-2 duration-200">
//                           <Button
//                             variant="outline"
//                             size="sm"
//                             onClick={(e) => {
//                               e.stopPropagation()
//                               toggleCorrection(selectedElement)
//                             }}
//                             className="text-xs"
//                           >
//                             {showCorrections.has(selectedElement) ? "Hide Correction" : "Show Correction"}
//                           </Button>
//                         </div>
//                       )}

//                       {showCorrections.has(selectedElement) && currentElement.suggestions && (
//                         <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-in slide-in-from-top-2 duration-200">
//                           <h5 className="font-medium mb-2 text-red-800">Suggested Correction:</h5>
//                           <ul className="text-sm space-y-1 text-red-700">{currentElement.suggestions}
//                             {/* {currentElement.suggestions.map((suggestion, i) => (
//                               <li key={i} className="flex items-start gap-2">
//                                 <ArrowBigRight className="h-3 w-3 mt-0.5 flex-shrink-0 strokeWidth=1.25" />
//                                 {suggestion}
//                               </li>
//                             ))} */}
//                           </ul>
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               </CardContent>
//             </Card>
//           )}
//         </div>
//       </div>
//     </div>
//   )
// }

// "use client"

// import { useState } from "react"
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Button } from "@/components/ui/button"
// import { Badge } from "@/components/ui/badge"
// import { Alert, AlertDescription } from "@/components/ui/alert"
// import { Lightbulb, Sparkles, Target, ArrowBigRight } from "lucide-react"
// import { ArgumentDiagram } from "./argument-diagram"
// import type { AnalysisResult, ArgumentElement } from "@/lib/types"
// import { SetupGuide } from "@/components/setup-guide"

// interface ArgumentativeFeedbackProps {
//   analysis: AnalysisResult | null
//   essay: string
//   isAnalyzing: boolean
//   onHighlightText?: (text: string) => void
// }

// export function ArgumentativeFeedback({ analysis, essay, isAnalyzing, onHighlightText }: ArgumentativeFeedbackProps) {
//   const [showDiagram, setShowDiagram] = useState(false)
//   const [selectedElement, setSelectedElement] = useState<string | null>(null)
//   const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
//   const [expandedCard, setExpandedCard] = useState<string | null>(null)
//   const [showCorrections, setShowCorrections] = useState<Set<string>>(new Set())

//   if (isAnalyzing) {
//     return (
//       <div className="p-6 space-y-4">
//         <div className="text-center">
//           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
//           <p className="text-sm text-muted-foreground">Analyzing argumentative structure...</p>
//         </div>
//       </div>
//     )
//   }

//   if (!analysis) {
//     return (
//       <div className="p-6 space-y-4">
//         <Alert>
//           <Target className="h-4 w-4" />
//           <AlertDescription>
//             Click "Analyze Essay" to get detailed feedback on your argumentative structure.
//           </AlertDescription>
//         </Alert>
//       </div>
//     )
//   }

//   const toggleCorrection = (elementId: string) => {
//     const newShowCorrections = new Set(showCorrections)
//     if (newShowCorrections.has(elementId)) {
//       newShowCorrections.delete(elementId)
//     } else {
//       newShowCorrections.add(elementId)
//     }
//     setShowCorrections(newShowCorrections)
//   }

//   const getEffectivenessColor = (effectiveness: string) => {
//     switch (effectiveness) {
//       case "Effective":
//         return "bg-green-100 text-green-800 border-green-200"
//       case "Adequate":
//         return "bg-yellow-100 text-yellow-800 border-yellow-200"
//       case "Ineffective":
//         return "bg-red-100 text-red-800 border-red-200"
//       default:
//         return "bg-gray-100 text-gray-800 border-gray-200"
//     }
//   }

//   // Helper function to get element by key and index
//   const getElement = (elementKey: string, index?: number): ArgumentElement | null => {
//     console.log("[ArgumentativeFeedback] getElement called:", { elementKey, index })

//     // Convert singular diagram IDs to plural analysis keys
//     let analysisKey = elementKey
//     if (elementKey === "claim") analysisKey = "claims"
//     if (elementKey === "evidence") analysisKey = "evidence"

//     const element = analysis.elements[analysisKey as keyof typeof analysis.elements]
//     console.log("[ArgumentativeFeedback] Raw element from analysis:", element)

//     if (Array.isArray(element)) {
//       const result = index !== undefined ? element[index] || null : null
//       console.log("[ArgumentativeFeedback] Array element result:", result)
//       return result
//     }

//     console.log("[ArgumentativeFeedback] Single element result:", element)
//     return element as ArgumentElement
//   }

//   const handleElementClick = (elementId: string) => {
//     console.log("[ArgumentativeFeedback] Element clicked:", elementId)
//     console.log("[ArgumentativeFeedback] Analysis elements:", analysis.elements)

//     // Parse element ID to extract base name and index
//     const match = elementId.match(/^(.*?)-(\d+)$/)
//     let baseElementId: string
//     let index: number | undefined

//     if (match) {
//       baseElementId = match[1]
//       index = Number.parseInt(match[2], 10)
//       console.log("[ArgumentativeFeedback] Parsed array element:", { baseElementId, index })
//     } else {
//       baseElementId = elementId
//       index = undefined
//       console.log("[ArgumentativeFeedback] Single element:", baseElementId)
//     }

//     // Create unique identifier
//     const uniqueId = elementId
//     console.log("[ArgumentativeFeedback] Unique ID:", uniqueId)

//     setSelectedElement(selectedElement === uniqueId ? null : uniqueId)
//     setSelectedIndex(index !== undefined ? index : null)

//     // Highlight text in essay if element has text
//     const element = getElement(baseElementId, index)
//     console.log("[ArgumentativeFeedback] Retrieved element:", element)

//     if (element && element.text && onHighlightText) {
//       onHighlightText(element.text)
//     }
//   }

//   const handleCardHover = (elementId: string, isHovering: boolean) => {
//     if (isHovering) {
//       setExpandedCard(elementId)
//     } else {
//       setExpandedCard(null)
//     }
//   }

//   // Helper function to parse selected element ID
//   // Helper function to parse selected element ID
//   const parseSelectedElement = () => {
//     if (!selectedElement) return { elementKey: null, index: undefined }

//     const match = selectedElement.match(/^(.*?)-(\d+)$/)
//     if (match) {
//       const baseKey = match[1]
//       const index = Number.parseInt(match[2], 10)
//       const elementKey = baseKey === "claim" ? "claims" : baseKey === "evidence" ? "evidence" : baseKey
//       return { elementKey, index }
//     } else {
//       return { elementKey: selectedElement, index: undefined }
//     }
//   }

//   const { elementKey, index } = parseSelectedElement()
//   const currentElement = elementKey ? getElement(elementKey, index) : null

//   return (
//     <div className="h-full overflow-y-auto">
//       <div className="p-6 space-y-6">
//         <SetupGuide />

//         {/* Diagram and feedback card */}
//         <div className="space-y-4">
//           <ArgumentDiagram analysis={analysis} essay={essay} onElementClick={handleElementClick} />

//           {selectedElement && currentElement && (
//             <Card className="border-primary/20 bg-primary/5">
//               <CardHeader className="pb-3">
//                 <CardTitle className="flex items-center gap-2 text-base">
//                   <Lightbulb className="h-4 w-4" />
//                   {elementKey && elementKey.charAt(0).toUpperCase() + elementKey.slice(1)}
//                   {index !== undefined && ` ${index + 1}`} Feedback
//                 </CardTitle>
//               </CardHeader>

//               <CardContent>
//                 <div className="space-y-3">
//                   <div className="flex items-center gap-2">
//                     <Badge className={getEffectivenessColor(currentElement.effectiveness)}>
//                       {currentElement.effectiveness}
//                     </Badge>
//                   </div>

//                   {currentElement.text && (
//                     <div
//                       className="p-3 bg-muted rounded text-sm cursor-pointer hover:bg-muted/80"
//                       onClick={() => onHighlightText?.(currentElement.text)}
//                     >
//                       "{currentElement.text}"
//                     </div>
//                   )}

//                   {/* ✅ If Effective → show Why This Works immediately */}
//                   {currentElement.effectiveness === "Effective" ? (
//                     <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
//                       <h5 className="font-medium mb-2 text-green-800">Why This Works:</h5>
//                       <ul className="text-sm space-y-1 text-green-700">
//                         {currentElement.suggestions?.map((suggestion, i) => (
//                           <li key={i} className="flex items-start gap-2">
//                             <Sparkles className="h-3 w-3 mt-0.5 flex-shrink-0" />
//                             {suggestion}
//                           </li>
//                         ))}
//                       </ul>
//                     </div>
//                   ) : (
//                     /* ❌ For Adequate/Ineffective → keep Suggestions + toggle */
//                     <div
//                       className="p-3 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer hover:bg-blue-100 transition-all duration-200"
//                       onMouseEnter={() => handleCardHover(selectedElement, true)}
//                       onMouseLeave={() => handleCardHover(selectedElement, false)}
//                     >
//                       <p className="text-sm text-blue-700 font-medium">Suggestions for Improvement</p>
//                       <p className="text-xs text-blue-600 mt-1">{currentElement.feedback}</p>

//                       {expandedCard === selectedElement && (
//                         <div className="mt-3 pt-3 border-t border-blue-200 animate-in slide-in-from-top-2 duration-200">
//                           <Button
//                             variant="outline"
//                             size="sm"
//                             onClick={(e) => {
//                               e.stopPropagation()
//                               toggleCorrection(selectedElement)
//                             }}
//                             className="text-xs"
//                           >
//                             {showCorrections.has(selectedElement) ? "Hide Correction" : "Show Correction"}
//                           </Button>
//                         </div>
//                       )}

//                       {showCorrections.has(selectedElement) && currentElement.suggestions && (
//                         <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-in slide-in-from-top-2 duration-200">
//                           <h5 className="font-medium mb-2 text-red-800">Suggested Correction:</h5>
//                           <ul className="text-sm space-y-1 text-red-700">
//                             {currentElement.suggestions.map((suggestion, i) => (
//                               <li key={i} className="flex items-start gap-2">
//                                 <ArrowBigRight className="h-3 w-3 mt-0.5 flex-shrink-0 strokeWidth=1.25" />
//                                 {suggestion}
//                               </li>
//                             ))}
//                           </ul>
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               </CardContent>
//             </Card>
//           )}
//         </div>
//       </div>
//     </div>
//   )
// }
