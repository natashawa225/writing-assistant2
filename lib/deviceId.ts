const SESSION_KEY = "session_id"

export function getOrCreateSessionId(): string | null {
  if (typeof window === "undefined") {
    return null
  }

  const existing = sessionStorage.getItem(SESSION_KEY)
  if (existing) {
    return existing
  }

  const nextId = crypto.randomUUID()
  sessionStorage.setItem(SESSION_KEY, nextId)
  return nextId
}
