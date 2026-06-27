import { useEffect, useMemo, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { useLocalStorageState } from '../lib/useLocalStorageState'
import { LS_KEYS } from '../lib/keys'
import { annualizedVol, maxDrawdown, pct, recoveryDays, seriesToReturns, sharpe, toNumber, topConcentration } from '../lib/finance'
import { uid } from '../lib/storage'
import { useFunds } from '../lib/fundsContext'
import { getCommonDateRange, getNavOnDate } from '../lib/fundUtils'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

const monthKey = (d) => d.slice(0, 7)

const buildSipDates = (dates, interval) => {
  if (!dates.length) return []
  if (interval === 'monthly') {
    const out = []
    let lastMonth = null
    for (const d of dates) {
      const mk = monthKey(d)
      if (mk !== lastMonth) {
        out.push(d)
        lastMonth = mk
      }
    }
    return out
  }
  const step = interval === 'biweekly' ? 10 : 5
  const out = []
  for (let i = 0; i < dates.length; i += step) out.push(dates[i])
  return out
}

const cosineSimilarity = (a, b) => {
  const keys = Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})]))
  let dot = 0
  let na = 0
  let nb = 0
  for (const k of keys) {
    const va = toNumber(a?.[k], 0)
    const vb = toNumber(b?.[k], 0)
    dot += va * vb
    na += va * va
    nb += vb * vb
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const buildSipScheduleSet = (dates, startDate, interval) => {
  const from = dates.filter((d) => d >= startDate)
  const picks = buildSipDates(from, interval)
  return new Set(picks)
}

const chooseBenchmarkMeta = (funds) => {
  if (!funds.length) return null
  const explicit = funds.find((f) => f.benchmarkCode)
  if (explicit?.benchmarkCode) {
    return { symbol: explicit.benchmarkCode, name: explicit.benchmarkName || explicit.benchmarkCode }
  }
  const allBond = funds.every((f) => f.type === '债券基金')
  const allMoney = funds.every((f) => f.type === '货币基金')
  if (allMoney) return null
  if (allBond) return { symbol: 'sh000012', name: '上证国债指数' }
  return { symbol: 'sh000300', name: '沪深300' }
}

const BENCHMARK_OPTIONS = [
  { symbol: 'sh000300', name: '沪深300' },
  { symbol: 'sh000001', name: '上证指数' },
  { symbol: 'sh000016', name: '上证50' },
  { symbol: 'sh000905', name: '中证500' },
  { symbol: 'sz399001', name: '深证成指' },
  { symbol: 'cbond_mixed', name: '中债混合' },
]

const normalizeLine = (values) => {
  if (!values?.length) return []
  const base = values[0]
  if (!base || base <= 0) return values.map(() => 1)
  return values.map((v) => Number((v / base).toFixed(4)))
}

const formatRelativeReturn = (value) => {
  const ret = (toNumber(value, 1) - 1) * 100
  return `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`
}

const buildPortfolioSeries = ({
  funds,
  startDate,
  history,
}) => {
  const fundById = Object.fromEntries(funds.map((fund) => [fund.id, fund]))
  const dates = getCommonDateRange(funds).filter((d) => d >= startDate)
  if (!dates.length) return { dates: [], values: [], perFundValues: {}, meta: null }

  const holdings = Object.fromEntries(funds.map((f) => [f.id, 0]))
  let cash = 0

  const byOnceDate = new Map()
  const sipSchedules = []

  for (const h of history) {
    if (!h?.fundId || !h?.startDate) continue
    if (h.type === 'once') {
      const list = byOnceDate.get(h.startDate) || []
      list.push(h)
      byOnceDate.set(h.startDate, list)
      continue
    }
    if (h.type === 'sip') {
      sipSchedules.push({
        fundId: h.fundId,
        amount: toNumber(h.amount, 0),
        schedule: buildSipScheduleSet(dates, h.startDate, h.interval || 'monthly'),
      })
    }
  }

  const perFundValues = Object.fromEntries(funds.map((f) => [f.id, []]))
  const values = []

  const buyFund = (date, fundId, amount) => {
    const fund = fundById[fundId]
    if (!fund) return
    const nav = getNavOnDate(fund, date)
    if (!nav || nav <= 0) return
    const amt = Math.max(0, toNumber(amount, 0))
    if (amt <= 0) return
    cash += amt
    const fee = amt * fund.feeRate
    const net = Math.max(0, amt - fee)
    const shares = net / nav
    cash -= amt
    holdings[fund.id] += shares
  }

  for (const d of dates) {
    const onceList = byOnceDate.get(d) || []
    for (const h of onceList) buyFund(d, h.fundId, h.amount)
    for (const s of sipSchedules) {
      if (!s.schedule.has(d)) continue
      buyFund(d, s.fundId, s.amount)
    }

    let total = cash
    for (const f of funds) {
      const nav = getNavOnDate(f, d)
      const v = (nav || 0) * holdings[f.id]
      perFundValues[f.id].push(v)
      total += v
    }
    values.push(total)
  }

  return {
    dates,
    values,
    perFundValues,
    meta: { startValue: values[0] || 0, endValue: values[values.length - 1] || 0, cash },
  }
}

export default function Simulation() {
  const [watchlist, setWatchlist] = useLocalStorageState(LS_KEYS.watchlist, [])
  const [buyHistory, setBuyHistory] = useLocalStorageState(LS_KEYS.simBuyHistory, [])
  const [selectedIds, setSelectedIds] = useLocalStorageState(LS_KEYS.simSelectedFundIds, [])
  const { ensureFundDetails, getFundById, loadIndexSeries } = useFunds()

  const watchFunds = useMemo(() => watchlist.map((id) => getFundById(id)).filter(Boolean), [getFundById, watchlist])

  const [benchmarkHistory, setBenchmarkHistory] = useState([])
  const [benchmarkError, setBenchmarkError] = useState('')

  useEffect(() => {
    ensureFundDetails(watchlist).catch(() => {})
  }, [ensureFundDetails, watchlist])

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = (prev || []).filter((id) => watchlist.includes(id))
      if (next.length) return next
      return watchlist.slice(0, 3)
    })
  }, [setSelectedIds, watchlist])

  const selectedFunds = useMemo(() => selectedIds.map((id) => getFundById(id)).filter(Boolean), [getFundById, selectedIds])
  const commonDates = useMemo(() => getCommonDateRange(selectedFunds), [selectedFunds])
  const defaultStartDate = commonDates[Math.max(0, commonDates.length - 120)] || commonDates[0] || ''

  const [activeModal, setActiveModal] = useState(null)
  const [watchlistModalOpen, setWatchlistModalOpen] = useState(false)
  const [historyFundFilter, setHistoryFundFilter] = useState('all')
  const [historyDetailId, setHistoryDetailId] = useState(null)
  const [chartRange, setChartRange] = useState('3m')
  const [activeBenchmark, setActiveBenchmark] = useState(BENCHMARK_OPTIONS[0])

  const feeStats = useMemo(() => {
    if (!selectedFunds.length) return { avg: 0 }
    const avg = selectedFunds.reduce((acc, f) => acc + toNumber(f.feeRate, 0), 0) / selectedFunds.length
    return { avg }
  }, [selectedFunds])

  const filteredHistory = useMemo(() => {
    const set = new Set(selectedIds)
    return (buyHistory || []).filter((h) => set.has(h.fundId)).slice().sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
  }, [buyHistory, selectedIds])

  const visibleHistory = useMemo(() => {
    if (historyFundFilter === 'all') return filteredHistory
    return filteredHistory.filter((h) => h.fundId === historyFundFilter)
  }, [filteredHistory, historyFundFilter])

  const seriesStartDate = useMemo(() => {
    const ds = filteredHistory.map((h) => h.startDate).filter(Boolean).sort()
    return ds[0] || ''
  }, [filteredHistory])

  const series = useMemo(() => {
    if (!selectedFunds.length || !seriesStartDate || filteredHistory.length === 0) return null
    return buildPortfolioSeries({
      funds: selectedFunds,
      startDate: seriesStartDate,
      history: filteredHistory,
    })
  }, [filteredHistory, selectedFunds, seriesStartDate])

  const metrics = useMemo(() => {
    if (!series?.values?.length) return null
    const values = series.values
    const rets = seriesToReturns(values)
    const totalReturn = values[0] > 0 ? values[values.length - 1] / values[0] - 1 : 0
    return {
      totalReturn,
      maxDrawdown: maxDrawdown(values),
      sharpe: sharpe(rets, 0),
      vol: annualizedVol(rets),
      recoveryDays: recoveryDays(values),
    }
  }, [series])

  const benchmarkMeta = useMemo(() => chooseBenchmarkMeta(selectedFunds), [selectedFunds])

  useEffect(() => {
    if (!selectedFunds.length) return
    const matched =
      BENCHMARK_OPTIONS.find((item) => item.symbol === benchmarkMeta?.symbol || item.name === benchmarkMeta?.name) ||
      (selectedFunds.every((fund) => fund.type === '债券基金')
        ? BENCHMARK_OPTIONS.find((item) => item.symbol === 'cbond_mixed')
        : BENCHMARK_OPTIONS[0])
    if (matched) setActiveBenchmark(matched)
  }, [benchmarkMeta?.name, benchmarkMeta?.symbol, selectedFunds])

  useEffect(() => {
    if (!activeBenchmark?.symbol || !series?.dates?.length) {
      setBenchmarkHistory([])
      setBenchmarkError('')
      return
    }
    loadIndexSeries(activeBenchmark.symbol, series.dates[0], series.dates[series.dates.length - 1])
      .then((list) => {
        setBenchmarkHistory(list)
        setBenchmarkError('')
      })
      .catch((err) => {
        setBenchmarkHistory([])
        setBenchmarkError(err.message || '基准指数加载失败')
      })
  }, [activeBenchmark?.symbol, loadIndexSeries, series])

  const benchmarkSeries = useMemo(() => {
    if (!activeBenchmark?.symbol || !series?.dates?.length || !benchmarkHistory.length) return []
    const valueMap = new Map(benchmarkHistory.map((item) => [item.date, item.value]))
    const alignedValues = []
    let lastValue = null
    for (const date of series.dates) {
      const value = valueMap.get(date) ?? lastValue
      if (value == null) return []
      alignedValues.push(value)
      lastValue = value
    }
    if (!alignedValues.length || !alignedValues[0]) return []
    const base = alignedValues[0]
    return alignedValues.map((value) => Number((value / base).toFixed(4)))
  }, [activeBenchmark?.symbol, benchmarkHistory, series])

  const chartView = useMemo(() => {
    if (!series?.dates?.length) return null
    const sizeMap = { '1m': 22, '3m': 66, all: series.dates.length }
    const size = Math.min(sizeMap[chartRange] || series.dates.length, series.dates.length)
    const dateSlice = series.dates.slice(-size)
    const portfolioSlice = series.values.slice(-size)
    const benchmarkSlice = benchmarkSeries.slice(-size)
    const portfolioLine = normalizeLine(portfolioSlice)
    const benchmarkLine = normalizeLine(benchmarkSlice)
    const portfolioReturn = portfolioLine.length ? portfolioLine[portfolioLine.length - 1] - 1 : 0
    return {
      labels: dateSlice,
      portfolioLine,
      benchmarkLine,
      portfolioReturn,
    }
  }, [benchmarkSeries, chartRange, series])

  const chartData = useMemo(() => {
    if (!chartView?.labels?.length) return null
    return {
      labels: chartView.labels,
      datasets: [
        {
          label: '组合净值',
          data: chartView.portfolioLine,
          borderColor: '#111827',
          backgroundColor: (context) => {
            const { chart } = context
            const area = chart.chartArea
            if (!area) return 'rgba(17, 24, 39, 0.10)'
            const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom)
            gradient.addColorStop(0, 'rgba(17, 24, 39, 0.22)')
            gradient.addColorStop(1, 'rgba(17, 24, 39, 0.02)')
            return gradient
          },
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: '#111827',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2,
          borderWidth: 2.5,
          tension: 0.36,
        },
        ...(benchmarkSeries.length
          ? [
              {
                label: `${activeBenchmark?.name || '基准指数'}（基准）`,
                data: chartView.benchmarkLine,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0)',
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: '#f59e0b',
                pointHoverBorderColor: '#ffffff',
                pointHoverBorderWidth: 2,
                borderWidth: 2.2,
                tension: 0.32,
                borderDash: [7, 5],
              },
            ]
          : []),
      ],
    }
  }, [activeBenchmark?.name, benchmarkSeries.length, chartView])

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'start',
          labels: {
            usePointStyle: true,
            pointStyle: 'line',
            boxWidth: 20,
            boxHeight: 8,
            color: '#374151',
            font: {
              size: 12,
              weight: '600',
            },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.92)',
          titleColor: '#ffffff',
          bodyColor: '#f9fafb',
          padding: 12,
          displayColors: true,
          boxPadding: 4,
          callbacks: {
            label: (context) => `${context.dataset.label}：${formatRelativeReturn(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 6,
            color: 'rgba(55, 65, 81, 0.72)',
            font: {
              size: 11,
            },
          },
          grid: {
            display: false,
          },
          border: {
            display: false,
          },
        },
        y: {
          ticks: {
            maxTicksLimit: 6,
            color: 'rgba(55, 65, 81, 0.72)',
            font: {
              size: 11,
            },
            callback: (value) => formatRelativeReturn(value),
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.16)',
            drawBorder: false,
          },
          border: {
            display: false,
          },
        },
      },
    }),
    [],
  )

  const removeHistory = (id) => setBuyHistory((prev) => (prev || []).filter((x) => x.id !== id))
  const clearHistory = () => setBuyHistory([])

  const portfolioSnapshot = useMemo(() => {
    if (!series?.dates?.length) return null
    const lastDate = series.dates[series.dates.length - 1]
    const rows = selectedFunds
      .map((f) => {
        const values = series.perFundValues?.[f.id]
        const lastValue = values?.[values.length - 1] ?? 0
        return { fund: f, value: toNumber(lastValue, 0) }
      })
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
    const total = rows.reduce((acc, r) => acc + r.value, 0)
    const weights = rows.map((r) => (total > 0 ? r.value / total : 0))
    const conc = topConcentration(weights)

    const typeMap = new Map()
    for (const r of rows) {
      const key = r.fund.type
      typeMap.set(key, (typeMap.get(key) || 0) + (total > 0 ? r.value / total : 0))
    }

    const aggregateIndustry = {}
    for (const r of rows) {
      const w = total > 0 ? r.value / total : 0
      for (const [k, v] of Object.entries(r.fund.exposures?.industry || {})) {
        aggregateIndustry[k] = (aggregateIndustry[k] || 0) + w * toNumber(v, 0)
      }
    }
    const topIndustries = Object.entries(aggregateIndustry)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)

    const industrySims = []
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const si = cosineSimilarity(rows[i].fund.exposures?.industry || {}, rows[j].fund.exposures?.industry || {})
        industrySims.push(si)
      }
    }
    const avgIndustrySim = industrySims.length
      ? industrySims.reduce((a, b) => a + b, 0) / industrySims.length
      : 0

    const typeSummary = Array.from(typeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}${pct(v, 0)}`)
      .join('、')

    const topIndustrySummary = topIndustries.length
      ? topIndustries.map(([k, v]) => `${k}${pct(v, 0)}`).join('、')
      : '暂无明显行业集中'

    let diversificationLevel = '分散度较好'
    if (rows.length <= 1 || conc.top1 >= 0.6 || conc.hhi >= 0.45) diversificationLevel = '分散度偏弱'
    else if (conc.top1 >= 0.45 || conc.hhi >= 0.35) diversificationLevel = '分散度一般'

    let correlationLevel = '行业重叠相对可控'
    if (avgIndustrySim >= 0.8) correlationLevel = '行业重叠偏高'
    else if (avgIndustrySim >= 0.6) correlationLevel = '行业重叠中等'

    const suggestionParts = []
    if (rows.length <= 1) suggestionParts.push('适当增加不同类型基金，避免单基金暴露过高')
    if (conc.top1 >= 0.5) suggestionParts.push('降低单一基金集中度，控制第一大持仓占比')
    if (avgIndustrySim >= 0.75) suggestionParts.push('增加低相关行业或不同风格资产，降低同涨同跌风险')
    if (metrics?.maxDrawdown <= -0.2) suggestionParts.push('关注回撤控制，可加入更稳健资产平滑波动')
    if (!suggestionParts.length) suggestionParts.push('当前组合结构相对均衡，可持续关注费率、回撤与投入节奏')

    const diagnosis = {
      part1: `当前组合共 ${rows.length} 只基金，第一大持仓占比 ${pct(conc.top1, 1)}，分散度指数 HHI 为 ${conc.hhi.toFixed(2)}，整体属于“${diversificationLevel}”。类型分布上，主要由 ${typeSummary || '暂无有效持仓'} 构成。`,
      part2: `从行业暴露看，当前组合主要集中在 ${topIndustrySummary}。组合内基金的平均行业相似度为 ${avgIndustrySim.toFixed(2)}，说明当前行业相关性处于“${correlationLevel}”状态。`,
      part3: `建议优先从以下方向优化：${suggestionParts.join('；')}。以上为基于当前模拟持仓和买入方案生成的方向性建议，会随着所选组合与买入历史变化而同步调整。`,
    }

    return { lastDate, rows, total, conc, avgIndustrySim, diagnosis }
  }, [getFundById, selectedFunds, series])

  const historyDetail = useMemo(() => {
    if (!historyDetailId) return null
    const h = (buyHistory || []).find((x) => x.id === historyDetailId)
    if (!h) return null
    const fund = getFundById(h.fundId)
    const bankLabel = BANKS.find((b) => b.id === h.bankId)?.name || h.bankId
    return { ...h, fund, bankLabel }
  }, [buyHistory, getFundById, historyDetailId])

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setWatchlistModalOpen(true)}
            style={{ flex: 1 }}
          >
            自选库
          </button>
          <div className="pill">
            已加入 {watchlist.length} · 已选择 {selectedFunds.length}
          </div>
        </div>

        {watchFunds.length === 0 ? (
          <div className="muted">还没有自选基金。先到「智能选基」里加入自选。</div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            点击上方「自选库」选择要参与模拟的基金；已选择基金默认等权买入。
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>买入方式</div>
        </div>
        <div className="grid2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!selectedFunds.length || !commonDates.length}
            onClick={() => setActiveModal('sip')}
          >
            定投
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!selectedFunds.length || !commonDates.length}
            onClick={() => setActiveModal('once')}
          >
            购买
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          说明：买入将从“扣款银行卡”模拟扣款；不涉及真实交易与资金。
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>买入历史</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={clearHistory} disabled={!filteredHistory.length}>
            一键清空
          </button>
        </div>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <select className="select" value={historyFundFilter} onChange={(e) => setHistoryFundFilter(e.target.value)}>
            <option value="all">按基金筛选：全部</option>
            {selectedFunds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}（{f.code}）
              </option>
            ))}
          </select>
        </div>

        {visibleHistory.length === 0 ? (
          <div className="muted">暂无记录。可在上方「定投 / 购买」里创建买入记录。</div>
        ) : (
          <div className="stack">
            {visibleHistory.map((h) => {
              const fund = getFundById(h.fundId)
              const bankLabel = BANKS.find((b) => b.id === h.bankId)?.name || h.bankId
              return (
                <div key={h.id} className="xh-card" onClick={() => setHistoryDetailId(h.id)} style={{ cursor: 'pointer' }}>
                  <div className="xh-header">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="xh-title">{fund?.name || h.fundId}</div>
                      <div className="xh-sub">
                        {h.type === 'sip' ? '定投' : '购买'} · 起投 {h.startDate} · ¥{toNumber(h.amount, 0).toFixed(2)}
                      </div>
                    </div>
                    <span className={h.type === 'sip' ? 'tag tag-warm' : 'tag'}>{h.type === 'sip' ? '定投' : '购买'}</span>
                  </div>
                  <div className="tags" style={{ marginTop: 10 }}>
                    <span className="tag">扣款卡：{bankLabel}</span>
                    {h.type === 'sip' && <span className="tag">间隔：{h.interval || 'monthly'}</span>}
                    {h.createdAt && <span className="tag">创建：{h.createdAt}</span>}
                  </div>
                  <div className="xh-actions">
                    <button type="button" className="btn btn-secondary btn-small" onClick={(e) => { e.stopPropagation(); setHistoryDetailId(h.id) }}>
                      详情
                    </button>
                    <button type="button" className="btn btn-danger btn-small" onClick={(e) => { e.stopPropagation(); removeHistory(h.id) }}>
                      删除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>结果概览</div>
          {activeBenchmark && <div className="pill">基准：{activeBenchmark.name}</div>}
        </div>

        {!series?.values?.length ? (
          <div className="muted">选择基金、起投日期，并完成买入方式设置后即可生成曲线。</div>
        ) : (
          <div className="stack">
            <div className="grid2">
              <div className="pill">累计收益 {pct(metrics?.totalReturn || 0, 2)}</div>
              <div className="pill">最大回撤 {pct(metrics?.maxDrawdown || 0, 2)}</div>
              <div className="pill">夏普比 {toNumber(metrics?.sharpe, 0).toFixed(2)}</div>
              <div className="pill">年化波动 {pct(metrics?.vol || 0, 2)}</div>
              <div className="pill">回撤修复期 {metrics?.recoveryDays ?? 0} 天</div>
              <div className="pill">期末资产 ¥{toNumber(series.meta?.endValue, 0).toFixed(2)}</div>
            </div>

            <div className="muted" style={{ fontSize: 12 }}>
              曲线展示：当前所选基金组合净值曲线 vs 基准指数。
            </div>
            {benchmarkError && (
              <div className="muted" style={{ fontSize: 12, color: '#b42318' }}>
                {benchmarkError}
              </div>
            )}
            <div className="chart-panel">
              <div className="chart-panel-top">
                <div>
                  <div className="chart-panel-title">组合表现</div>
                  <div className="chart-panel-subtitle">净值化对比，本组合 vs {activeBenchmark?.name || '业绩基准'}</div>
                </div>
                <div className={chartView?.portfolioReturn >= 0 ? 'trend-badge trend-up' : 'trend-badge trend-down'}>
                  {chartView?.portfolioReturn >= 0 ? '当前区间收益' : '当前区间回撤'} {pct(chartView?.portfolioReturn || 0, 2)}
                </div>
              </div>
              <div className="range-tabs" style={{ flexWrap: 'wrap' }}>
                {BENCHMARK_OPTIONS.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    className={activeBenchmark?.symbol === item.symbol ? 'range-chip range-chip-active' : 'range-chip'}
                    onClick={() => setActiveBenchmark(item)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <div className="range-tabs">
                <button
                  type="button"
                  className={chartRange === '1m' ? 'range-chip range-chip-active' : 'range-chip'}
                  onClick={() => setChartRange('1m')}
                >
                  近1月
                </button>
                <button
                  type="button"
                  className={chartRange === '3m' ? 'range-chip range-chip-active' : 'range-chip'}
                  onClick={() => setChartRange('3m')}
                >
                  近3月
                </button>
                <button
                  type="button"
                  className={chartRange === 'all' ? 'range-chip range-chip-active' : 'range-chip'}
                  onClick={() => setChartRange('all')}
                >
                  全部
                </button>
              </div>
              <div style={{ height: 248 }}>
                {chartData && <Line className="chart" data={chartData} options={chartOptions} />}
              </div>
            </div>
          </div>
        )}
      </div>

      {portfolioSnapshot && (
        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>组合诊断</div>
            <div className="pill">{portfolioSnapshot.lastDate}</div>
          </div>
          <div className="grid2">
            <div className="pill">资产分散：Top1 {pct(portfolioSnapshot.conc.top1, 1)}</div>
            <div className="pill">分散度指数 HHI {portfolioSnapshot.conc.hhi.toFixed(2)}</div>
            <div className="pill">行业相关性（简版）{portfolioSnapshot.avgIndustrySim.toFixed(2)}</div>
            <div className="pill">持仓基金数 {portfolioSnapshot.rows.length}</div>
          </div>
          <div className="xh-card" style={{ lineHeight: 1.7 }}>
            <div><strong>一、资产分散度评估：</strong>{portfolioSnapshot.diagnosis.part1}</div>
            <div style={{ marginTop: 10 }}><strong>二、行业相关性分析：</strong>{portfolioSnapshot.diagnosis.part2}</div>
            <div style={{ marginTop: 10 }}><strong>三、优化建议：</strong>{portfolioSnapshot.diagnosis.part3}</div>
          </div>
        </div>
      )}

      {activeModal && (
        <PurchaseModal
          type={activeModal}
          feeStats={feeStats}
          commonDates={commonDates}
          defaultStartDate={defaultStartDate}
          selectedFunds={selectedFunds}
          onClose={() => setActiveModal(null)}
          onConfirm={(p) => {
            const now = Date.now()
            setBuyHistory((prev) => [
              {
                id: uid('sim_buy'),
                createdAtMs: now,
                createdAt: new Date(now).toLocaleString(),
                ...p,
              },
              ...(prev || []),
            ])
            setActiveModal(null)
          }}
        />
      )}

      {watchlistModalOpen && (
        <WatchlistModal
          watchFunds={watchFunds}
          selectedIds={selectedIds}
          onDeleteFund={(fundId) => {
            setWatchlist((prev) => (prev || []).filter((id) => id !== fundId))
            setSelectedIds((prev) => (prev || []).filter((id) => id !== fundId))
            if (historyFundFilter === fundId) setHistoryFundFilter('all')
          }}
          onClose={() => setWatchlistModalOpen(false)}
          onConfirm={(ids) => {
            setSelectedIds(ids)
            setHistoryFundFilter('all')
            setWatchlistModalOpen(false)
          }}
        />
      )}

      {historyDetail && (
        <HistoryDetailModal
          detail={historyDetail}
          onClose={() => setHistoryDetailId(null)}
          onDelete={() => {
            removeHistory(historyDetail.id)
            setHistoryDetailId(null)
          }}
        />
      )}
    </div>
  )
}

const BANKS = [
  { id: 'bank_001', name: '招商银行储蓄卡（尾号 6688）' },
  { id: 'bank_002', name: '中国银行储蓄卡（尾号 1024）' },
  { id: 'bank_003', name: '建设银行储蓄卡（尾号 5200）' },
]

const PurchaseModal = ({
  type,
  feeStats,
  commonDates,
  defaultStartDate,
  selectedFunds,
  onClose,
  onConfirm,
}) => {
  const [amount, setAmount] = useState(type === 'sip' ? '1000' : '10000')
  const [bankId, setBankId] = useState(BANKS[0].id)
  const [interval, setInterval] = useState('monthly')
  const [startDate, setStartDate] = useState(defaultStartDate || '')
  const [fundId, setFundId] = useState(selectedFunds?.[0]?.id || '')
  const minPurchase = 100
  const amountN = Math.max(0, toNumber(amount, 0))

  const title = type === 'sip' ? '定投' : '购买'
  const canSubmit = type === 'sip' ? amountN >= minPurchase : amountN >= minPurchase

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 900 }}>{title}</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            关闭
          </button>
        </div>

        {type === 'sip' ? (
          <div className="stack">
            <select className="select" value={fundId} onChange={(e) => setFundId(e.target.value)}>
              <option value="">选择基金产品</option>
              {selectedFunds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}（{f.code}）
                </option>
              ))}
            </select>
            <select className="select" value={startDate} onChange={(e) => setStartDate(e.target.value)}>
              {(commonDates.length ? commonDates : ['']).map((d) => (
                <option key={d} value={d}>
                  起投日期：{d || '—'}
                </option>
              ))}
            </select>
            <input
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="定投金额（元）"
              inputMode="decimal"
            />
            <select className="select" value={bankId} onChange={(e) => setBankId(e.target.value)}>
              {BANKS.map((b) => (
                <option key={b.id} value={b.id}>
                  扣款银行卡：{b.name}
                </option>
              ))}
            </select>
            <select className="select" value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="weekly">定投间隔：每周</option>
              <option value="biweekly">定投间隔：每两周</option>
              <option value="monthly">定投间隔：每月</option>
            </select>
            <div className="pill" style={{ justifyContent: 'flex-start' }}>
              风险提示：基金净值会波动，定投不保证收益，可能亏损；请结合自身风险承受能力。
            </div>
          </div>
        ) : (
          <div className="stack">
            <select className="select" value={fundId} onChange={(e) => setFundId(e.target.value)}>
              <option value="">选择基金产品</option>
              {selectedFunds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}（{f.code}）
                </option>
              ))}
            </select>
            <select className="select" value={startDate} onChange={(e) => setStartDate(e.target.value)}>
              {(commonDates.length ? commonDates : ['']).map((d) => (
                <option key={d} value={d}>
                  起投日期：{d || '—'}
                </option>
              ))}
            </select>
            <input
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="购买金额（元）"
              inputMode="decimal"
            />
            <select className="select" value={bankId} onChange={(e) => setBankId(e.target.value)}>
              {BANKS.map((b) => (
                <option key={b.id} value={b.id}>
                  扣款银行卡：{b.name}
                </option>
              ))}
            </select>
            <div className="grid2">
              <div className="pill" style={{ justifyContent: 'center' }}>
                起购金额 ¥{minPurchase}
              </div>
              <div className="pill" style={{ justifyContent: 'center' }}>
                费率提醒：平均 {pct(feeStats.avg, 2)}
              </div>
            </div>
            <div className="pill" style={{ justifyContent: 'flex-start' }}>
              风险提示：基金净值会波动，历史表现不代表未来；请合理评估风险后再做决策。
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canSubmit || !startDate || !fundId}
            onClick={() =>
              onConfirm(
                type === 'sip'
                  ? { type: 'sip', fundId, startDate, amount: amountN, bankId, interval }
                  : { type: 'once', fundId, startDate, amount: amountN, bankId, minPurchase },
              )
            }
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}

