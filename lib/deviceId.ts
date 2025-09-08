export function getDeviceId() {
  if (typeof window === "undefined") {
    // We're on the server, just return null (or handle differently)
    return null
  }

  let deviceId = localStorage.getItem("deviceId")
  if (!deviceId) {
    deviceId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2) + Date.now().toString(36)

    localStorage.setItem("deviceId", deviceId)
  }
  return deviceId
}
