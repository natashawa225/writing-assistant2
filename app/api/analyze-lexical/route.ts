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

// export async function POST(request: NextRequest) {
//   try {
//     const { essay } = await request.json()

//     if (!essay || essay.trim().length === 0) {
//       return NextResponse.json({ error: "Essay content is required" }, { status: 400 })
//     }

    

//     // Detect AWL words for this essay
//     const awlWords = detectAWLWordsBySublist(essay)
//     const awlFeedbackData = awlWords.map(d => ({
//       original: d.word,
//       sublist: d.sublist,
//       category: "Foundation words", // or computed if you have logic
//       reason: "", // leave for GPT to fill or local
//       suggestion: "",
//       explanation: "",
//       example: getCOCAExamples(d.word, 2).join(" | "), // simple COCA example
//       exampleEssay: "",
//       start: d.start,
//       end: d.end,
//     }));
    
//     const aflMatches = detectAFLphrase(essay)

//     const aflSuggestions = aflMatches.map(m => ({
//       original: m.match,
//       value: mapFTWScoreToValue(m.ftw),
//       reason: "", // GPT or local logic
//       suggestion: "",
//       explanation: "",
//       example: getCOCAExamples(m.phrase, 2).join(" | "),
//       exampleEssay: "",
//       start: m.start,
//       end: m.end,
//     }));
    

//     // Calculate MATTR locally
//     const words = essay.toLowerCase().match(/\b\w+\b/g) || []
//     const uniqueWords = new Set(words)
//     const mattrScore = calculateMATTR(essay)

//     let diversityLevel: "Low" | "Medium" | "High" = "Low"
//     if (mattrScore > 0.7) diversityLevel = "High"
//     else if (mattrScore > 0.5) diversityLevel = "Medium"

//     // After calculating mattrScore, words, uniqueWords
//     const wordFrequency = (words as string[]).reduce<Record<string, number>>((acc, w) => {
//       acc[w] = (acc[w] || 0) + 1
//       return acc
//     }, {})

//     const topWords = Object.entries(wordFrequency)
//       .sort((a, b) => b[1] - a[1])
//       .slice(0, 5)
//       .map(([word, count]) => `${word} (${count})`)

//     let lexicalFeedback = ""
//     let lexicalSuggestions: string[] = []

//     if (mattrScore > 0.7) {
//       lexicalFeedback = `Great work! A MATTR score of ${(mattrScore*100).toFixed(1)} shows strong lexical diversity. Keep building on this strength by experimenting with synonyms and nuanced word choices.`
//       lexicalSuggestions = [`Your top 5 most frequent words are: ${topWords.join(", ")}. Consider how you might replace one or two of them occasionally to enrich your expression.`]
//     } else {
//       lexicalFeedback = `Your MATTR score of ${(mattrScore*100).toFixed(1)} suggests room for more variety. Try noticing which words you repeat often and think of academic alternatives.`
//       lexicalSuggestions = [`Your top 5 most frequent words are: ${topWords.join(", ")}. Reflect on whether any of these could be substituted with precise academic vocabulary.`]
//     }

//     const lexicalPrompt = `
//     You are a lexical analysis expert. Analyze this essay for academic writing quality using these specific criteria:

//     1. AWL COVERAGE:
//     - For AWL words found in the essay, use this data: ${JSON.stringify(awlFeedbackData)}.
//     - For each AWL word:
//     // Inside AWL COVERAGE instructions
//       * suggestion.sublist: RETURN the sublist number (as string) for the word (use provided AWL data).
//       * suggestion.category: Classify the word as "Foundation words", "Expanding words", "Mastery words", or "Expert words".
//       * suggestion.reason: write a reflective prompt to guide students to revise, GIVE A REFLECTIVE PROMPT, DONT GIVE THE ANSWER. for example: "Think of a more formal verb often used in academic writing that means to obtain or to receive.". DONT GIVE SUGGESTED WORDS OR EXAMPLE, ONLY INDIRECT REFLECTIVE FEEDBACK.
//       * suggestion.suggestion: provide the corrected academic alternative word. dont return the original word.
//       * suggestion.explanation: explain why the suggested academic word is stronger than the original.
//       * suggestion.example: MUST use example sentences from the provided COCA data that has the suggested word. the suggested word needs to be hidden in the sentence. for instance: assess becomes a_____ (number of underlined represents the letters) If no COCA examples exist for a word, create a simple academic sentence. 
//       * suggestion.exampleEssay: Rephrase the student's original sentence, integrating the suggested word. Show them how it would look in their own work.
//     - Classify suggestions into categories: "Foundation words", "Expanding words", "Mastery words", "Expert words".
//     - Calculate coverage score (0–100).