const WatchlistModal = ({ watchFunds, selectedIds, onDeleteFund, onClose, onConfirm }) => {
  const [ids, setIds] = useState(() => selectedIds.slice())

  const toggle = (fundId) => {
    setIds((prev) => (prev.includes(fundId) ? prev.filter((x) => x !== fundId) : [...prev, fundId]))
  }

  const allSelected = watchFunds.length > 0 && watchFunds.every((fund) => ids.includes(fund.id))

  const toggleSelectAll = () => {
    setIds(allSelected ? [] : watchFunds.map((fund) => fund.id))
  }

  const handleBatchDelete = () => {
    if (!ids.length) return
    for (const id of ids) onDeleteFund?.(id)
    setIds([])
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 900 }}>自选库</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            关闭
          </button>
        </div>

        {watchFunds.length === 0 ? (
          <div className="muted">自选库为空。先到「智能选基」里加入自选。</div>
        ) : (
          <div className="stack">
            <div className="row">
              <div className="pill">已选 {ids.length} / {watchFunds.length}</div>
              <button type="button" className="btn btn-secondary btn-small" onClick={toggleSelectAll}>
                {allSelected ? '取消全选' : '一键全选'}
              </button>
            </div>
            {watchFunds.map((f) => {
              const checked = ids.includes(f.id)
              return (
                <div key={f.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(f.id)} />
                  <label style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggle(f.id)}>
                    <div style={{ fontWeight: 800 }}>
                      {f.name} <span className="muted">({f.code})</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {f.type} · R{f.riskLevel} · 费率 {pct(f.feeRate, 2)}
                    </div>
                  </label>
                </div>
              )
            })}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-danger" onClick={handleBatchDelete} disabled={!ids.length}>
            删除
          </button>
          <button type="button" className="btn" disabled={ids.length === 0} onClick={() => onConfirm(ids)}>
            加入模拟
          </button>
        </div>
      </div>
    </div>
  )
}

const HistoryDetailModal = ({ detail, onClose, onDelete }) => {
  const fund = detail.fund
  const title = fund?.name || detail.fundId
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 900 }}>买入详情</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="xh-card">
          <div className="xh-title">{title}</div>
          <div className="xh-sub">{fund?.code ? `代码：${fund.code}` : ''}</div>
          <div className="tags" style={{ marginTop: 10 }}>
            <span className="tag tag-warm">{detail.type === 'sip' ? '定投' : '购买'}</span>
            <span className="tag">起投日期：{detail.startDate}</span>
            <span className="tag">金额：¥{toNumber(detail.amount, 0).toFixed(2)}</span>
            {detail.type === 'sip' && <span className="tag">间隔：{detail.interval || 'monthly'}</span>}
            <span className="tag">扣款卡：{detail.bankLabel}</span>
            {detail.createdAt && <span className="tag">创建：{detail.createdAt}</span>}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            删除记录
          </button>
        </div>
      </div>
    </div>
  )
}
