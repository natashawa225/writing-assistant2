import { type NextRequest, NextResponse } from "next/server"
import { openai } from "@ai-sdk/openai"
import { generateObject } from "ai"
import { z } from "zod"
import { detectAWLWordsBySublist } from "@/lib/awl"
import { getCOCAExamples } from "@/lib/coca"

const examples = getCOCAExamples("effect")
console.log(examples)

const FeedbackSchema = z.object({
  id: z.string(),
  type: z.enum(["lexical", "argument"]),
  message: z.string(),
  start: z.number(), // character index
  end: z.number(), // character index
  color: z.string().optional(), // e.g. "bg-yellow-200"
})

// Updated schema to match TypeScript interface
const LexicalAnalysisSchema = z.object({
  awlCoverage: z.object({
    score: z.number().min(0).max(100),
    suggestions: z.array(
      z.object({
        original: z.string(),
        suggestion: z.string(),
        sublist: z.number(),
        category: z.string(),
        explanation: z.string(),
        example: z.string(),
      }),
    ),
  }),
  aflCoverage: z.object({
    score: z.number().min(0).max(100),
    suggestions: z.array(
      z.object({
        original: z.string(),
        suggestion: z.string(),
        value: z.string(),
        explanation: z.string(),
        example: z.string(),
      }),
    ),
  }),
  lexicalDiversity: z.object({
    uniqueWords: z.number(),
    totalWords: z.number(),
    diversityLevel: z.enum(["Low", "Medium", "High"]),
    mattr: z.number(),
    feedback: z.string(),
    suggestions: z.array(z.string()),
  }),
  feedback: z.array(FeedbackSchema).optional(),
})

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

    if (!essay || essay.trim().length === 0) {
      return NextResponse.json({ error: "Essay content is required" }, { status: 400 })
    }

    // Detect AWL words for this essay
    const awlWords = detectAWLWordsBySublist(essay)

    // Map each word to COCA examples
    const awlFeedbackData = awlWords.map(({ word, sublist }) => {
      const examples = getCOCAExamples(word, 2) // limit to 2 examples per word
      return { word, sublist, examples }
    })

    // Calculate MATTR locally
    const words = essay.toLowerCase().match(/\b\w+\b/g) || []
    const uniqueWords = new Set(words)
    const mattrScore = calculateMATTR(essay)

    let diversityLevel: "Low" | "Medium" | "High" = "Low"
    if (mattrScore > 0.7) diversityLevel = "High"
    else if (mattrScore > 0.5) diversityLevel = "Medium"

    const lexicalPrompt = `
    You are a lexical analysis expert. Analyze this essay for academic writing quality using these specific criteria:

    1. AWL COVERAGE:
    - Identify words from the Academic Word List (AWL)
    - Provide vocabulary improvement suggestions with academic alternatives
    - Calculate coverage score (0-100)
    - Use COCA corpus data to give examples on how to use the suggested word

    2. AFL COVERAGE:
    - Detected AWL words in essay: ${JSON.stringify(awlFeedbackData)}
    - Provide improvement suggestions, categorize by sublist, and give examples.
    - Identify phrases from the Academic Formula List (AFL) 
    - Suggest more formal academic phrases
    - Calculate coverage score (0-100)

    4. LEXICAL DIVERSITY:
    - Use the calculated MATTR score: ${mattrScore.toFixed(3)}
    - Total words: ${words.length}
    - Unique words: ${uniqueWords.size}
    - Diversity level: ${diversityLevel}
    - Provide specific feedback and suggestions for improvement

    For AWL suggestions, use categories: "Foundation words", "Expanding words", "Mastery words", "Expert words"
    For AFL suggestions, use values: "High Academic Value", "Medium Academic Value", "Low Academic Value"

    Generate feedback array with lexical issues:
    - type: "lexical"
    - message: specific improvement suggestion (1-2 sentences)
    - start/end: character positions in essay
    - color: appropriate Tailwind class (e.g. "bg-yellow-200", "bg-red-200", "bg-blue-200")

    Focus on actionable, specific suggestions that help improve academic writing quality.
    `

    const result = await generateObject({
      model: openai("gpt-4o"),
      system: lexicalPrompt,
      prompt: `Analyze the lexical features of this essay and provide detailed feedback:\n\n${essay}`,
      schema: LexicalAnalysisSchema,
    })

    // Override lexical diversity with calculated values
    result.object.lexicalDiversity = {
      ...result.object.lexicalDiversity,
      mattr: mattrScore,
      uniqueWords: uniqueWords.size,
      totalWords: words.length,
      diversityLevel,
    }

    return NextResponse.json(result.object)
  } catch (error) {
    console.error("Error analyzing lexical features:", error)
    return NextResponse.json({ error: "Failed to analyze lexical features" }, { status: 500 })
  }
}
// import { type NextRequest, NextResponse } from "next/server"
// import { openai } from "@ai-sdk/openai"
// import { generateObject } from "ai"
// import { z } from "zod"
// import awlAflData from "../../../data/awl-afl.json"
// import cocaData from "../../../data/coca-corpus.json"