//     2. AFL COVERAGE:
//     - For AFL phrases, the value field is already calculated. DO NOT recalculate the value field.
//     - For each AFL phrase (with value already included) in: ${JSON.stringify(aflSuggestions)}:
//       * suggestion.reason: write a reflective prompt to guide students to revise. GIVE A REFLECTIVE PROMPT, DONT GIVE THE ANSWER. DONT GIVE SUGGESTED WORDS OR EXAMPLE, ONLY INDIRECT REFLECTIVE FEEDBACK.
//       * suggestion.suggestion: provide the more formal/precise academic phrase.dont return the original word.
//       * suggestion.explanation: explain why the suggested phrase is stronger in academic contexts.
//       * suggestion.example: MUST use example sentences from the provided COCA data that has the suggested phrase. the suggested word needs to be hidden in the sentence. for instance: assess becomes a_____ (number of underlined represents the letters) If no COCA examples exist for a word, create a simple academic sentence. 
//       * suggestion.exampleEssay: Rephrase the student's original sentence, integrating the suggested phrase. Show them how it would look in their own work.
//       * suggestion.value: USE THE PRE-CALCULATED VALUE from ${JSON.stringify(aflSuggestions)}. Do not omit this field.
//     - Calculate coverage score (0–100).

//     3. LEXICAL DIVERSITY:
//     - Use the calculated MATTR score: ${mattrScore.toFixed(3)}.
//     - Total words: ${words.length}, Unique words: ${uniqueWords.size}.
//     - Assign diversity level: ${diversityLevel}.
//     - Provide specific feedback and improvement suggestions unless MATTR > 0.7, in which case only encouragement is needed.
//     - answer: suggest academic alternative words to replace the most repetitive word(s). DO NOT return the original word.
//     - reason: explain why the suggested alternatives are better than the original (e.g., more formal, more precise, more varied).

//     IMPORTANT: Always use COCA examples from the provided data when available. If no COCA examples exist, create simple, clear academic sentences.

//     Output must match the provided schema exactly.
//     `
//     const result = await generateObject({
//       model: openai("gpt-4o"),
//       system: lexicalPrompt,
//       prompt: `Analyze the lexical features of this essay and provide detailed feedback:\n\n${essay}
//       For repetitive words:
// - Identify words that are overused.
// - For each, return:
//   • word
//   • count
//   • frequency (percentage of total words, one decimal place)
//   • answer: a clear, student-friendly suggestion with example synonyms or alternatives.
//   • reason: an explanation why this word’s repetition is problematic for academic style.

//   `,
//       schema: LexicalAnalysisSchema,
//     })

//     // ✅ Override lexical diversity
//     result.object.lexicalDiversity = {
//       ...result.object.lexicalDiversity,   // keep GPT’s answer + reason
//       mattr: mattrScore,
//       uniqueWords: uniqueWords.size,
//       totalWords: words.length,
//       diversityLevel,
//       feedback: lexicalFeedback,
//       suggestions: lexicalSuggestions,
//     }
    

//     // ✅ Fix AWL suggestions: always enforce sublist + category
//     result.object.awlCoverage.suggestions = result.object.awlCoverage.suggestions.map((s, i) => ({
//       ...s,
//       sublist: awlWords[i]?.sublist?.toString() ?? "unknown",
//       category: s.category ?? "Foundation words",
//     }))

//     // ✅ Fix AFL suggestions: always enforce pre-calculated `value`
//     result.object.aflCoverage.suggestions = result.object.aflCoverage.suggestions.map((s, i) => ({
//       ...s,
//       value: s.value ?? aflSuggestions[i]?.value ?? "Rare: Consider a more common academic phrase.",
//     }))    

    
//     return NextResponse.json(result.object)
//   } catch (error) {
//     console.error("Error analyzing lexical features:", error)
//     return NextResponse.json({ error: "Failed to analyze lexical features" }, { status: 500 })
//   }
// }