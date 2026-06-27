const requestJson = async (url, options = {}) => {
  const res = await fetch(url, options)
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload || payload.code !== 0) {
    const message = payload?.detail || payload?.message || '请求基金数据失败'
    throw new Error(message)
  }
  return payload.data
}

export const searchFunds = async (filters = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value == null || value === '' || value === 'all') return
    params.set(key, String(value))
  })
  return requestJson(`/api/funds?${params.toString()}`)
}

export const fetchFundDetail = async (fundId) => requestJson(`/api/funds/${fundId}`)

export const fetchIndexHistory = async (symbol, startDate, endDate) => {
  const params = new URLSearchParams()
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  const qs = params.toString()
  return requestJson(`/api/indexes/${symbol}/history${qs ? `?${qs}` : ''}`)
}

export const chatAssistant = async (payload) =>
  requestJson('/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
