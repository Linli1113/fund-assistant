import { getLatestNav } from './fundUtils'
import { toNumber } from './finance'

export const MARKET_OPEN_LABEL = '工作日 09:30-15:00'

export const computeHoldings = (txs = []) => {
  const EPSILON = 0.000001
  const map = new Map()
  for (const tx of txs) {
    if (!tx?.fundId) continue
    const current = map.get(tx.fundId) || {
      fundId: tx.fundId,
      shares: 0,
      cost: 0,
      amount: 0,
      buyCount: 0,
      firstBuyDate: '',
      lastBuyDate: '',
      transactions: [],
    }

    current.transactions.push(tx)

    if (tx.action === 'buy') {
      current.shares += toNumber(tx.shares, 0)
      current.cost += toNumber(tx.amount, 0)
      current.amount += toNumber(tx.amount, 0)
      current.buyCount += 1
      if (!current.firstBuyDate || tx.date < current.firstBuyDate) current.firstBuyDate = tx.date
      if (!current.lastBuyDate || tx.date > current.lastBuyDate) current.lastBuyDate = tx.date
    }

    if (tx.action === 'sell') {
      current.shares -= toNumber(tx.shares, 0)
      current.cost -= toNumber(tx.costImpact ?? tx.amount, 0)
    }

    current.shares = Math.max(0, current.shares)
    current.cost = Math.max(0, current.cost)

    map.set(tx.fundId, current)
  }

  return Array.from(map.values())
    .filter((item) => item.shares > EPSILON && item.cost > EPSILON)
    .map((item) => ({
      ...item,
      transactions: item.transactions.slice().sort((a, b) => `${b.date || ''}`.localeCompare(a.date || '')),
    }))
}

export const enrichHoldings = (holdings, getFundById) =>
  holdings
    .map((holding) => {
      const fund = getFundById(holding.fundId)
      if (!fund) return null
      const latestNav = getLatestNav(fund)
      const prevNav = toNumber(fund?.navSeries?.[fund.navSeries.length - 2]?.nav, latestNav)
      const value = latestNav * holding.shares
      const holdingIncome = value - holding.cost
      const holdingYield = holding.cost > 0 ? holdingIncome / holding.cost : 0
      const yesterdayIncome = holding.shares * (latestNav - prevNav)
      return {
        ...holding,
        fund,
        latestNav,
        prevNav,
        value,
        holdingIncome,
        holdingYield,
        yesterdayIncome,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
