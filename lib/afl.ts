import { aflLists } from "@/data/afl-list"

export interface AFLMatch {
  listIndex: number
  phrase: string
  match: string
  index: number
  feedback: string
  
}  

export function detectAFLphrase(text: string): AFLMatch[] {
  const matches: AFLMatch[] = []

  aflLists.forEach((list, listIndex) => {
    list.forEach((regexStr) => {
      try {
        const regex = new RegExp(regexStr, "gi")
        let match
        while ((match = regex.exec(text)) !== null) {
          matches.push({
            listIndex,
            phrase: regexStr,
            match: match[0],
            index: match.index,
            feedback: getFeedback(listIndex, match[0]),
          })
        }
      } catch (err) {
        console.warn("Invalid regex skipped:", regexStr)
      }
    })
  })

  return matches
}

function getFeedback(listIndex: number, phrase: string): string {
  switch (listIndex) {
    case 0:
      return `Academic filler: "${phrase}". Consider simplifying or rephrasing.`
    case 1:
      return `Conversational/Informal phrase: "${phrase}". Try using more formal academic tone.`
    case 2:
      return `Verbose or weak phrase: "${phrase}". Aim for precision.`
    default:
      return `Detected phrase: "${phrase}". You may want to revise it.`
  }
}
