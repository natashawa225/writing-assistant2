"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Eye, Lightbulb, Sparkles, Target, TrendingUp, AlertTriangle, CheckCircle, ArrowBigRight } from "lucide-react"
import { ArgumentDiagram } from "./argument-diagram"
import type { AnalysisResult, ArgumentElement } from "@/lib/types"
import { SetupGuide } from "@/components/setup-guide"

interface ArgumentativeFeedbackProps {
  analysis: AnalysisResult | null
  essay: string
  isAnalyzing: boolean
  onHighlightText?: (text: string, effectiveness: string) => void
}

export function ArgumentativeFeedback({ analysis, essay, isAnalyzing, onHighlightText }: ArgumentativeFeedbackProps) {
  const [showDiagram, setShowDiagram] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [showCorrections, setShowCorrections] = useState<Set<string>>(new Set())

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

  const toggleCorrection = (elementId: string) => {
    const newShowCorrections = new Set(showCorrections)
    if (newShowCorrections.has(elementId)) {
      newShowCorrections.delete(elementId)
    } else {
      newShowCorrections.add(elementId)
    }
    setShowCorrections(newShowCorrections)
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

  // Helper function to get element by key and index
  const getElement = (elementKey: string, index?: number): ArgumentElement | null => {
    console.log("[ArgumentativeFeedback] getElement called:", { elementKey, index })
    
    // Convert singular diagram IDs to plural analysis keys
    let analysisKey = elementKey
    if (elementKey === 'claim') analysisKey = 'claims'
    if (elementKey === 'evidence') analysisKey = 'evidence'
    
    const element = analysis.elements[analysisKey as keyof typeof analysis.elements]
    console.log("[ArgumentativeFeedback] Raw element from analysis:", element)
    
    if (Array.isArray(element)) {
      const result = index !== undefined ? element[index] || null : null
      console.log("[ArgumentativeFeedback] Array element result:", result)
      return result
    }
    
    console.log("[ArgumentativeFeedback] Single element result:", element)
    return element as ArgumentElement
  }

  const handleElementClick = (elementId: string) => {
    console.log("[ArgumentativeFeedback] Element clicked:", elementId)
    console.log("[ArgumentativeFeedback] Analysis elements:", analysis.elements)
    
    // Parse element ID to extract base name and index
    const match = elementId.match(/^(.*?)-(\d+)$/)
    let baseElementId: string
    let index: number | undefined
    
    if (match) {
      baseElementId = match[1]
      index = parseInt(match[2], 10)
      console.log("[ArgumentativeFeedback] Parsed array element:", { baseElementId, index })
    } else {
      baseElementId = elementId
      index = undefined
      console.log("[ArgumentativeFeedback] Single element:", baseElementId)
    }
    
    // Create unique identifier
    const uniqueId = elementId
    console.log("[ArgumentativeFeedback] Unique ID:", uniqueId)
    
    setSelectedElement(selectedElement === uniqueId ? null : uniqueId)
    setSelectedIndex(index !== undefined ? index : null)

    // Highlight text in essay if element has text
    const element = getElement(baseElementId, index)
    console.log("[ArgumentativeFeedback] Retrieved element:", element)
    
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

  // Helper function to parse selected element ID
  const parseSelectedElement = () => {
    if (!selectedElement) return { elementKey: null, index: undefined }
    
    const match = selectedElement.match(/^(.*?)-(\d+)$/)
    if (match) {
      const baseKey = match[1]
      const index = parseInt(match[2], 10)
      const elementKey = baseKey === 'claim' ? 'claims' : baseKey === 'evidence' ? 'evidence' : baseKey
      return { elementKey, index }
    } else {
      return { elementKey: selectedElement, index: undefined }
    }
  }


  const { elementKey, index } = parseSelectedElement()
  const currentElement = elementKey ? getElement(elementKey, index) : null

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
      <SetupGuide />

        {/* Diagram and feedback card */}
          <div className="space-y-4">
            <ArgumentDiagram analysis={analysis} essay={essay} onElementClick={handleElementClick} />
            
            {selectedElement && currentElement && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Lightbulb className="h-4 w-4" />
                    {elementKey && elementKey.charAt(0).toUpperCase() + elementKey.slice(1)}
                    {index !== undefined && ` ${index + 1}`} Feedback
                  </CardTitle>
                </CardHeader>

                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge className={getEffectivenessColor(currentElement.effectiveness)}>
                        {currentElement.effectiveness}
                      </Badge>
                    </div>

                    {currentElement.text && (
                      <div
                        className="p-3 bg-muted rounded text-sm cursor-pointer hover:bg-muted/80"
                        onClick={() => onHighlightText?.(currentElement.text, currentElement.effectiveness)}
                      >
                        "{currentElement.text}"
                      </div>
                    )}

                    {/* ✅ If Effective → show Why This Works immediately */}
                    {currentElement.effectiveness === "Effective" ? (
                      <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
                        <h5 className="font-medium mb-2 text-green-800">Why This Works:</h5>
                        <ul className="text-sm space-y-1 text-green-700">{currentElement.suggestions}
                          {/* {currentElement.suggestions?.map((suggestion, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <Sparkles className="h-3 w-3 mt-0.5 flex-shrink-0" />
                              {suggestion}
                            </li>
                          ))} */}
                        </ul>
                      </div>
                    ) : (
                      /* ❌ For Adequate/Ineffective → keep Suggestions + toggle */
                      <div
                        className="p-3 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer hover:bg-blue-100 transition-all duration-200"
                        onMouseEnter={() => handleCardHover(selectedElement, true)}
                        onMouseLeave={() => handleCardHover(selectedElement, false)}
                      >
                        <p className="text-m text-blue-700 font-medium">Suggestions for Improvement</p>
                        <p className="text-sm text-blue-600 mt-1">{currentElement.feedback}</p>

                        {expandedCard === selectedElement && (
                          <div className="mt-3 pt-3 border-t border-blue-200 animate-in slide-in-from-top-2 duration-200">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleCorrection(selectedElement)
                              }}
                              className="text-xs"
                            >
                              {showCorrections.has(selectedElement) ? "Hide Correction" : "Show Correction"}
                            </Button>
                          </div>
                        )}

                        {showCorrections.has(selectedElement) && currentElement.suggestions && (
                          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 animate-in slide-in-from-top-2 duration-200">
                            <h5 className="font-medium mb-2 text-red-800">Suggested Correction:</h5>
                            
                            <ul className="text-sm space-y-1 text-red-700">
                              {currentElement.suggestions}
                            </ul>
                          </div>
          
                        )}
                        {showCorrections.has(selectedElement) && currentElement.suggestions && (
                          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 animate-in slide-in-from-top-2 duration-200">
                            <h5 className="font-medium mb-2 text-amber-800">Reason:</h5>
                            <ul className="text-sm space-y-1 text-amber-700">
                              {currentElement.reason}
                            </ul>
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
