"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { Info, Lightbulb, Target, Server, ChevronDown, ChevronRight ,TableOfContents} from "lucide-react"

export function SetupGuide() {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-blue-800">
            <Server className="h-5 w-5" />
            How to Read the Diagram
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-blue-700 hover:text-blue-900"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {isExpanded ? "Hide" : "Show"} Instructions
          </Button>
        </div>
      </CardHeader>
      {isExpanded && (
      <CardContent className="space-y-3">
        <Alert>
          <Target className="h-4 w-4" />
          <AlertDescription>
            Click on elements in the diagram below to see detailed feedback and suggestions for improvement.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 gap-4 text-sm">
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <Lightbulb className="h-3 w-3" />
              Color Legend
            </h4>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-800 border-green-200">Effective</Badge>
                <span className="text-xs">Strong and clear. Your argument element is complete, well explained, and supported by evidence</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Adequate</Badge>
                <span className="text-xs">Present, but could be better. Some details may be missing or unclear, or evidence is weak</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-red-100 text-red-800 border-red-200">Ineffective</Badge>
                <span className="text-xs">Needs improvement. The element is vague, unsupported, or does not clearly contribute to your argument</span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-white rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <TableOfContents className="h-4 w-4 text-blue-600" />
                <h4 className="font-medium">Argument Elements:</h4>
              </div>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-2">
                <li><strong>Lead:</strong> The opening sentence. It should grab attention and introduce the topic.</li>
                <li><strong>Position:</strong> Your main answer to the prompt. It should be clear, direct, and act as your thesis.</li>
                <li><strong>Claim:</strong> A reason supporting your position. It should be specific and relevant.</li>
                <li><strong>Counterclaim:</strong> An opposing viewpoint. It should be reasonable and challenge your position.</li>
                <li><strong>Rebuttal:</strong> Your response to the counterclaim. It should clearly explain why the opposing view is incorrect.</li>
                <li><strong>Evidence:</strong> Facts, examples, or data that support your claim. They should be relevant and objective.</li>
                <li><strong>Conclusion:</strong> A summary of your main points. It should restate your position strongly.</li>
            </ul>
            </div>

          
        </div>
      </CardContent>
      )}
      </Card>
    )
  }
  