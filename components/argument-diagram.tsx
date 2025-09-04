"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, XCircle, AlertTriangle, Info, Eye, Sparkles } from "lucide-react"
import type { AnalysisResult, ArgumentElement } from "@/lib/types"

interface ArgumentDiagramProps {
  analysis: AnalysisResult
  essay: string
  onElementClick?: (elementId: string) => void
}

export function ArgumentDiagram({ analysis, essay, onElementClick }: ArgumentDiagramProps) {
  const [selectedElement, setSelectedElement] = useState<string | null>(null)

  const getElementStyle = (effectiveness: string, found: boolean) => {
    if (!found) {
      return "bg-gray-200 border-gray-400 border-dashed text-gray-500"
    }

    switch (effectiveness) {
      case "Effective":
        return "bg-gradient-to-br from-green-100 to-green-200 border-green-400 text-green-800 shadow-lg"
      case "Adequate":
        return "bg-gradient-to-br from-yellow-100 to-yellow-200 border-yellow-400 text-yellow-800 shadow-lg"
      case "Ineffective":
        return "bg-gradient-to-br from-red-100 to-red-200 border-red-400 text-red-800 shadow-lg"
      default:
        return "bg-gray-100 border-gray-400 text-gray-800"
    }
  }

  const getEffectivenessIcon = (effectiveness: string, found: boolean) => {
    if (!found) return <XCircle className="h-4 w-4 text-gray-500" />

    switch (effectiveness) {
      case "Effective":
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case "Adequate":
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />
      case "Ineffective":
        return <XCircle className="h-4 w-4 text-red-600" />
      default:
        return <Info className="h-4 w-4 text-gray-600" />
    }
  }

  const DiagramElement = ({
    id,
    label,
    element,
    className = "",
    style = {},
  }: {
    id: string
    label: string
    element: ArgumentElement
    className?: string
    style?: React.CSSProperties
  }) => {
    const isSelected = selectedElement === id
    const found = element.text !== "" || element.effectiveness !== "Missing"

    return (
      <div
        className={`absolute border-2 rounded-lg p-3 min-w-[120px] text-center cursor-pointer transition-all hover:shadow-xl hover:scale-105 ${getElementStyle(
          element.effectiveness,
          found,
        )} ${isSelected ? "ring-2 ring-purple-500 ring-offset-2" : ""} ${className}`}
        style={style}
        onClick={() => {
          const newSelected = isSelected ? null : id
          setSelectedElement(newSelected)
          onElementClick?.(id)
        }}
      >
        <div className="font-bold text-sm mb-1">{label}</div>
        <div className="flex justify-center items-center gap-1 mb-1">
          {getEffectivenessIcon(element.effectiveness, found)}
          <span className="text-xs font-medium">{found ? element.effectiveness : "Missing"}</span>
        </div>
        {found && element.text && (
          <div className="text-xs italic truncate max-w-[100px]" title={element.text}>
            "{element.text.substring(0, 25)}..."
          </div>
        )}
      </div>
    )
  }

  const missingElements = Object.entries(analysis.elements)
    .filter(([_, element]) =>
      Array.isArray(element)
        ? element.some((el) => el.effectiveness === "Missing")
        : element.effectiveness === "Missing",
    )
    .map(([key, _]) => key)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Visual Argument Structure
        </CardTitle>
        <p className="text-sm">
          Interactive diagram showing your essay's argumentative structure based on the Crossley model. Missing elements
          are greyed out.
        </p>
      </CardHeader>
      <CardContent className="p-6">
        <div className="relative w-full h-[700px] bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-purple-200 rounded-lg overflow-hidden shadow-inner">
          {/* SVG for arrows - matching the Crossley diagram exactly */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="#6b7280" />
              </marker>
              <marker id="arrowhead-bidirectional" markerWidth="7" markerHeight="7" refX="7" refY="3" orient="auto">
                <polygon points="7 0, 0 3, 7 7" fill="#6b7280" />
              </marker>
            </defs>

            {/* Hierarchical arrows - Position to Lead */}
            <line x1="460" y1="150" x2="460" y2="85" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Claims/Counterclaim to Position */}
            <line x1="210" y1="260" x2="210" y2="210" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="460" y1="260" x2="460" y2="210" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="710" y1="260" x2="710" y2="210" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Claims to Evidence */}
            <line x1="150" y1="390" x2="150" y2="345" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="280" y1="390" x2="280" y2="345" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="460" y1="390" x2="460" y2="345" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Counterclaim to Rebuttal/Evidence */}
            <line x1="650" y1="390" x2="650" y2="345" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="790" y1="390" x2="790" y2="345" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Rebuttal to Evidence */}
            <line x1="630" y1="600" x2="630" y2="480" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Parallel connections (bidirectional) */}
            <line
              x1="322"
              y1="300"
              x2="348"
              y2="300"
              stroke="#6b7280"
              strokeWidth="2"
              markerEnd="url(#arrowhead)"
              markerStart="url(#arrowhead-bidirectional)"
            />
            <line
              x1="560"
              y1="300"
              x2="620"
              y2="300"
              stroke="#6b7280"
              strokeWidth="2"
              markerEnd="url(#arrowhead)"
              markerStart="url(#arrowhead-bidirectional)"
            />
            <line
              x1="208"
              y1="420"
              x2="239"
              y2="420"
              stroke="#6b7280"
              strokeWidth="2"
              markerEnd="url(#arrowhead)"
              markerStart="url(#arrowhead-bidirectional)"
            />

            {/* All elements to conclusion */}
            <line x1="390" y1="575" x2="390" y2="210" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
          </svg>

          {/* Diagram Elements - positioned exactly like the Crossley model */}
          <div style={{ zIndex: 2, position: "relative" }}>
            {/* Lead - Top level */}
            <DiagramElement
              id="lead"
              label="Lead"
              element={analysis.elements.lead}
              style={{ top: "10px", left: "168px", minWidth: "600px" }}
            />

            {/* Position - Second level */}
            <DiagramElement
              id="position"
              label="Position"
              element={analysis.elements.position}
              style={{ top: "130px", left: "168px", minWidth: "600px" }}
            />

            {/* Claims and Counterclaim - Third level */}
            {/* {Array.isArray(analysis.elements.claims) &&
              analysis.elements.claims.map((claim, index) => (
                <DiagramElement
                  key={`claim-${index}`}
                  id={`claim-${index}`}
                  label={`Claim ${index + 1}`}
                  element={claim}
                  style={{ top: "260px", left: `${110 + index * 235}px`, minWidth: "200px" }}
                />
              ))} */}
            <DiagramElement
              id="counterclaim"
              label="Counterclaim"
              element={analysis.elements.counterclaim}
              style={{ top: "260px", left: "620px", minWidth: "200px" }}
            />

            {/* Evidence blocks - Fourth level */}
            {/* {Array.isArray(analysis.elements.evidence) &&
              analysis.elements.evidence.map((evidence, index) => (
                <DiagramElement
                  key={`evidence-${index}`}
                  id={`evidence-${index}`}
                  label={`Evidence ${index + 1}`}
                  element={evidence}
                  style={{ top: `390px`, left: `${65 + index * 175}px` }}
                />
              ))} */}

            {Array.from({ length: 2 }).map((_, index) => {
              const claim = analysis.elements.claims?.[index] || { text: "", missing: true }
              return (
                <DiagramElement
                  key={`claim-${index}`}
                  id={`claim-${index}`}
                  label={`Claim ${index + 1}`}
                  element={claim}
                  style={{
                    top: "260px",
                    left: `${110 + index * 235}px`,
                    minWidth: "200px",
                  }}
                />
              )
            })}

            {Array.from({ length: 3 }).map((_, index) => {
              const evidence = analysis.elements.evidence?.[index] || { text: "", missing: true }
              return (
                <DiagramElement
                  key={`evidence-${index}`}
                  id={`evidence-${index}`}
                  label={`Evidence ${index + 1}`}
                  element={evidence}
                  style={{
                    top: "390px",
                    left: `${65 + index * 175}px`,
                  }}
                />
              )
            })}

            <DiagramElement
              id="rebuttal"
              label="Rebuttal"
              element={analysis.elements.rebuttal}
              style={{ top: "390px", left: "570px" }}
            />
            <DiagramElement
              id="counterclaim_evidence"
              label="Evidence 4"
              element={analysis.elements.counterclaim_evidence}
              style={{ top: "390px", left: "750px" }}
            />

            <DiagramElement
              id="rebuttal_evidence"
              label="Rebuttal Evidence"
              element={analysis.elements.rebuttal_evidence}
              style={{ top: "530px", left: "570px" }}
            />

            <DiagramElement
              id="conclusion"
              label="Concluding Summary"
              element={analysis.elements.conclusion}
              style={{ top: "560px", left: "300px", minWidth: "140px" }}
            />
          </div>

          {/* Legend */}
          <div
            className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-3 rounded-lg shadow-lg border-2 border-purple-200"
            style={{ zIndex: 3 }}
          >
            <h4 className="font-medium mb-2 text-sm text-purple-700 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Effectiveness Legend
            </h4>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gradient-to-br from-green-100 to-green-200 border border-green-400 rounded"></div>
                <span>Effective</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gradient-to-br from-yellow-100 to-yellow-200 border border-yellow-400 rounded"></div>
                <span>Adequate</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gradient-to-br from-red-100 to-red-200 border border-red-400 rounded"></div>
                <span>Ineffective</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gray-200 border-2 border-gray-400 border-dashed rounded"></div>
                <span>Missing</span>
              </div>
            </div>
          </div>
        </div>

        {/* Missing Elements Summary */}
        {missingElements.length > 0 && (
          <div className="mt-4 p-4 bg-gradient-to-br from-red-50 to-pink-50 border-2 border-red-200 rounded-lg">
            <h4 className="font-medium text-red-800 mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Missing Argumentative Elements ⚠️
            </h4>
            <p className="text-red-700 text-sm mb-2">
              Your essay is missing the following elements from the Crossley model:
            </p>
            <div className="flex flex-wrap gap-2">
              {missingElements.map((element) => (
                <Badge key={element} variant="destructive" className="text-xs">
                  {element.charAt(0).toUpperCase() + element.slice(1)}
                </Badge>
              ))}
            </div>
            <p className="text-red-700 text-sm mt-2">
              These missing elements are shown in grey with dashed borders in the diagram above. 💫
            </p>
          </div>
        )}

        {/* Effectiveness Summary */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border-2 border-green-200 text-center shadow-md">
            <h4 className="font-medium text-green-800 mb-1">Effective ✨</h4>
            <p className="text-3xl font-bold text-green-600">
              {
                Object.values(analysis.elements)
                  .flatMap((e) => (Array.isArray(e) ? e : [e]))
                  .filter((el) => el.effectiveness === "Effective").length
              }
            </p>
            <p className="text-xs text-green-700">Strong elements</p>
          </div>
          <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 p-4 rounded-lg border-2 border-yellow-200 text-center shadow-md">
            <h4 className="font-medium text-yellow-800 mb-1">Adequate 💫</h4>
            <p className="text-3xl font-bold text-yellow-600">
              {
                Object.values(analysis.elements)
                  .flatMap((e) => (Array.isArray(e) ? e : [e]))
                  .filter((el) => el.effectiveness === "Adequate").length
              }
            </p>
            <p className="text-xs text-yellow-700">Good but improvable</p>
          </div>
          <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-lg border-2 border-red-200 text-center shadow-md">
            <h4 className="font-medium text-red-800 mb-1">Ineffective ⚠️</h4>
            <p className="text-3xl font-bold text-red-600">
              {
                Object.values(analysis.elements)
                  .flatMap((e) => (Array.isArray(e) ? e : [e]))
                  .filter((el) => el.effectiveness === "Ineffective").length
              }
            </p>
            <p className="text-xs text-red-700">Need improvement</p>
          </div>
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-lg border-2 border-gray-200 text-center shadow-md">
            <h4 className="font-medium text-gray-800 mb-1">Missing 🔍</h4>
            <p className="text-3xl font-bold text-gray-600">
              {
                Object.values(analysis.elements)
                  .flatMap((e) => (Array.isArray(e) ? e : [e]))
                  .filter((el) => el.effectiveness === "Missing").length
              }
            </p>
            <p className="text-xs text-gray-700">Not found</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
