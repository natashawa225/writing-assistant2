import { type NextRequest, NextResponse } from "next/server"

import { openai } from "@ai-sdk/openai"
import { generateObject } from "ai"
import { z } from "zod"
import { detectAWLWordsBySublist } from "@/lib/awl"
import { getCOCAExamples } from "@/lib/coca"
import { detectAFLphrase, AFLMatch } from "@/lib/afl"

const examples = getCOCAExamples("effect")

console.log(examples)

const FeedbackSchema = z.object({
  id: z.string(),
  type: z.enum(["lexical", "argument"]),
  message: z.string(),
  start: z.number(), 
  end: z.number(), 
  color: z.string().optional(),
})

// UPDATED SCHEMA - Make fields optional that will be filled during merge
const LexicalAnalysisSchema = z.object({
  awlCoverage: z.object({
    suggestions: z.array(
      z.object({
        original: z.string(),
        reason: z.string(),
        suggestion: z.string(),
        explanation: z.string(),
        exampleEssay: z.string(),
        // These will be filled in during merge
        sublist: z.string().optional(),
        category: z.string().optional(),
        example: z.string().optional(),
        start: z.number().optional(),
        end: z.number().optional(),
      }),
    ),
  }),
  aflCoverage: z.object({
    suggestions: z.array(
      z.object({
        original: z.string(),
        reason: z.string(),
        suggestion: z.string(),
        explanation: z.string(),
        exampleEssay: z.string(),
        // These will be filled in during merge
        value: z.string().optional(),
        example: z.string().optional(),
        start: z.number().optional(),
        end: z.number().optional(),
      }),
    ),
  }),
})

function mapFTWScoreToValue(score: number): string {
  if (score >= 0.75) return "Essential: Very common in academic writing"
  if (score >= 0.50) return "Useful: Good phrase, but less frequent."
  if (score >= 0.25) return "Advanced: Less common in student writing."
  return "Rare: Consider a more common academic phrase."
}
function maskWord(word: string) {
  if (!word) return ""
  const firstLetter = word[0]
  return firstLetter + "_".repeat(word.length - 1)
}
function calculateMATTR(text: string): number {
  const words = text.toLowerCase().match(/\b\w+\b/g) || []
  if (words.length < 50) return 0

  const windowSize = 50
  let totalTTR = 0
  let windowCount = 0

  for (let i = 0; i <= words.length - windowSize; i++) {
    const window = words.slice(i, i + windowSize)
    const uniqueWords = new Set(window)
    const ttr = uniqueWords.size / windowSize
    totalTTR += ttr
    windowCount++
  }

  return windowCount > 0 ? totalTTR / windowCount : 0
}

