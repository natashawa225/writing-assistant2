// lib/coca.ts
import cocaDataJson from "../data/coca_examples.json";

type COCAData = Record<string, string[]>; // key = word, value = array of example sentences
const cocaData: COCAData = cocaDataJson;

export function getCOCAExamples(word: string, maxExamples = 3): string[] {
  const lowerWord = word.toLowerCase();
  if (cocaData[lowerWord]) {
    return cocaData[lowerWord].slice(0, maxExamples);
  }
  return [];
}