// const FeedbackSchema = z.object({
//   id: z.string(),
//   type: z.enum(["lexical", "argument"]),
//   message: z.string(),
//   start: z.number(),   // character index
//   end: z.number(),     // character index
//   color: z.string().optional(), // e.g. "bg-yellow-200"
// })

// const LexicalAnalysisSchema = z.object({
//   academicWordCoverage: z.object({
//     awlWords: z.array(
//       z.object({
//         word: z.string(),
//         headword: z.string(),
//         sublist: z.number(),
//       }),
//     ),
//     aflPhrases: z.array(
//       z.object({
//         phrase: z.string(),
//         frequency: z.number(),
//       }),
//     ),
//     coverageScore: z.number().min(0).max(100),
//   }),
//   lexicalPrevalence: z.object({
//     highFrequencyWords: z.array(
//       z.object({
//         word: z.string(),
//         frequency: z.number(),
//       }),
//     ),
//     lowFrequencyWords: z.array(
//       z.object({
//         word: z.string(),
//         frequency: z.number(),
//       }),
//     ),
//     prevalenceScore: z.number().min(0).max(100),
//   }),
//   lexicalDiversity: z.object({
//     mattrScore: z.number(),
//     uniqueWords: z.number(),
//     totalWords: z.number(),
//     diversityLevel: z.enum(["Low", "Medium", "High"]),
//   }),
//   feedback: z.array(FeedbackSchema).optional(), // <--- NEW
// })

// // const LexicalAnalysisSchema = z.object({
// //   academicWordCoverage: z.object({
// //     awlWords: z.array(
// //       z.object({
// //         word: z.string(),
// //         headword: z.string(),
// //         sublist: z.number(),
// //       }),
// //     ),
// //     aflPhrases: z.array(
// //       z.object({
// //         phrase: z.string(),
// //         frequency: z.number(),
// //       }),
// //     ),
// //     coverageScore: z.number().min(0).max(100),
// //   }),
// //   lexicalPrevalence: z.object({
// //     highFrequencyWords: z.array(
// //       z.object({
// //         word: z.string(),
// //         frequency: z.number(),
// //       }),
// //     ),
// //     lowFrequencyWords: z.array(
// //       z.object({
// //         word: z.string(),
// //         frequency: z.number(),
// //       }),
// //     ),
// //     prevalenceScore: z.number().min(0).max(100),
// //   }),
// //   lexicalDiversity: z.object({
// //     mattrScore: z.number(),
// //     uniqueWords: z.number(),
// //     totalWords: z.number(),
// //     diversityLevel: z.enum(["Low", "Medium", "High"]),
// //   }),
// // })

// function calculateMATTR(text: string): number {
//   const words = text.toLowerCase().match(/\b\w+\b/g) || []
//   if (words.length < 50) return 0

