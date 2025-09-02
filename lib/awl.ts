//lib/awl.ts
import { awlLists } from "@/data/awl-list";

export function detectAWLWordsBySublist(text: string) {
  const detected: { word: string; sublist: number }[] = [];

  awlLists.forEach((list, index) => {
    const pattern = new RegExp(list.join('|'), 'gi');
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(word => {
        detected.push({ word, sublist: index + 1 }); // sublist numbers 1–10
      });
    }
  });

  return detected;
}
