export const getLatestNav = (fund) => {
  if (fund?.latestNav != null) return Number(fund.latestNav) || 1
  const last = fund?.navSeries?.[fund.navSeries.length - 1]
  return last?.nav ?? 1
}

export const getLatestDate = (fund) => {
  if (fund?.latestDate) return fund.latestDate
  const last = fund?.navSeries?.[fund.navSeries.length - 1]
  return last?.date ?? null
}

export const getNavOnDate = (fund, date) => {
  const series = fund?.navSeries || []
  if (!series.length) return null
  if (!date) return series[series.length - 1]?.nav ?? null
  const found = series.find((point) => point.date === date)
  if (found) return found.nav
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].date <= date) return series[i].nav
  }
  return null
}

export const getCommonDateRange = (funds) => {
  const allDates = funds.filter(Boolean).map((fund) => (fund.navSeries || []).map((point) => point.date))
  if (!allDates.length || allDates.some((dates) => dates.length === 0)) return []
  const intersection = new Set(allDates[0])
  for (let i = 1; i < allDates.length; i += 1) {
    for (const date of Array.from(intersection)) {
      if (!allDates[i].includes(date)) intersection.delete(date)
    }
  }
  return Array.from(intersection).sort()
}
