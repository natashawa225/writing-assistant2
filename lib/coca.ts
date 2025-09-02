// COCA (Corpus of Contemporary American English) utilities
// Provides example sentences and frequency data for academic words

interface COCAExample {
  word: string
  sentence: string
  frequency: number
  register: string // academic, fiction, news, etc.
}

// Sample COCA data (in a real implementation, this would be a comprehensive database)
const COCA_EXAMPLES: { [key: string]: COCAExample[] } = {
  analysis: [
    {
      word: "analysis",
      sentence: "The statistical analysis revealed significant differences between the groups.",
      frequency: 45231,
      register: "academic",
    },
    {
      word: "analysis",
      sentence: "Further analysis of the data is needed to confirm these findings.",
      frequency: 45231,
      register: "academic",
    },
  ],
  approach: [
    {
      word: "approach",
      sentence: "This approach has been widely adopted in educational research.",
      frequency: 38942,
      register: "academic",
    },
    {
      word: "approach",
      sentence: "The researchers used a mixed-methods approach to collect data.",
      frequency: 38942,
      register: "academic",
    },
  ],
  demonstrate: [
    {
      word: "demonstrate",
      sentence: "The results demonstrate a clear correlation between the variables.",
      frequency: 23156,
      register: "academic",
    },
    {
      word: "demonstrate",
      sentence: "These findings demonstrate the effectiveness of the intervention.",
      frequency: 23156,
      register: "academic",
    },
  ],
  effect: [
    {
      word: "effect",
      sentence: "The treatment had a significant effect on patient outcomes.",
      frequency: 52341,
      register: "academic",
    },
    {
      word: "effect",
      sentence: "The effect of climate change on biodiversity is well documented.",
      frequency: 52341,
      register: "academic",
    },
  ],
  evidence: [
    {
      word: "evidence",
      sentence: "There is substantial evidence supporting this hypothesis.",
      frequency: 41287,
      register: "academic",
    },
    {
      word: "evidence",
      sentence: "The evidence suggests that early intervention is crucial.",
      frequency: 41287,
      register: "academic",
    },
  ],
}

export function getCOCAExamples(word: string, limit = 2): COCAExample[] {
  const lowerWord = word.toLowerCase()
  const examples = COCA_EXAMPLES[lowerWord] || []
  return examples.slice(0, limit)
}

export function getCOCAFrequency(word: string): number {
  const lowerWord = word.toLowerCase()
  const examples = COCA_EXAMPLES[lowerWord]
  return examples && examples.length > 0 ? examples[0].frequency : 0
}

export function addCOCAExample(word: string, example: COCAExample): void {
  const lowerWord = word.toLowerCase()
  if (!COCA_EXAMPLES[lowerWord]) {
    COCA_EXAMPLES[lowerWord] = []
  }
  COCA_EXAMPLES[lowerWord].push(example)
}

export function getAvailableWords(): string[] {
  return Object.keys(COCA_EXAMPLES)
}
