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
import { getLatestDate, getLatestNav } from '../lib/fundUtils'
import { maxDrawdown, pct, toNumber } from '../lib/finance'
import { useLocalStorageState } from '../lib/useLocalStorageState'
import { LS_KEYS } from '../lib/keys'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

const RANGE_OPTIONS = [
  { value: '1m', label: '近1月', points: 22 },
  { value: '3m', label: '近3月', points: 66 },
  { value: '1y', label: '近1年', points: 252 },
  { value: 'all', label: '成立来', points: null },
]

const PERIOD_OPTIONS = [
  { key: 'week', label: '近1周', points: 5 },
  { key: 'month', label: '近1月', points: 22 },
  { key: 'quarter', label: '近3月', points: 66 },
  { key: 'halfYear', label: '近6月', points: 126 },
  { key: 'year', label: '近1年', points: 252 },
  { key: 'all', label: '成立来', points: null },
]

const formatDateLabel = (value) => {
  if (!value) return '--'
  return value.slice(2).replace(/-/g, '.')
}

const sliceSeriesByRange = (series, range) => {
  if (!series?.length) return []
  const matched = RANGE_OPTIONS.find((item) => item.value === range)
  if (!matched?.points) return series
  return series.slice(Math.max(0, series.length - matched.points))
}

const normalizeSeries = (series, valueKey = 'nav') => {
  if (!series?.length) return []
  const base = toNumber(series[0]?.[valueKey], 0)
  if (base <= 0) return series.map((item) => ({ date: item.date, value: 1 }))
  return series.map((item) => ({
    date: item.date,
    value: Number((toNumber(item?.[valueKey], base) / base).toFixed(4)),
  }))
}

const calcReturn = (series, valueKey = 'nav') => {
  if (!series?.length) return null
  const first = toNumber(series[0]?.[valueKey], 0)
  const last = toNumber(series[series.length - 1]?.[valueKey], 0)
  if (first <= 0 || last <= 0) return null
  return last / first - 1
}

const alignBenchmarkSeries = (fundSeries, benchmarkSeries) => {
  if (!fundSeries?.length || !benchmarkSeries?.length) return []
  const aligned = []
  let benchmarkIndex = 0
  let latestValue = null
  for (const point of fundSeries) {
    while (benchmarkIndex < benchmarkSeries.length && benchmarkSeries[benchmarkIndex].date <= point.date) {
      latestValue = toNumber(benchmarkSeries[benchmarkIndex].value, latestValue || 0)
      benchmarkIndex += 1
    }
    if (latestValue != null) aligned.push({ date: point.date, value: latestValue })
  }
  return aligned
}

const computeDayReturn = (fund) => {
  const direct = fund?.performance?.day
  if (typeof direct === 'number') return direct
  const series = fund?.navSeries || []
  if (series.length < 2) return 0
  const prev = toNumber(series[series.length - 2]?.nav, 0)
  const latest = toNumber(series[series.length - 1]?.nav, 0)
  if (prev <= 0 || latest <= 0) return 0
  return latest / prev - 1
}

const computeHoldingMix = (fund) => {
  const rawType = `${fund?.rawType || ''}`.toLowerCase()
  if (fund?.type === '货币基金') {
    return [
      { label: '现金', value: 0.94 },
      { label: '债券', value: 0.04 },
      { label: '其他', value: 0.02 },
    ]
  }
  if (fund?.type === '债券基金') {
    if (rawType.includes('可转债')) {
      return [
        { label: '债券', value: 0.68 },
        { label: '股票', value: 0.2 },
        { label: '现金', value: 0.08 },
        { label: '其他', value: 0.04 },
      ]
    }
    return [
      { label: '债券', value: 0.84 },
      { label: '现金', value: 0.1 },
      { label: '其他', value: 0.06 },
    ]
  }
  if (rawType.includes('偏债')) {
    return [
      { label: '股票', value: 0.3 },
      { label: '债券', value: 0.52 },
      { label: '现金', value: 0.1 },
      { label: '其他', value: 0.08 },
    ]
  }
  if (fund?.type === '指数基金') {
    return [
      { label: '股票', value: 0.93 },
      { label: '现金', value: 0.04 },
      { label: '其他', value: 0.03 },
    ]
  }
  if (rawType.includes('灵活')) {
    return [
      { label: '股票', value: 0.76 },
      { label: '债券', value: 0.12 },
      { label: '现金', value: 0.08 },
      { label: '其他', value: 0.04 },
    ]
  }
  return [
    { label: '股票', value: 0.82 },
    { label: '债券', value: 0.08 },
    { label: '现金', value: 0.06 },
    { label: '其他', value: 0.04 },
  ]
}

