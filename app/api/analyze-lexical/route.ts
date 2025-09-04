import { type NextRequest, NextResponse } from "next/server"
import { openai } from "@ai-sdk/openai"
import { generateObject } from "ai"
import { z } from "zod"
import { detectAWLWordsBySublist } from "@/lib/awl"
import { getCOCAExamples } from "@/lib/coca"
import { detectAFLphrase } from "@/lib/afl"

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
        reason: z.string(),
        suggestion: z.string(),
        sublist: z.string(),
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
        reason: z.string(),
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

export interface AFLMatch {
  listIndex: number
  phrase: string
  match: string
  index: number
  feedback: string
  reason: string
}

function getFeedback(listIndex: number, phrase: string): { feedback: string; reason: string } {
  switch (listIndex) {
    case 0:
      return {
        feedback: `Academic filler: "${phrase}". Consider simplifying or rephrasing.`,
        reason: `Phrases from list 0 tend to pad writing without adding meaning, which weakens clarity.`,
      }
    case 1:
      return {
        feedback: `Conversational/Informal phrase: "${phrase}". Try using more formal academic tone.`,
        reason: `List 1 phrases are informal and may reduce the academic credibility of the essay.`,
      }
    case 2:
      return {
        feedback: `Verbose or weak phrase: "${phrase}". Aim for precision.`,
        reason: `List 2 phrases are wordy or imprecise, which can obscure the main argument.`,
      }
    default:
      return {
        feedback: `Detected phrase: "${phrase}". You may want to revise it.`,
        reason: `This phrase was flagged but not categorized. Revise if it weakens clarity.`,
      }
  }
}
function mapFTWtoValue(score: number) {
  if (score >= 0.75) return "Essential 🟢 Green"
  if (score >= 0.50) return "Useful 🟡 Yellow"
  if (score >= 0.25) return "Advanced 🟠 Orange"
  return "Rare 🔴 Red"
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
    const aflMatches = detectAFLphrase(essay)

    const aflSuggestions = aflMatches.map(m => {
      const { feedback, reason } = getFeedback(m.listIndex, m.match)
      const cocaExamples = getCOCAExamples(m.match, 2)
    
      return {
        original: m.match,
        suggestion: "rewrite with more concise/formal academic phrasing",
        value: "Pending GPT classification", // ✅ temp, GPT will overwrite
        explanation: feedback,
        example: cocaExamples.length > 0 
          ? cocaExamples.join(" | ") 
          : `Instead of "${m.match}", try a more precise construction.`,
        reason,
      }
    })
      


    // Calculate MATTR locally
    const words = essay.toLowerCase().match(/\b\w+\b/g) || []
    const uniqueWords = new Set(words)
    const mattrScore = calculateMATTR(essay)

    let diversityLevel: "Low" | "Medium" | "High" = "Low"
    if (mattrScore > 0.7) diversityLevel = "High"
    else if (mattrScore > 0.5) diversityLevel = "Medium"

    // After calculating mattrScore, words, uniqueWords
    const wordFrequency = (words as string[]).reduce<Record<string, number>>((acc, w) => {
      acc[w] = (acc[w] || 0) + 1
      return acc
    }, {})

    const topWords = Object.entries(wordFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word, count]) => `${word} (${count})`)

    let lexicalFeedback = ""
    let lexicalSuggestions: string[] = []

    if (mattrScore > 0.7) {
      lexicalFeedback = `Great work! A MATTR score of ${(mattrScore*100).toFixed(1)} shows strong lexical diversity. Keep building on this strength by experimenting with synonyms and nuanced word choices.`
      lexicalSuggestions = [`Your top 5 most frequent words are: ${topWords.join(", ")}. Consider how you might replace one or two of them occasionally to enrich your expression.`]
    } else {
      lexicalFeedback = `Your MATTR score of ${(mattrScore*100).toFixed(1)} suggests room for more variety. Try noticing which words you repeat often and think of academic alternatives.`
      lexicalSuggestions = [`Your top 5 most frequent words are: ${topWords.join(", ")}. Reflect on whether any of these could be substituted with precise academic vocabulary.`]
    }

    const lexicalPrompt = `
    You are a lexical analysis expert. Analyze this essay for academic writing quality using these specific criteria:

    1. AWL COVERAGE:
    - Identify words from the Academic Word List (AWL).
    - For each AWL word:
      * suggestion.reason: write 2–3 sentences that guide students to reflect indirectly on how their vocabulary choice impacts clarity, precision, or persuasiveness. Do not give the corrected answer here.
      * suggestion.suggestion: provide the corrected academic alternative word.
      * suggestion.explanation: explain why the suggested academic word is stronger than the original.
      * suggestion.example: generate an example sentence using the suggested word. Example sentences must come from the COCA dataset provided: ${JSON.stringify(awlFeedbackData)}.
    - Classify suggestions into categories: "Foundation words", "Expanding words", "Mastery words", "Expert words".
    - Calculate coverage score (0–100).

    2. AFL COVERAGE:
    - Identify phrases from the Academic Formula List (AFL): ${JSON.stringify(aflMatches)}.
    - For each AFL phrase:
      * suggestion.reason: write 2–3 sentences that encourage reflection on whether the phrase fits an academic tone, without giving the corrected phrase.
      * suggestion.suggestion: provide the more formal/precise academic phrase.
      * suggestion.explanation: explain why the suggested phrase is stronger in academic contexts.
      * suggestion.example: generate an example sentence using the suggested phrase. Example sentences must come from the COCA dataset when possible.
      * suggestion.value: classify based on phrase frequency (FTW score) using these thresholds:
        - 0.75–1.00 → Essential: "Very common in academic writing — this is a strong, natural choice."
        - 0.50–0.74 → Useful: "Good phrase, but less frequent. You can use it, but there may be stronger alternatives."
        - 0.25–0.49 → Advanced: "Less common in student writing. Use sparingly — may sound formal or discipline-specific."
        - 0.00–0.24 → Rare: "Rare phrase — may sound unusual or overly formal. Consider a more common academic phrase."
    - Calculate coverage score (0–100).

    3. LEXICAL DIVERSITY:
    - Use the calculated MATTR score: ${mattrScore.toFixed(3)}.
    - Total words: ${words.length}, Unique words: ${uniqueWords.size}.
    - Assign diversity level: ${diversityLevel}.
    - Provide specific feedback and improvement suggestions unless MATTR > 0.7, in which case only encouragement is needed.

    Output must match the provided schema exactly.
    `


    const result = await generateObject({
      model: openai("gpt-5-mini"),
      system: lexicalPrompt,
      prompt: `Analyze the lexical features of this essay and provide detailed feedback:\n\n${essay}`,
      schema: LexicalAnalysisSchema,
    })

    // Override lexical diversity with calculated values
    // result.object.lexicalDiversity = {
    //   ...result.object.lexicalDiversity,
    //   mattr: mattrScore,
    //   uniqueWords: uniqueWords.size,
    //   totalWords: words.length,
    //   diversityLevel,
    // }

    result.object.lexicalDiversity = {
      mattr: mattrScore,
      uniqueWords: uniqueWords.size,
      totalWords: words.length,
      diversityLevel,
      feedback: lexicalFeedback,
      suggestions: lexicalSuggestions,
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
