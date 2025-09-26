// Local storage utilities for essay management
export interface SavedEssay {
  id: string
  title: string
  content: string
  prompt: string
  createdAt: string
  updatedAt: string
}

export class EssayStorage {
  private static readonly STORAGE_KEY = "saved_essays"
  private static readonly API_KEY = "openai_api_key"

  static saveEssay(essay: Omit<SavedEssay, "id" | "createdAt" | "updatedAt">): SavedEssay {
    const essays = this.getAllEssays()
    const now = new Date().toISOString()

    const savedEssay: SavedEssay = {
      ...essay,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }

    essays.push(savedEssay)
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(essays))

    return savedEssay
  }

  static updateEssay(
    id: string,
    updates: Partial<Pick<SavedEssay, "title" | "content" | "prompt">>,
  ): SavedEssay | null {
    const essays = this.getAllEssays()
    const index = essays.findIndex((e) => e.id === id)

    if (index === -1) return null

    essays[index] = {
      ...essays[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(essays))
    return essays[index]
  }

  static deleteEssay(id: string): boolean {
    const essays = this.getAllEssays()
    const filteredEssays = essays.filter((e) => e.id !== id)

    if (filteredEssays.length === essays.length) return false

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filteredEssays))
    return true
  }

  static getAllEssays(): SavedEssay[] {
    if (typeof window === "undefined") return []

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  }

  static getEssay(id: string): SavedEssay | null {
    const essays = this.getAllEssays()
    return essays.find((e) => e.id === id) || null
  }

  static saveApiKey(apiKey: string): void {
    localStorage.setItem(this.API_KEY, apiKey)
  }

  static getApiKey(): string | null {
    if (typeof window === "undefined") return null
    return localStorage.getItem(this.API_KEY)
  }

  static hasApiKey(): boolean {
    return !!this.getApiKey()
  }
}
