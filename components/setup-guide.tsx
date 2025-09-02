"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Info, Lightbulb, Target } from "lucide-react"

export function SetupGuide() {
  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="h-4 w-4" />
          How to Use This Tool
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <Target className="h-4 w-4" />
          <AlertDescription>
            Click on elements in the diagram below to see detailed feedback and suggestions for improvement.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <Lightbulb className="h-3 w-3" />
              Color Legend
            </h4>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-800 border-green-200">Effective</Badge>
                <span className="text-xs">Strong, well-developed elements</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Adequate</Badge>
                <span className="text-xs">Present but could be improved</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-red-100 text-red-800 border-red-200">Ineffective</Badge>
                <span className="text-xs">Weak or poorly developed</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Tips</h4>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>• Click diagram elements for specific feedback</li>
              <li>• Highlighted text in your essay shows analysis results</li>
              <li>• Switch between Visual and Lexical feedback tabs</li>
              <li>• Edit your essay while keeping highlights visible</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
