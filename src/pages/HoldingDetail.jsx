import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { useFunds } from '../lib/fundsContext'
import { useLocalStorageState } from '../lib/useLocalStorageState'
import { LS_KEYS } from '../lib/keys'
import { MARKET_OPEN_LABEL, computeHoldings, enrichHoldings } from '../lib/holdingUtils'
import { getLatestDate } from '../lib/fundUtils'
import { pct, toNumber } from '../lib/finance'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

const formatAmount = (value) =>
  Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const RANGE_OPTIONS = [
  { value: '1m', label: '近1月', points: 22 },
  { value: '3m', label: '近3月', points: 66 },
  { value: '1y', label: '近1年', points: 252 },
  { value: 'all', label: '全部', points: null },
]

const BENCHMARK_OPTIONS = [
  { symbol: 'sh000300', name: '沪深300' },
  { symbol: 'sh000001', name: '上证指数' },
  { symbol: 'sh000016', name: '上证50' },
  { symbol: 'sh000905', name: '中证500' },
  { symbol: 'sz399001', name: '深证成指' },
  { symbol: 'cbond_mixed', name: '中债混合' },
]

const normalizeLine = (series, key = 'nav') => {
  if (!series?.length) return []
  const base = toNumber(series[0]?.[key], 0)
  if (base <= 0) return []
  return series.map((item) => ({
    date: item.date,
    value: Number((toNumber(item[key], base) / base).toFixed(4)),
  }))
}

