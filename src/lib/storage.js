export const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export const writeJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value))
}

export const uid = (prefix = 'id') => {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

