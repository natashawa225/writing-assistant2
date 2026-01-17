//lib/awl.ts
import type { AFLPhrase, AFLRegister, DetectedAFL } from "@/lib/types"
import { awlLists } from "@/data/awl-list";

export function buildAFLIndex(phrases: AFLPhrase[]) {
  const index = new Map<string, AFLPhrase[]>();

  for (const p of phrases) {
    const normalized = p.phrase.toLowerCase().trim();
    const firstToken = normalized.split(" ")[0];

    if (!index.has(firstToken)) {
      index.set(firstToken, []);
    }

    index.get(firstToken)!.push({
      ...p,
      phrase: normalized
    });
  }

  // longest phrases first (critical)
  for (const list of index.values()) {
    list.sort((a, b) => b.phrase.length - a.phrase.length);
  }

  return index;
}


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
