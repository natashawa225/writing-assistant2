// lib/awl.ts
import awlLookup from "@/data/awl_lookup.json"

// Precompute map: word (lowercase) -> sublist number
const AWL_MAP: Record<string, number> = {}
for (const [word, sublist] of Object.entries(awlLookup)) {
  AWL_MAP[word.toLowerCase()] = sublist
}

export function detectAWLWordsBySublist(text: string) {
  const detected: { word: string; sublist: string; start: number; end: number }[] = [];

  // Tokenize with offsets
  let cursor = 0;
  const regex = /\b\w+\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const word = match[0].toLowerCase();
    const sublist = AWL_MAP[word];
    if (sublist !== undefined) {
      detected.push({
        word: match[0],          // preserve original casing
        sublist: mapSublistToLabel(sublist),
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    cursor = match.index + match[0].length;
  }

  return detected;
}

function mapSublistToLabel(sublist: number): string {
  if (sublist >= 1 && sublist <= 2) return "Core Academic Words"
  if (sublist >= 3 && sublist <= 5) return "Useful Academic Words"
  if (sublist >= 6 && sublist <= 8) return "Specialized Academic Words"
  if (sublist >= 9 && sublist <= 10) return "Advanced / Rare Academic Words"
  return "Unclassified"
}