const formatDate = (date) => {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

const getRangeStartDate = (range) => {
  if (range === 'all') return ''
  const date = new Date()
  if (range === '1m') date.setMonth(date.getMonth() - 1)
  if (range === '3m') date.setMonth(date.getMonth() - 3)
  if (range === '1y') date.setFullYear(date.getFullYear() - 1)
  return formatDate(date)
}

const filterSeriesByRange = (series, range) => {
  if (!series?.length) return []
  const startDate = getRangeStartDate(range)
  if (!startDate) return series
  const filtered = series.filter((item) => item.date >= startDate)
  return filtered.length ? filtered : series
}

export default function HoldingDetail() {
  const { fundId } = useParams()
  const nav = useNavigate()
  const [txs] = useLocalStorageState(LS_KEYS.holdingsTx, [])
  const { ensureFundDetails, getFundById, loadIndexSeries } = useFunds()
  const [chartRange, setChartRange] = useState('3m')
  const [benchmarkSeries, setBenchmarkSeries] = useState([])
  const [activeBenchmark, setActiveBenchmark] = useState(BENCHMARK_OPTIONS[0])

  const holdings = useMemo(() => computeHoldings(txs), [txs])

  useEffect(() => {
    if (fundId) ensureFundDetails([fundId]).catch(() => {})
  }, [ensureFundDetails, fundId])

  const holding = useMemo(() => {
    const rows = enrichHoldings(holdings, getFundById)
    return rows.find((item) => item.fundId === fundId) || null
  }, [fundId, getFundById, holdings])

  useEffect(() => {
    if (!holding?.fund) return
    const matched =
      BENCHMARK_OPTIONS.find((item) => item.symbol === holding.fund.benchmarkCode || item.name === holding.fund.benchmarkName) ||
      (holding.fund.type === '债券基金' ? BENCHMARK_OPTIONS.find((item) => item.symbol === 'cbond_mixed') : BENCHMARK_OPTIONS[0])
    if (matched) setActiveBenchmark(matched)
  }, [holding?.fund])

  useEffect(() => {
    let cancelled = false
    if (!activeBenchmark?.symbol || !holding?.fund?.navSeries?.length) {
      setBenchmarkSeries([])
      return () => {
        cancelled = true
      }
    }
    loadIndexSeries(
      activeBenchmark.symbol,
      getRangeStartDate(chartRange),
      holding.fund.navSeries[holding.fund.navSeries.length - 1]?.date,
    )
      .then((series) => {
        if (!cancelled) setBenchmarkSeries(series || [])
      })
      .catch(() => {
        if (!cancelled) setBenchmarkSeries([])
      })
    return () => {
      cancelled = true
    }
  }, [activeBenchmark?.symbol, chartRange, holding?.fund?.navSeries, loadIndexSeries])

  const filteredFundSeries = useMemo(() => {
    if (!holding?.fund?.navSeries?.length) return []
    return filterSeriesByRange(holding.fund.navSeries || [], chartRange)
  }, [chartRange, holding])

  const filteredBenchmarkSeries = useMemo(() => {
    if (!filteredFundSeries.length || !benchmarkSeries.length) return []
    const endDates = new Set(filteredFundSeries.map((item) => item.date))
    let lastValue = null
    const byDate = new Map(benchmarkSeries.map((item) => [item.date, item.value]))
    return filteredFundSeries
      .map((item) => {
        const nextValue = byDate.get(item.date) ?? lastValue
        if (nextValue == null) return null
        lastValue = nextValue
        return { date: item.date, value: nextValue }
      })
      .filter((item) => item && endDates.has(item.date))
  }, [benchmarkSeries, filteredFundSeries])

  const chartData = useMemo(() => {
    const fundSourceSeries = filteredFundSeries.length ? filteredFundSeries : holding?.fund?.navSeries || []
    if (!fundSourceSeries.length) return null
    const fundLine = normalizeLine(fundSourceSeries)
    if (!fundLine.length) return null
    const benchmarkLine = normalizeLine(filteredBenchmarkSeries, 'value')
    return {
      labels: fundLine.map((item) => item.date),
      datasets: [
        {
          label: '本基金',
          data: fundLine.map((item) => Number(((item.value - 1) * 100).toFixed(2))),
          borderColor: '#ea6e59',
          backgroundColor: 'rgba(234, 110, 89, 0.12)',
          pointRadius: 0,
          borderWidth: 2.4,
          tension: 0.3,
        },
        ...(benchmarkLine.length
          ? [
              {
                label: activeBenchmark?.name || '业绩比较基准',
                data: benchmarkLine.map((item) => Number(((item.value - 1) * 100).toFixed(2))),
                borderColor: '#8fa6dd',
                backgroundColor: 'rgba(143, 166, 221, 0.08)',
                pointRadius: 0,
                borderWidth: 2,
                tension: 0.28,
              },
            ]
          : []),
      ],
    }
  }, [activeBenchmark?.name, filteredBenchmarkSeries, filteredFundSeries, holding?.fund?.navSeries])

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { usePointStyle: true, boxWidth: 8, font: { size: 11, weight: '700' } },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 5 } },
        y: {
          ticks: {
            maxTicksLimit: 5,
            callback: (value) => `${value}%`,
          },
        },
      },
    }),
    [],
  )

  if (!holding) {
    return (
      <div className="stack">
        <div className="card stack">
          <button type="button" className="detail-back" onClick={() => nav('/me')}>
            返回我的
          </button>
          <div className="muted">暂未找到该基金持仓记录。</div>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="profile-hero card stack">
        <button type="button" className="detail-back" onClick={() => nav('/me')}>
          返回我的
        </button>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="detail-title">{holding.fund.name}</div>
            <div className="detail-subtitle">
              {holding.fund.code} · {holding.fund.type} · 最新净值日期 {getLatestDate(holding.fund) || '--'}
            </div>
          </div>
          <Link to={`/funds/${holding.fund.id}`} className="btn btn-secondary btn-small" style={{ textDecoration: 'none' }}>
            查看基金详情
          </Link>
        </div>

        <div className="profile-total-card">
          <div className="profile-total-label">持仓金额（元）</div>
          <div className="profile-total-value">¥{formatAmount(holding.value)}</div>
          <div className="profile-total-grid">
            <div>
              <div className={holding.yesterdayIncome >= 0 ? 'detail-positive' : 'detail-negative'}>¥{formatAmount(holding.yesterdayIncome)}</div>
              <div className="profile-total-note">昨日收益</div>
            </div>
            <div>
              <div className={holding.holdingIncome >= 0 ? 'detail-positive' : 'detail-negative'}>¥{formatAmount(holding.holdingIncome)}</div>
              <div className="profile-total-note">持仓收益</div>
            </div>
            <div>
              <div className={holding.holdingYield >= 0 ? 'detail-positive' : 'detail-negative'}>{pct(holding.holdingYield, 2)}</div>
              <div className="profile-total-note">持仓收益率</div>
            </div>
          </div>
        </div>

        <div className="detail-metrics">
          <div className="detail-metric-card">
            <div className="detail-metric-label">持有份额</div>
            <div className="detail-metric-value">{holding.shares.toFixed(2)}</div>
            <div className="detail-metric-note">累计买入 {holding.buyCount} 次</div>
          </div>
          <div className="detail-metric-card">
            <div className="detail-metric-label">平均持仓成本</div>
            <div className="detail-metric-value">{(holding.cost / holding.shares).toFixed(4)}</div>
            <div className="detail-metric-note">最新净值 {holding.latestNav.toFixed(4)}</div>
          </div>
          <div className="detail-metric-card">
            <div className="detail-metric-label">开放时间</div>
            <div className="detail-metric-value profile-open-time">{MARKET_OPEN_LABEL}</div>
            <div className="detail-metric-note">实际以基金公司公告为准</div>
          </div>
        </div>
      </div>

      <div className="chart-panel">
        <div className="chart-panel-top">
          <div>
            <div className="chart-panel-title">业绩走势</div>
            <div className="chart-panel-subtitle">本基金 vs {activeBenchmark?.name || '业绩比较基准'}</div>
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
          {RANGE_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={chartRange === item.value ? 'range-chip range-chip-active' : 'range-chip'}
              onClick={() => setChartRange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ height: 260 }}>
          {chartData ? <Line data={chartData} options={chartOptions} /> : <div className="muted">暂无持仓走势数据，请稍后重试。</div>}
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>交易记录</div>
          <div className="pill">最近 {holding.transactions.length} 条</div>
        </div>
        <div className="stack">
          {holding.transactions.map((tx) => (
            <div key={tx.id} className="profile-transaction-row">
              <div>
                <div style={{ fontWeight: 800 }}>{tx.action === 'buy' ? '买入' : '卖出'}</div>
                <div className="muted">{tx.date || '--'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800 }}>¥{formatAmount(tx.amount)}</div>
                <div className="muted">份额 {toNumber(tx.shares, 0).toFixed(4)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
