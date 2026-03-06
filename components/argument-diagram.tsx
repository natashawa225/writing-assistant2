"use client"

import React from "react"

import { useMemo, useState } from "react"
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
  type EvidenceNode = ArgumentElement & { id?: string; parentClaimId?: string }
  const CLAIM_TOP = 250
  const EVIDENCE_TOP = 360
  const CLAIM_LEFT_START = 54
  const CLAIM_GAP = 240
  const CLAIM_WIDTH = 170
  const EVIDENCE_WIDTH = 100
  const claims = analysis.elements.claims.slice(0, 2)
  const evidence = analysis.elements.evidence.slice(0, 2) as EvidenceNode[]

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
        className={`absolute border-2 rounded-lg p-3 min-w-[100px] text-center cursor-pointer transition-all hover:shadow-xl hover:scale-105 ${getElementStyle(
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
        {/* {found && element.text && (
          <div className="text-xs italic truncate max-w-[100px]" title={element.text}>
            "{element.text.substring(0, 25)}..."
          </div>
        )} */}
      </div>
    )
  }

  const displayedElements = useMemo(() => {
    return [
      analysis.elements.lead,
      analysis.elements.position,
      ...claims,
      analysis.elements.counterclaim,
      ...evidence,
      analysis.elements.rebuttal,
      analysis.elements.counterclaim_evidence,
      analysis.elements.rebuttal_evidence,
      analysis.elements.conclusion,
    ]
  }, [analysis, claims, evidence])

  const effectivenessCounts = useMemo(() => {
    return displayedElements.reduce(
      (acc, element) => {
        acc[element.effectiveness] += 1
        return acc
      },
      {
        Effective: 0,
        Adequate: 0,
        Ineffective: 0,
        Missing: 0,
      } as Record<ArgumentElement["effectiveness"], number>,
    )
  }, [displayedElements])

  const missingElements = displayedElements.filter((element) => element.effectiveness === "Missing")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Visual Argument Structure
        </CardTitle>
        <p className="text-sm">
        这张图展示了你的议论文结构，以及各个论证要素的表现情况。
        不同颜色代表不同程度：
        </p>
      </CardHeader>
      <CardContent className="p-6">
        <div className="relative w-full h-[600px] bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-purple-200 rounded-lg overflow-hidden shadow-inner">
          {/* SVG for arrows - matching the Crossley diagram exactly */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="#6b7280" />
              </marker>
              <marker id="arrowhead-bidirectional" markerWidth="6" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="7 0, 0 3, 7 7" fill="#6b7280" />
              </marker>
            </defs>

            {/* Hierarchical arrows - Position to Lead */}
            <line x1="375" y1="150" x2="375" y2="88" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Claims/Counterclaim to Position */}
            <line x1="175" y1="260" x2="175" y2="202" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="365" y1="260" x2="365" y2="202" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="580" y1="260" x2="580" y2="202" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Evidence to Claims */}
            <line x1="139" y1="370" x2="139" y2="320" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="379" y1="370" x2="379" y2="320" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Counterclaim to Rebuttal/Evidence */}
            <line x1="540" y1="370" x2="540" y2="320" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
            <line x1="650" y1="370" x2="650" y2="320" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Rebuttal to Evidence */}
            <line x1="535" y1="480" x2="535" y2="430" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />

            {/* Parallel connections (bidirectional) */}
            {/* <line
              x1="238"
              y1="285"
              x2="295"
              y2="285"
              stroke="#6b7280"
              strokeWidth="2"
              markerEnd="url(#arrowhead)"
              markerStart="url(#arrowhead-bidirectional)"
            /> */}
            <line
              x1="478"
              y1="285"
              x2="510"
              y2="285"
              stroke="#6b7280"
              strokeWidth="2"
              markerEnd="url(#arrowhead)"
              markerStart="url(#arrowhead-bidirectional)"
            />
            {/* <line
              x1="135"
              y1="390"
              x2="165"
              y2="390"
              stroke="#6b7280"
              strokeWidth="2"
              markerEnd="url(#arrowhead)"
              markerStart="url(#arrowhead-bidirectional)"
            /> */}

            {/* All elements to conclusion */}
            <line x1="300" y1="520" x2="300" y2="202" stroke="#6b7280" strokeWidth="3" markerEnd="url(#arrowhead)" />
          </svg>

          {/* Diagram Elements - positioned exactly like the Crossley model */}
          <div style={{ zIndex: 2, position: "relative" }}>
            {/* Lead - Top level */}
            <DiagramElement
              id="lead"
              label="Lead"
              element={analysis.elements.lead}
              style={{ top: "18px", left: "120px", minWidth: "510px" }}
            />

            {/* Position - Second level */}
            <DiagramElement
              id="position"
              label="Position"
              element={analysis.elements.position}
              style={{ top: "132px", left: "120px", minWidth: "510px" }}
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
              style={{ top: "250px", left: "510px", minWidth: "170px" }}
            />

            {claims.map((claim, index) => {
              const claimLeft = CLAIM_LEFT_START + index * CLAIM_GAP
              const evidenceNode = evidence[index]
              const evidenceLeft = claimLeft + CLAIM_WIDTH / 2 - EVIDENCE_WIDTH / 2

              return (
                <React.Fragment key={claim.id ?? `claim-${index + 1}`}>
                  <DiagramElement
                    id={`claim-${index}`}
                    label={`Claim ${index + 1}`}
                    element={claim}
                    style={{ top: `${CLAIM_TOP}px`, left: `${claimLeft}px`, minWidth: `${CLAIM_WIDTH}px` }}
                  />
                  {evidenceNode && (
                    <DiagramElement
                      id={`evidence-${index}`}
                      label={`Evidence ${index + 1}`}
                      element={evidenceNode}
                      style={{ top: `${EVIDENCE_TOP}px`, left: `${evidenceLeft}px`, minWidth: `${EVIDENCE_WIDTH}px` }}
                    />
                  )}
                </React.Fragment>
              )
            })}

            <DiagramElement
              id="rebuttal"
              label="Rebuttal"
              element={analysis.elements.rebuttal}
              style={{ top: "360px", left: "485px" }}
            />
            <DiagramElement
              id="counterclaim_evidence"
              label="Evidence 4"
              element={analysis.elements.counterclaim_evidence}
              style={{ top: "360px", left: "605px" }}
            />

            <DiagramElement
              id="rebuttal_evidence"
              label="Rebuttal Evidence"
              element={analysis.elements.rebuttal_evidence}
              style={{ top: "470px", left: "465px" }}
            />

            <DiagramElement
              id="conclusion"
              label="Concluding Summary"
              element={analysis.elements.conclusion}
              style={{ top: "500px", left: "215px", minWidth: "140px" }}
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
              可以进一步完善你的论证
            </h4>
            <p className="text-red-700 text-sm mb-2">
            尝试思考如何让每个论证要素更清晰、有力，以增强的完整性和说服力。
            </p>
          </div>
        )}

        {/* Effectiveness Summary */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border-2 border-green-200 text-center shadow-md">
              {/* effective */}
              <h4 className="font-medium text-green-800 mb-1">表现优秀</h4>            
              <p className="text-3xl font-bold text-green-600">{effectivenessCounts.Effective}</p>
            <p className="text-xs text-green-700">清晰且论述充分</p>
          </div>
          <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 p-4 rounded-lg border-2 border-yellow-200 text-center shadow-md">
            <h4 className="font-medium text-yellow-800 mb-1">基本达标</h4>
            <p className="text-3xl font-bold text-yellow-600">{effectivenessCounts.Adequate}</p>
            <p className="text-xs text-yellow-700">内容合适，但仍有提升空间</p>
          </div>
          <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-lg border-2 border-red-200 text-center shadow-md">
            <h4 className="font-medium text-red-800 mb-1">需要加强</h4>
            <p className="text-3xl font-bold text-red-600">{effectivenessCounts.Ineffective}</p>
            <p className="text-xs text-red-700">表达不够清晰和论述较弱</p>
          </div>
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-lg border-2 border-gray-200 text-center shadow-md">
            <h4 className="font-medium text-gray-800 mb-1">尚未体现</h4>
            <p className="text-3xl font-bold text-gray-600">{effectivenessCounts.Missing}</p>
            <p className="text-xs text-gray-700">文中暂未看到相关内容</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
