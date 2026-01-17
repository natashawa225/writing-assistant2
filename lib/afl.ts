import aflWrittenRaw from "@/data/afl_written.json"
import aflSpokenRaw from "@/data/aflSpoken.json"
import aflWrittenSpokenRaw from "@/data/afl_writtenANDspoken.json"

const aflWritten = aflWrittenRaw as AFLPhrase[]
const aflSpoken = aflSpokenRaw as AFLPhrase[]
const aflWrittenSpoken = aflWrittenSpokenRaw as AFLPhrase[]

export type AFLRegister = "written" | "spoken" | "written_spoken"

export interface AFLPhrase {
  phrase: string
  register: AFLRegister
  freq_speech: number
  freq_writing: number
  ftw: number
}

/**
 * Build index ONCE
 */
function buildAFLIndex(phrases: AFLPhrase[]) {
  const index = new Map<string, AFLPhrase[]>()

  for (const p of phrases) {
    const normalized = p.phrase.toLowerCase().trim()
    const firstToken = normalized.split(" ")[0]

    if (!index.has(firstToken)) {
      index.set(firstToken, [])
    }

    index.get(firstToken)!.push({
      ...p,
      phrase: normalized,
    })
  }

  // Prefer longer phrases
  for (const list of index.values()) {
    list.sort((a, b) => b.phrase.length - a.phrase.length)
  }

  return index
}

/**
 * ✅ PRECOMPUTED INDICES (runs once)
 */
const AFL_INDICES = [
  buildAFLIndex(aflWritten),
  buildAFLIndex(aflSpoken),
  buildAFLIndex(aflWrittenSpoken),
]

export interface AFLMatch {
  listIndex: number
  phrase: string
  match: string
  index: number
}

export function detectAFLphrase(text: string): AFLMatch[] {
  const results: AFLMatch[] = []

  const normalized = text.toLowerCase().replace(/\s+/g, " ")
  const tokens = normalized.split(" ")

  let i = 0

  while (i < tokens.length) {
    let matched = false

    for (let listIndex = 0; listIndex < AFL_INDICES.length; listIndex++) {
      const indexMap = AFL_INDICES[listIndex]
      const candidates = indexMap.get(tokens[i])
      if (!candidates) continue

      for (const p of candidates) {
        const phraseTokens = p.phrase.split(" ")
        const slice = tokens.slice(i, i + phraseTokens.length)

        if (slice.join(" ") === p.phrase) {
          results.push({
            listIndex,
            phrase: p.phrase,
            match: slice.join(" "),
            index: i,
          })

          i += phraseTokens.length
          matched = true
          break
        }
      }

      if (matched) break
    }

    if (!matched) i++
  }

  return results
}