const topEntries = (obj, limit = 6) =>
  Object.entries(obj || {})
    .map(([label, value]) => ({ label, value: toNumber(value, 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)

export default function FundDetail() {
  const { fundId } = useParams()
  const nav = useNavigate()
  const { ensureFundDetails, getFundById, loadIndexSeries } = useFunds()
  const [watchlist, setWatchlist] = useLocalStorageState(LS_KEYS.watchlist, [])
  const [chartRange, setChartRange] = useState('1y')
  const [benchmarkSeries, setBenchmarkSeries] = useState([])
  const [benchmarkError, setBenchmarkError] = useState('')

  const fund = getFundById(fundId)
  const inWatchlist = watchlist.includes(fundId)

  useEffect(() => {
    if (!fundId) return
    ensureFundDetails([fundId]).catch(() => {})
  }, [ensureFundDetails, fundId])

  useEffect(() => {
    let cancelled = false
    if (!fund?.benchmarkCode || !fund?.navSeries?.length) {
      setBenchmarkSeries([])
      setBenchmarkError('')
      return () => {
        cancelled = true
      }
    }

    loadIndexSeries(fund.benchmarkCode, fund.navSeries[0]?.date, fund.navSeries[fund.navSeries.length - 1]?.date)
      .then((series) => {
        if (cancelled) return
        setBenchmarkSeries(series || [])
        setBenchmarkError('')
      })
      .catch(() => {
        if (cancelled) return
        setBenchmarkSeries([])
        setBenchmarkError('暂未获取到业绩比较基准走势')
      })

    return () => {
      cancelled = true
    }
  }, [fund?.benchmarkCode, fund?.id, fund?.navSeries, loadIndexSeries])

  const latestNav = useMemo(() => getLatestNav(fund), [fund])
  const latestDate = useMemo(() => getLatestDate(fund), [fund])
  const dayReturn = useMemo(() => computeDayReturn(fund), [fund])
  const currentDrawdown = useMemo(() => {
    if (fund?.maxDrawdownHint != null) return fund.maxDrawdownHint
    const navValues = (fund?.navSeries || []).map((item) => item.nav)
    if (!navValues.length) return 0
    return Math.abs(maxDrawdown(navValues))
  }, [fund])

  const filteredFundSeries = useMemo(() => sliceSeriesByRange(fund?.navSeries || [], chartRange), [chartRange, fund?.navSeries])
  const normalizedFundSeries = useMemo(() => normalizeSeries(filteredFundSeries), [filteredFundSeries])
  const normalizedBenchmarkSeries = useMemo(() => {
    const aligned = alignBenchmarkSeries(filteredFundSeries, benchmarkSeries)
    return normalizeSeries(aligned, 'value')
  }, [benchmarkSeries, filteredFundSeries])

  const chartData = useMemo(() => {
    if (!normalizedFundSeries.length) return null
    const labels = normalizedFundSeries.map((item) => formatDateLabel(item.date))
    const datasets = [
      {
        label: fund?.name || '本基金',
        data: normalizedFundSeries.map((item) => Number(((item.value - 1) * 100).toFixed(2))),
        borderColor: '#e56b52',
        backgroundColor: 'rgba(229, 107, 82, 0.14)',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.28,
      },
    ]
    if (normalizedBenchmarkSeries.length) {
      datasets.push({
        label: fund?.benchmarkName || '业绩比较基准',
        data: normalizedBenchmarkSeries.map((item) => Number(((item.value - 1) * 100).toFixed(2))),
        borderColor: '#8ea8de',
        backgroundColor: 'rgba(142, 168, 222, 0.12)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.24,
      })
    }
    return { labels, datasets }
  }, [fund?.benchmarkName, fund?.name, normalizedBenchmarkSeries, normalizedFundSeries])

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            color: 'rgba(17, 24, 39, 0.72)',
            font: { size: 11, weight: '700' },
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label} ${context.parsed.y >= 0 ? '+' : ''}${context.parsed.y.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 5, color: 'rgba(0, 0, 0, 0.45)' },
        },
        y: {
          ticks: {
            color: 'rgba(0, 0, 0, 0.45)',
            callback: (value) => `${value}%`,
            maxTicksLimit: 5,
          },
          grid: { color: 'rgba(0, 0, 0, 0.06)' },
        },
      },
    }),
    [],
  )

  const performanceRows = useMemo(() => {
    const benchmarkByDate = alignBenchmarkSeries(fund?.navSeries || [], benchmarkSeries)
    return PERIOD_OPTIONS.map((item) => {
      const fundReturn =
        item.key === 'all'
          ? calcReturn(fund?.navSeries || [])
          : typeof fund?.performance?.[item.key] === 'number'
            ? fund.performance[item.key]
            : calcReturn((fund?.navSeries || []).slice(Math.max(0, (fund?.navSeries || []).length - item.points)))
      const benchmarkReturn =
        item.key === 'all'
          ? calcReturn(benchmarkByDate, 'value')
          : calcReturn(benchmarkByDate.slice(Math.max(0, benchmarkByDate.length - item.points)), 'value')
      return {
        label: item.label,
        fundReturn,
        benchmarkReturn,
      }
    })
  }, [benchmarkSeries, fund?.navSeries, fund?.performance])

  const holdingMix = useMemo(() => computeHoldingMix(fund), [fund])
  const industryExposure = useMemo(() => topEntries(fund?.exposures?.industry, 6), [fund?.exposures?.industry])
  const styleExposure = useMemo(() => topEntries(fund?.exposures?.style, 4), [fund?.exposures?.style])

  if (!fund) {
    return (
      <div className="stack">
        <div className="card stack">
          <button type="button" className="detail-back" onClick={() => nav('/pick')}>
            返回智能选基
          </button>
          <div className="muted">基金详情加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="detail-hero card stack">
        <button
          type="button"
          className="detail-back"
          onClick={() => {
            if (window.history.length > 1) nav(-1)
            else nav('/pick')
          }}
        >
          返回
        </button>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="detail-title">{fund.name}</div>
            <div className="detail-subtitle">
              {fund.code} · {fund.type} · {fund.theme}
            </div>
          </div>
          <div className={dayReturn >= 0 ? 'trend-badge trend-up' : 'trend-badge trend-down'}>
            {dayReturn >= 0 ? '+' : ''}
            {pct(dayReturn, 2)}
          </div>
        </div>

        <div className="detail-metrics">
          <div className="detail-metric-card">
            <div className="detail-metric-label">最新净值</div>
            <div className="detail-metric-value">{latestNav.toFixed(4)}</div>
            <div className="detail-metric-note">更新至 {latestDate || '--'}</div>
          </div>
          <div className="detail-metric-card">
            <div className="detail-metric-label">风险等级</div>
            <div className="detail-metric-value">R{fund.riskLevel}</div>
            <div className="detail-metric-note">{fund.rawType || fund.type}</div>
          </div>
          <div className="detail-metric-card">
            <div className="detail-metric-label">历史最大回撤</div>
            <div className="detail-metric-value">{pct(currentDrawdown, 2)}</div>
            <div className="detail-metric-note">近一年/历史净值测算</div>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={inWatchlist ? 'btn btn-secondary btn-small' : 'btn btn-small'}
            onClick={() =>
              setWatchlist((prev) => (prev.includes(fund.id) ? prev.filter((item) => item !== fund.id) : [...prev, fund.id]))
            }
          >
            {inWatchlist ? '已加入自选' : '加入自选'}
          </button>
          <Link to="/pick" className="btn btn-secondary btn-small" style={{ textDecoration: 'none' }}>
            返回选基购买
          </Link>
        </div>
      </div>

      <div className="chart-panel">
        <div className="chart-panel-top">
          <div>
            <div className="chart-panel-title">业绩走势</div>
            <div className="chart-panel-subtitle">
              本基金 vs {fund.benchmarkName || '业绩比较基准'}
            </div>
          </div>
          <div className="pill">单位：相对区间涨跌幅</div>
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
          {chartData ? <Line data={chartData} options={chartOptions} /> : <div className="muted">暂无净值走势数据</div>}
        </div>
        {benchmarkError && <div className="muted" style={{ fontSize: 12 }}>{benchmarkError}</div>}
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>历史业绩</div>
          <div className="pill">最新净值日期 {latestDate || '--'}</div>
        </div>
        <div className="detail-table">
          <div className="detail-table-head">
            <span>时间区间</span>
            <span>本基金</span>
            <span>{fund.benchmarkName || '比较基准'}</span>
          </div>
          {performanceRows.map((row) => (
            <div key={row.label} className="detail-table-row">
              <span>{row.label}</span>
              <span className={toNumber(row.fundReturn, 0) >= 0 ? 'detail-positive' : 'detail-negative'}>
                {row.fundReturn == null ? '--' : pct(row.fundReturn, 2)}
              </span>
              <span className={toNumber(row.benchmarkReturn, 0) >= 0 ? 'detail-positive' : 'detail-negative'}>
                {row.benchmarkReturn == null ? '--' : pct(row.benchmarkReturn, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid2">
        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>持仓分布</div>
            <div className="pill">估算结构</div>
          </div>
          <div className="stack">
            {holdingMix.map((item) => (
              <div key={item.label} className="detail-progress-row">
                <div className="row">
                  <span>{item.label}</span>
                  <span>{pct(item.value, 2)}</span>
                </div>
                <div className="detail-progress-track">
                  <div className="detail-progress-fill" style={{ width: `${Math.max(4, item.value * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          {!!styleExposure.length && (
            <div className="tags">
              {styleExposure.map((item) => (
                <span key={item.label} className="tag">
                  {item.label} {pct(item.value, 1)}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>行业分布</div>
            <div className="pill">最近披露口径</div>
          </div>
          {industryExposure.length ? (
            <div className="stack">
              {industryExposure.map((item) => (
                <div key={item.label} className="detail-progress-row">
                  <div className="row">
                    <span>{item.label}</span>
                    <span>{pct(item.value, 2)}</span>
                  </div>
                  <div className="detail-progress-track detail-progress-track-cool">
                    <div className="detail-progress-fill detail-progress-fill-cool" style={{ width: `${Math.max(4, item.value * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">暂未获取到该基金的行业配置披露。</div>
          )}
        </div>
      </div>
    </div>
  )
}