export async function POST(request: NextRequest) {
  try {
    const { essay } = await request.json()
    if (!essay?.trim()) {
      return NextResponse.json({ error: "Essay content is required" }, { status: 400 })
    }

    // --- LOCAL PREPROCESSING ---
    const words = essay.toLowerCase().match(/\b\w+\b/g) || []
    const uniqueWords = new Set(words)
    const mattrScore = calculateMATTR(essay)
    let diversityLevel: "Low" | "Medium" | "High" = "Low"
    if (mattrScore > 0.7) diversityLevel = "High"
    else if (mattrScore > 0.5) diversityLevel = "Medium"

    const wordFrequency = words.reduce((acc: Record<string, number>, w: string) => {
      acc[w] = (acc[w] || 0) + 1
      return acc
    }, {})
    
    const entries = Object.entries(wordFrequency) as [string, number][]
    const sorted = entries.sort((a, b) => b[1] - a[1])
    const topFive = sorted.slice(0, 5)
    const topWords = topFive.map(([word, count]) => `${word} (${count})`)
    
    console.log(topWords)

    const lexicalFeedback = mattrScore > 0.7
      ? `Great work! A MATTR score of ${(mattrScore*100).toFixed(1)} shows strong lexical diversity. Keep experimenting with synonyms and nuanced word choices.`
      : `Your MATTR score of ${(mattrScore*100).toFixed(1)} suggests room for more variety. Consider replacing repetitive words with precise academic vocabulary.`
    const lexicalSuggestions = [
      `Your top 5 most frequent words are: ${topWords.join(", ")}.`
    ]

    // --- LOCAL AWL/AFL DETECTION ---
    const awlWords = detectAWLWordsBySublist(essay)
    const aflMatches = detectAFLphrase(essay)

    // Prefill COCA examples & AFL value
    const awlData = awlWords.map(d => ({
      original: d.word ?? "unknown",
      sublist: d.sublist?.toString() ?? "unknown",
      category: "Foundation words",
      example: getCOCAExamples(d.word ?? "", 2).join(" | ") || "No example available",
      start: d.start ?? 0,
      end: d.end ?? 0,
    }))
    
    const aflData = aflMatches.map(m => ({
      original: m.match ?? "unknown",
      value: mapFTWScoreToValue(m.ftw ?? 0),
      example: getCOCAExamples(m.phrase ?? "", 2).join(" | ") || "No example available",
      start: m.start ?? 0,
      end: m.end ?? 0,
    }))
    
    const lexicalDiversityData = {
      mattr: mattrScore,
      uniqueWords: uniqueWords.size,
      totalWords: words.length,
      diversityLevel,
      feedback: lexicalFeedback,
      suggestions: lexicalSuggestions,
      repetitiveWords: [],
    }
    
    // --- CALL GPT ONLY FOR SUGGESTIONS & REASON ---
    const lexicalPrompt = `
You are a lexical analysis expert. For ONLY the AWL words and AFL phrases provided below, generate:

1. suggestion: a more formal/academic alternative word or phrase (don't return the original word or phrase)
2. reason: a reflective prompt guiding the student to revise, without giving the answer directly
3. example: create an academic example sentence that demonstrates how the suggested word/phrase is typically used in high-quality academic writing, based on COCA corpus patterns. Mask the suggested word in the sentence by keeping only the first letter and replacing the rest with underscores (e.g., "prioritize" -> "p______"). The rest of the sentence should remain natural, grammatical, and contextually meaningful. Avoid inventing informal or unrealistic sentences.
4. explanation: why this alternative is stronger in academic writing
5. exampleEssay: a rephrased sentence using the suggested word/phrase

IMPORTANT: Only generate suggestions for the exact words/phrases listed below. Do not add additional ones.

Essay: ${essay}

AWL words to analyze: ${JSON.stringify(awlData.map(d => d.original))}
AFL phrases to analyze: ${JSON.stringify(aflData.map(d => d.original))}

Output in a structured JSON with this exact format:
{
  "awlCoverage": {
    "suggestions": [
      {
        "original": "word from AWL list",
        "suggestion": "better alternative",
        "reason": "reflective question",
        "example": "sentence with masked suggestion",
        "explanation": "why it's better",
        "exampleEssay": "example sentence"
      }
    ]
  },
  "aflCoverage": {
    "suggestions": [
      {
        "original": "phrase from AFL list",
        "suggestion": "better alternative",
        "reason": "reflective question",
        "example": "sentence with masked suggestion",
        "explanation": "why it's better",
        "exampleEssay": "example sentence"
      }
    ]
  }
}
`
    const result = await generateObject({
      model: openai("gpt-4o"),
      system: lexicalPrompt,
      prompt: lexicalPrompt,
      schema: LexicalAnalysisSchema,
    })

    // --- MERGE LOCAL DATA WITH GPT OUTPUT ---
    // Match AWL suggestions by original word and fill in missing data
    const awlMerged = result.object.awlCoverage.suggestions.map(s => {
      const local = awlData.find(d => d.original.toLowerCase() === s.original.toLowerCase())
    
      return {
        original: s.original,
        suggestion: s.suggestion,
        reason: s.reason,
        explanation: s.explanation,
        example: s.example,
        exampleEssay: s.exampleEssay,
        sublist: local?.sublist ?? "unknown",
        category: local?.category ?? "Foundation words",
        start: local?.start ?? 0,
        end: local?.end ?? 0,
      }
    })
    

    // Match AFL suggestions by original phrase and fill in missing data
    const aflMerged = result.object.aflCoverage.suggestions.map(s => {
      const local = aflData.find(d => d.original.toLowerCase() === s.original.toLowerCase())
      
      return {
        original: s.original,
        suggestion: s.suggestion,
        reason: s.reason,
        explanation: s.explanation,
        example: s.example,
        exampleEssay: s.exampleEssay,
        value: local?.value ?? "Rare: Consider a more common academic phrase.",
        start: local?.start ?? 0,
        end: local?.end ?? 0,
      }
    })

    // Final object to return
    const finalObject = {
      awlCoverage: { suggestions: awlMerged },
      aflCoverage: { suggestions: aflMerged },
      lexicalDiversity: lexicalDiversityData,
    }

    return NextResponse.json(finalObject)
  } catch (error) {
    console.error("Error analyzing lexical features:", error)
    return NextResponse.json({ error: "Failed to analyze lexical features" }, { status: 500 })
  }
}