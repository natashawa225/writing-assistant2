"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BookOpen, BarChart3, Zap, Eye, EyeOff, ChevronDown, HelpCircle, ChevronRight, Info } from "lucide-react"
import type { LexicalAnalysis } from "@/lib/types"

interface LexicalFeedbackProps {
  analysis: LexicalAnalysis | null
  essay: string
  isAnalyzing: boolean
  onHighlightText: (text: string) => void
  onSubTabChange?: (subTab: string) => void
}

export function LexicalFeedback({
  analysis,
  essay,
  isAnalyzing,
  onHighlightText,
  onSubTabChange,
}: LexicalFeedbackProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const [feedbackLevel, setFeedbackLevel] = useState<{ [key: string]: number }>({})
  const [showAnswers, setShowAnswers] = useState({
    coverage: false,
    prevalence: false,
    diversity: false,
    awl: false,
    afl: false,
  })

  const handleTabChange = (value: string) => {
    onSubTabChange?.(value)
  }

  if (isAnalyzing) {
    return (
      <div className="p-6 space-y-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Analyzing lexical features...</p>
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="p-6 space-y-4">
        <Alert>
          <BookOpen className="h-4 w-4" />
          <AlertDescription>Click "Analyze Essay" to get detailed feedback on your lexical usage.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const toggleCard = (cardId: string) => {
    const newExpanded = new Set(expandedCards)
    if (newExpanded.has(cardId)) {
      newExpanded.delete(cardId)
    } else {
      newExpanded.add(cardId)
    }
    setExpandedCards(newExpanded)
  }

  const advanceFeedbackLevel = (cardId: string) => {
    setFeedbackLevel((prev) => ({
      ...prev,
      [cardId]: Math.min((prev[cardId] || 0) + 1, 2),
    }))
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "Foundation words":
        return "bg-gray-100 text-green-800 border-green-300"
      case "Expanding words":
        return "bg-gray-100 text-blue-800 border-blue-300"
      case "Mastery words":
        return "bg-gray-100 text-purple-800 border-purple-300"
      case "Expert words":
        return "bg-gray-100 text-red-800 border-red-300"
      default:
        return "bg-gray-100 text-gray-800 border-gray-300"
    }
  }

  const getValueColor = (value: string) => {
    switch (value) {
      case "High Academic Value":
        return "bg-gray-100 text-green-600"
      case "Medium Academic Value":
        return "bg-gray-100 text-blue-600"
      case "Low Academic Value":
        return "bg-gray-100 text-orange-600"
      default:
        return "bg-gray-100 text-gray-800 border-gray-300"
    }
  }

  const toggleAnswers = (section: keyof typeof showAnswers) => {
    setShowAnswers((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const handleAflClick = (suggestion: { original: string }) => {
    console.log("[v0] AFL phrase clicked:", suggestion.original)

    if (!onHighlightText) return

    // Normalize spaces & lowercase so "in addition" matches even if essay has line breaks or different spacing
    const normalizedEssay = essay.replace(/\s+/g, " ").toLowerCase()
    const normalizedPhrase = suggestion.original.replace(/\s+/g, " ").toLowerCase()

    const start = normalizedEssay.indexOf(normalizedPhrase)

    if (start !== -1) {
      // Found a match → send the *exact substring* from the essay, not the normalized one
      const matchText = essay.substr(start, suggestion.original.length)
      onHighlightText(matchText)
    } else {
      console.warn("Phrase not found in essay:", suggestion.original)
    }
  }

  // Function to find repetitive words in the essay
  const findRepetitiveWords = () => {
    const words = essay.toLowerCase().match(/\b\w+\b/g) || []
    const wordCounts: { [key: string]: number } = {}

    // Count word frequencies
    words.forEach((word) => {
      if (word.length > 3) {
        // Only consider words longer than 3 characters
        wordCounts[word] = (wordCounts[word] || 0) + 1
      }
    })

    // Find words that appear more than expected frequency based on essay length
    const totalWords = words.length
    const expectedFrequency = Math.max(2, Math.floor(totalWords / 100)) // At least 2, or 1% of total words

    return Object.entries(wordCounts)
      .filter(([word, count]) => count > expectedFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // Top 10 most repetitive words
      .map(([word, count]) => ({
        word,
        count,
        frequency: ((count / totalWords) * 100).toFixed(1),
      }))
  }

  const handleRepetitiveWordClick = (word: string) => {
    if (onHighlightText) {
      onHighlightText(word)
    }
  }

  const repetitiveWords = analysis.lexicalDiversity.mattr < 0.7 ? findRepetitiveWords() : []
  const shouldShowRepetitiveWords = analysis.lexicalDiversity.mattr < 0.7 && repetitiveWords.length > 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        <Tabs defaultValue="academic-coverage" onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 text-center">
            <TabsTrigger value="academic-coverage" className="whitespace-normal break-words">
              Academic Word Coverage
            </TabsTrigger>
            <TabsTrigger value="lexical-diversity" className="whitespace-normal break-words">
              Lexical Diversity
            </TabsTrigger>
          </TabsList>

          {/* Academic Word Coverage */}
          <TabsContent value="academic-coverage" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-4 w-4" />
                  Academic Word List
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {analysis.awlCoverage.suggestions.map((suggestion, index) => {
                  const cardId = `awl-${index}`
                  const isExpanded = expandedCards.has(cardId)
                  const currentLevel = feedbackLevel[cardId] || 0

                  return (
                    <Card key={index} className="border-l-4 border-l-blue-400">
                      <CardContent className="p-4">
                        <div
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => {
                            toggleCard(cardId)
                            onHighlightText?.(suggestion.original)
                          }}
                        >
                          <div className="flex items-center gap-3">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="font-medium text-red-600">"{suggestion.original}"</span>
                          </div>
                          <Badge className={getCategoryColor(suggestion.category)}>{suggestion.sublist}</Badge>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 space-y-3 pl-7">
                            {currentLevel === 0 && (
                              <div className="space-y-3">
                              <Card className="bg-blue-50 border-blue-300">
                                <CardContent className="p-4">
                                  <div className="flex items-start gap-3">
                                    <div className="p-1.5 bg-primary/10 rounded-full">
                                      <HelpCircle className="h-4 w-4 text-primary" />
                                    </div>
                                    <div className="flex-1">
                                      <h5 className="font-semibold text-primary mb-2">Hints to replace "{suggestion.original}":</h5>
                                      <p className="text-sm text-foreground/80 mb-3">{suggestion.reason}</p>
                                      <div className="bg-primary/5 p-3 rounded-lg border border-primary/10">
                                        <p className="text-sm font-medium text-primary mb-1">
                                        In a sentence: "{suggestion.example}"
                                        </p>
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
                                onClick={() => advanceFeedbackLevel(cardId)}
                              >
                                Show Solution
                              </Button>
                              </div>
                              
                            </div>
                            )}

                            {currentLevel >= 1 && (
                              <div className="space-y-3">
                                <div className="p-3 rounded-lg">
                                  <span className="font-medium text-red-600">"{suggestion.original}"</span>
                                  <span className="text-gray-400">→</span>
                                  <span className="font-medium text-green-600">"{suggestion.suggestion}"</span>
                                </div>
                                
                                <div className="bg-blue-50 p-3 rounded-lg border-l-2 border-blue-300">
                                  <p className="text-sm font-medium text-blue-800 mb-1">
                                    How to use in "{suggestion.suggestion}" in your essay?
                                  </p>
                                  <p className="text-sm text-blue-700 italic">"{suggestion.exampleEssay}"</p>
                                </div>
                                <div className="bg-gray-100 p-3 rounded-lg border-l-2 border-gray-300">
                                  <p className="text-sm font-medium text-gray-800 mb-1">Why better:</p>
                                  <p className="text-sm text-gray-700">{suggestion.explanation}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-4 w-4" />
                  Academic Formula List
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {analysis.aflCoverage.suggestions.map((suggestion, index) => {
                  const cardId = `afl-${index}`
                  const isExpanded = expandedCards.has(cardId)
                  const currentLevel = feedbackLevel[cardId] || 0

                  return (
                    <Card key={index} className="border-l-4 border-l-green-400">
                      <CardContent className="p-4">
                        <div
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => {
                            toggleCard(cardId)
                            handleAflClick(suggestion)
                          }}
                        >
                          <div className="flex items-center gap-3">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="font-medium text-red-600">"{suggestion.original}"</span>
                          </div>
                          <Badge className={getValueColor(suggestion.value)}>{suggestion.value}</Badge>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 space-y-3 pl-7">
                            {currentLevel === 0 && (
                              <div className="space-y-3">

                              <Card className="bg-green-50 border-green-300">
                                <CardContent className="p-3">
                                  <div className="flex items-start gap-3">
                                    <div className="p-1.5 bg-primary/10 rounded-full">
                                      <HelpCircle className="h-4 w-4 text-primary" />
                                    </div>
                                    <div className="flex-1">
                                      <h5 className="font-semibold text-primary mb-2">Hints to replace "{suggestion.original}":</h5>
                                      <p className="text-sm text-foreground/80 mb-3">{suggestion.reason}</p>
                                      <div className="bg-primary/5 p-3 rounded-lg border border-primary/10">
                                        <p className="text-sm font-medium text-primary mb-1">
                                        For example, you might see it used like this: "{suggestion.example}"
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                  {/* <div className="flex items-start gap-2">
                                    <HelpCircle className="h-4 w-4 text-green-600 mt-0.5" />
                                    <div>
                                      <h5 className="font-medium text-green-800 mb-1">Hints to replace "{suggestion.original}":</h5>
                                      <p className="text-sm text-green-700">{suggestion.reason}</p>
                                      <p className="text-sm text-green-700">If you are stuck, click the button to see a suggested correction.</p>
                                      <Button
                                        size="sm"
                                        className="mt-2 bg-green-500 hover:bg-green-700"
                                        onClick={() => advanceFeedbackLevel(cardId)}
                                      >
                                        Show Alternative
                                      </Button>
                                    </div>
                                  </div> */}
                                </CardContent>
                              </Card>
                              <Card className="bg-gradient-to-br from-accent/5 to-accent/10 border-accent/20">
                                <CardContent className="p-4">
                                  <div className="flex justify-between items-center gap-3">
                                    
                                    <Button
                                      size="sm"
                                      className="bg-accent hover:bg-accent/90 text-accent-foreground shadow-sm"
                                      onClick={() => advanceFeedbackLevel(cardId)}
                                    >
                                      Show Solution
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                              </div>

                            )}

                            {currentLevel >= 1 && (
                              <div className="space-y-3">
                                <div className="p-3 rounded-lg">
                                  <span className="font-medium text-red-600">"{suggestion.original}"</span>
                                  <span className="text-gray-400">→</span>
                                  <span className="font-medium text-green-600">"{suggestion.suggestion}"</span>
                                </div>
                            

                                <div className="bg-green-50 p-3 rounded-lg border-l-2 border-green-300">
                                  <p className="text-sm font-medium text-green-800 mb-1">How to use "{suggestion.original}" in your essay?</p>
                                  <p className="text-sm text-green-700 italic">"{suggestion.exampleEssay}"</p>
                                </div>
                                <div className="bg-gray-100 p-3 rounded-lg border-l-2 border-gray-300">
                                  <p className="text-sm font-medium text-gray-800 mb-1">Why better:</p>
                                  <p className="text-sm text-gray-700">{suggestion.explanation}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lexical Diversity */}
          <TabsContent value="lexical-diversity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4" />
                  Lexical Diversity (MATTR)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">MATTR Score</span>
                    <Badge
                      variant={
                        analysis.lexicalDiversity.diversityLevel === "High"
                          ? "default"
                          : analysis.lexicalDiversity.diversityLevel === "Medium"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {analysis.lexicalDiversity.mattr.toFixed(3)} ({analysis.lexicalDiversity.diversityLevel})
                    </Badge>
                  </div>
                  <Progress value={analysis.lexicalDiversity.mattr * 100} className="h-2" />
                </div>

                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Think about your word choice variety. Do you repeat the same words frequently, or do you use
                    synonyms and varied expressions throughout your essay?
                  </p>

                  <Button variant="outline" size="sm" onClick={() => toggleAnswers("diversity")} className="w-full">
                    {showAnswers.diversity ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                    {showAnswers.diversity ? "Hide Analysis" : "Show Analysis"}
                  </Button>

                  {showAnswers.diversity && (
                    <div className="space-y-4 p-4 bg-muted rounded-lg">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{analysis.lexicalDiversity.uniqueWords}</div>
                          <div className="text-xs text-muted-foreground">Unique Words</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{analysis.lexicalDiversity.totalWords}</div>
                          <div className="text-xs text-muted-foreground">Total Words</div>
                        </div>
                      </div>

                      <div className="text-sm space-y-2">
                        <p>
                          <strong>MATTR Score:</strong> {analysis.lexicalDiversity.mattr.toFixed(3)}
                        </p>
                        <p>
                          <strong>Diversity Level:</strong> {analysis.lexicalDiversity.diversityLevel}
                        </p>
                        <p className="text-muted-foreground">
                          MATTR (Moving Average Type-Token Ratio) measures lexical diversity by calculating the average
                          type-token ratio across moving windows of text. Higher scores indicate more varied vocabulary
                          usage.
                        </p>
                      </div>
                      <div className="space-y-4">
                        <Card className="bg-gray-50">
                          <CardContent className="p-4">
                            <h4 className="font-medium text-gray-800 mb-2">Analysis Results</h4>
                            <p className="text-sm text-gray-700 mb-3">{analysis.lexicalDiversity.feedback}</p>
                            <div className="space-y-2">
                              <h5 className="font-medium text-gray-800">Suggestions for Improvement:</h5>
                              <ul className="list-disc list-inside space-y-1">
                                {analysis.lexicalDiversity.suggestions.map((suggestion, index) => (
                                  <li key={index} className="text-sm text-gray-700">
                                    {suggestion}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  )}
                  {/* Show repetitive words when MATTR < 0.70 */}
                  {shouldShowRepetitiveWords && (
                    <div className="space-y-4">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" />
                            Repetitive Word Usage
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {repetitiveWords.map((item, index) => {
                            const cardId = `repetitive-${index}`
                            const isExpanded = expandedCards.has(cardId)
                            const currentLevel = feedbackLevel[cardId] || 0

                            return (
                              <Card key={index} className="border-l-4 border-l-orange-400">
                                <CardContent className="p-4">
                                  <div
                                    className="flex items-center justify-between cursor-pointer"
                                    onClick={() => {
                                      toggleCard(cardId)
                                      handleRepetitiveWordClick(item.word)
                                    }}
                                  >
                                    <div className="flex items-center gap-3">
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                      <span className="font-medium text-orange-600">"{item.word}"</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-orange-600 border-orange-300">
                                        {item.count} times
                                      </Badge>
                                      <Badge variant="secondary" className="text-orange-600">
                                        {item.frequency}%
                                      </Badge>
                                    </div>
                                  </div>

                                  {isExpanded && (
                                    <div className="mt-4 space-y-3 pl-7">
                                      {currentLevel === 0 && (
                                        <Card className="bg-orange-50 border-orange-300">
                                          <CardContent className="p-3">
                                            <div className="flex items-start gap-2">
                                              <HelpCircle className="h-4 w-4 text-orange-600 mt-0.5" />
                                              <div>
                                                <h5 className="font-medium text-orange-800 mb-1">Reflection</h5>
                                                <p className="text-sm text-orange-700">
                                                  This word appears {item.count} times in your essay ({item.frequency}%
                                                  frequency). Consider if this repetition adds emphasis or if you could
                                                  use synonyms to create more varied and engaging prose.
                                                </p>
                                                <p className="text-sm text-orange-800">If you are stuck, click the button to see a suggested correction.</p>
                                                <Button
                                                  size="sm"
                                                  className="mt-2 bg-orange-500 hover:bg-orange-700"
                                                  onClick={() => advanceFeedbackLevel(cardId)}
                                                >
                                                  Show Alternatives
                                                </Button>
                                              </div>
                                            </div>
                                          </CardContent>
                                        </Card>
                                      )}

                                      {currentLevel >= 1 && (
                                        <div className="space-y-3">
                                          <div className="bg-gray-100 p-3 rounded-lg border-l-2 border-gray-300">
                                            <p className="text-sm font-medium text-gray-800 mb-1">
                                              Impact on your writing:
                                            </p>
                                            <p className="text-sm text-gray-700">
                                              Overusing "{item.word}" may make your writing sound repetitive and less
                                              sophisticated. Academic writing benefits from lexical variety to maintain
                                              reader engagement and demonstrate vocabulary range.
                                            </p>
                                          </div>

                                          <div className="bg-orange-50 p-3 rounded-lg border-l-2 border-orange-300">
                                            <p className="text-sm font-medium text-orange-800 mb-1">
                                              Improvement strategy:
                                            </p>
                                            <p className="text-sm text-orange-700">
                                              Try using synonyms, rephrasing sentences, or varying your sentence
                                              structures. Consider whether each use of "{item.word}" is necessary or if
                                              you could express the same idea differently.
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </CardContent>
                              </Card>
                            )
                          })}
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