//   const windowSize = 50
//   let totalTTR = 0
//   let windowCount = 0

//   for (let i = 0; i <= words.length - windowSize; i++) {
//     const window = words.slice(i, i + windowSize)
//     const uniqueWords = new Set(window)
//     const ttr = uniqueWords.size / windowSize
//     totalTTR += ttr
//     windowCount++
//   }

//   return windowCount > 0 ? totalTTR / windowCount : 0
// }

// export async function POST(request: NextRequest) {
//   try {
//     const { essay } = await request.json()

//     if (!essay || essay.trim().length === 0) {
//       return NextResponse.json({ error: "Essay content is required" }, { status: 400 })
//     }

//     // Calculate MATTR locally
//     const words = essay.toLowerCase().match(/\b\w+\b/g) || []
//     const uniqueWords = new Set(words)
//     const mattrScore = calculateMATTR(essay)

//     let diversityLevel: "Low" | "Medium" | "High" = "Low"
//     if (mattrScore > 0.7) diversityLevel = "High"
//     else if (mattrScore > 0.5) diversityLevel = "Medium"

//     const lexicalPrompt = `
//     You are a lexical analysis expert. Analyze this essay for:

//     1. ACADEMIC WORD COVERAGE:
//     - Identify words from the Academic Word List (AWL) and Academic Formula List (AFL)
//     - Calculate coverage score based on appropriate academic vocabulary usage
//     - AWL Data: ${JSON.stringify(awlAflData.AWL.slice(0, 20))}
//     - AFL Data: ${JSON.stringify(awlAflData.AFL)}

//     2. LEXICAL PREVALENCE (COCA Corpus):
//     - Identify high-frequency vs low-frequency words
//     - Calculate prevalence score based on vocabulary sophistication
//     - COCA Data (sample): ${JSON.stringify(cocaData.slice(0, 50))}

//     3. LEXICAL DIVERSITY:
//     - Use the provided MATTR score: ${mattrScore.toFixed(3)}
//     - Total words: ${words.length}
//     - Unique words: ${uniqueWords.size}
//     - Diversity level: ${diversityLevel}

//     Provide specific examples and scores for each category.

//     In addition, generate a "feedback" array. For each issue (at word or sentence level), include:
// - type: "lexical"
// - message: concise suggestion (1–2 sentences)
// - start and end indexes (character offsets in the essay text)
// - optional Tailwind color class (e.g. "bg-yellow-200")

// Example format for one item (you may output multiple):
// {
//   "id": "f1",
//   "type": "lexical",
//   "message": "Replace vague word 'good' with a more academic alternative.",
//   "start": 47,
//   "end": 51,
//   "color": "bg-red-200"
// }

//     `

//     const result = await generateObject({
//       model: openai("gpt-4o"),
//       system: lexicalPrompt,
//       prompt: `Analyze the lexical features of this essay:\n\n${essay}`,
//       schema: LexicalAnalysisSchema,
//     })

//     // Override with calculated values
//     result.object.lexicalDiversity = {
//       mattrScore,
//       uniqueWords: uniqueWords.size,
//       totalWords: words.length,
//       diversityLevel,
//     }

//     return NextResponse.json(result.object)
//   } catch (error) {
//     console.error("Error analyzing lexical features:", error)
//     return NextResponse.json({ error: "Failed to analyze lexical features" }, { status: 500 })
//   }
// }

// import cocaData from "../../../data/coca-corpus.json"
//import awlAflData from "../../../data/awl-afl.json"

//    - AWL Data: ${JSON.stringify(awlAflData.AWL.slice(0, 20))}

// 3. LEXICAL PREVALENCE:
// - Use COCA corpus data to identify word frequency patterns
// - Flag overused high-frequency words that could be replaced
// - Identify sophisticated low-frequency words used well
// - COCA Data: ${JSON.stringify(cocaData.slice(0, 50))}
