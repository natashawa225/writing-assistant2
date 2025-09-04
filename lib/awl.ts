//lib/awl.ts
import { awlLists } from "@/data/awl-list";

export function detectAWLWordsBySublist(text: string) {
  const detected: { word: string; sublist: string }[] = []

  awlLists.forEach((list, index) => {
    const pattern = new RegExp(list.join('|'), 'gi')
    const matches = text.match(pattern)
    if (matches) {
      matches.forEach(word => {
        detected.push({
          word,
          sublist: mapSublistToLabel(index + 1), // ✅ label instead of raw number
        })
      })
    }
  })

  return detected
}

function mapSublistToLabel(sublist: number): string {
  if (sublist >= 1 && sublist <= 2) return "Core Academic Words"
  if (sublist >= 3 && sublist <= 5) return "Useful Academic Words"
  if (sublist >= 6 && sublist <= 8) return "Specialized Academic Words"
  if (sublist >= 9 && sublist <= 10) return "Advanced / Rare Academic Words"
  return "Unclassified"
}
