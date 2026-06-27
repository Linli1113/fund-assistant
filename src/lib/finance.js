export const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

export const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export const sum = (arr) => arr.reduce((a, b) => a + b, 0)

export const pct = (v, digits = 2) => `${(v * 100).toFixed(digits)}%`

export const safeDiv = (a, b, fallback = 0) => (b === 0 ? fallback : a / b)

export const seriesToReturns = (values) => {
  const rets = []
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1]
    const cur = values[i]
    if (prev <= 0) rets.push(0)
    else rets.push(cur / prev - 1)
  }
  return rets
}

export const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0)

export const std = (xs) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = mean(xs.map((x) => (x - m) ** 2))
  return Math.sqrt(v)
}

export const maxDrawdown = (values) => {
  let peak = -Infinity
  let mdd = 0
  for (const v of values) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = v / peak - 1
      if (dd < mdd) mdd = dd
    }
  }
  return mdd
}

export const recoveryDays = (values) => {
  if (values.length < 2) return 0
  let peak = values[0]
  let peakIndex = 0
  let trough = values[0]
  let troughIndex = 0
  let inDrawdown = false
  let worstRecovery = 0

  for (let i = 1; i < values.length; i += 1) {
    const v = values[i]
    if (v >= peak) {
      if (inDrawdown) {
        const rec = i - peakIndex
        if (rec > worstRecovery) worstRecovery = rec
      }
      peak = v
      peakIndex = i
      trough = v
      troughIndex = i
      inDrawdown = false
      continue
    }

    inDrawdown = true
    if (v < trough) {
      trough = v
      troughIndex = i
    }

    if (v >= peak && troughIndex > peakIndex) {
      const rec = i - peakIndex
      if (rec > worstRecovery) worstRecovery = rec
      inDrawdown = false
    }
  }

  return worstRecovery
}

export const sharpe = (dailyReturns, riskFreeDaily = 0) => {
  if (!dailyReturns.length) return 0
  const excess = dailyReturns.map((r) => r - riskFreeDaily)
  const m = mean(excess)
  const s = std(excess)
  return s === 0 ? 0 : (m / s) * Math.sqrt(252)
}

export const annualizedVol = (dailyReturns) => std(dailyReturns) * Math.sqrt(252)

export const weightedAverage = (items, weightKey, valueFn) => {
  const totalW = sum(items.map((it) => it[weightKey] || 0))
  if (totalW <= 0) return 0
  return (
    sum(items.map((it) => (it[weightKey] || 0) * toNumber(valueFn(it), 0))) / totalW
  )
}

export const mergeExposure = (items, weightKey, exposureGetter) => {
  const out = {}
  const totalW = sum(items.map((it) => it[weightKey] || 0))
  if (totalW <= 0) return out
  for (const it of items) {
    const w = (it[weightKey] || 0) / totalW
    const exp = exposureGetter(it) || {}
    for (const [k, v] of Object.entries(exp)) {
      out[k] = (out[k] || 0) + w * v
    }
  }
  return out
}

export const topConcentration = (weights) => {
  const ws = weights.filter((w) => w > 0).sort((a, b) => b - a)
  const top1 = ws[0] || 0
  const hhi = sum(ws.map((w) => w ** 2))
  return { top1, hhi }
}

