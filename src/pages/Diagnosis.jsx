import { useEffect, useMemo, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js'
import { Doughnut, Line } from 'react-chartjs-2'
import { useLocalStorageState } from '../lib/useLocalStorageState'
import { LS_KEYS } from '../lib/keys'
import {
  annualizedVol,
  maxDrawdown,
  mergeExposure,
  pct,
  recoveryDays,
  seriesToReturns,
  sharpe,
  topConcentration,
  toNumber,
} from '../lib/finance'
import { useFunds } from '../lib/fundsContext'
import { getCommonDateRange, getLatestNav, getNavOnDate } from '../lib/fundUtils'
import { computeHoldings } from '../lib/holdingUtils'
import { chatAssistant } from '../lib/fundApi'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend)

export default function Diagnosis() {
  const [txs] = useLocalStorageState(LS_KEYS.holdingsTx, [])
  const { ensureFundDetails, getFundById } = useFunds()
  const [aiAttributionText, setAiAttributionText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const holdings = useMemo(() => computeHoldings(txs), [txs])

  useEffect(() => {
    ensureFundDetails(holdings.map((item) => item.fundId)).catch(() => {})
  }, [ensureFundDetails, holdings])

  const enriched = useMemo(() => {
    const rows = holdings
      .map((h) => {
        const fund = getFundById(h.fundId)
        if (!fund) return null
        const nav = getLatestNav(fund)
        const value = nav * h.shares
        const cost = h.cost
        const ret = cost > 0 ? value / cost - 1 : 0
        return {
          ...h,
          fund,
          nav,
          value,
          ret,
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value)

    const totalValue = rows.reduce((acc, r) => acc + r.value, 0)
    return rows.map((r) => ({ ...r, weight: totalValue > 0 ? r.value / totalValue : 0, totalValue }))
  }, [getFundById, holdings])

  const portfolioSeries = useMemo(() => {
    if (!enriched.length) return null
    const funds = enriched.map((r) => r.fund)
    const dates = getCommonDateRange(funds)
    const last120 = dates.slice(Math.max(0, dates.length - 120))
    if (!last120.length) return null
    const startDate = last120[0]
    const base = Object.fromEntries(
      funds.map((f) => {
        const nav = getNavOnDate(f, startDate)
        return [f.id, nav && nav > 0 ? nav : 1]
      }),
    )
    const initialValue = enriched.reduce((acc, r) => acc + r.cost, 0)

    const values = last120.map((d) => {
      const idx = enriched.reduce((acc, r) => {
        const nav = getNavOnDate(r.fund, d) || base[r.fund.id]
        return acc + r.weight * (nav / base[r.fund.id])
      }, 0)
      return initialValue * idx
    })
    return { dates: last120, values }
  }, [enriched])

  const portfolioMetrics = useMemo(() => {
    if (!portfolioSeries?.values?.length) return null
    const values = portfolioSeries.values
    const rets = seriesToReturns(values)
    const totalReturn = values[0] > 0 ? values[values.length - 1] / values[0] - 1 : 0
    return {
      totalReturn,
      maxDrawdown: maxDrawdown(values),
      sharpe: sharpe(rets, 0),
      vol: annualizedVol(rets),
      recoveryDays: recoveryDays(values),
    }
  }, [portfolioSeries])

  const exposures = useMemo(() => {
    if (!enriched.length) return null
    const industry = mergeExposure(enriched, 'weight', (r) => r.fund.exposures?.industry)
    const style = mergeExposure(enriched, 'weight', (r) => r.fund.exposures?.style)
    return { industry, style }
  }, [enriched])

  const attribution = useMemo(() => {
    if (!enriched.length) return []
    const totalCost = enriched.reduce((acc, r) => acc + r.cost, 0)
    const totalValue = enriched.reduce((acc, r) => acc + r.value, 0)
    const totalPnl = totalValue - totalCost
    const totalAbsPnl = enriched.reduce((acc, r) => acc + Math.abs(r.value - r.cost), 0)
    return enriched.map((r) => {
      const pnl = r.value - r.cost
      const contrib = totalPnl === 0 ? 0 : pnl / totalPnl
      const impactRatio = totalAbsPnl === 0 ? 0 : Math.abs(pnl) / totalAbsPnl
      return { fundId: r.fundId, name: r.fund.name, pnl, contrib, impactRatio }
    })
  }, [enriched])

  const concentration = useMemo(() => {
    const ws = enriched.map((r) => r.weight)
    return topConcentration(ws)
  }, [enriched])

  const pieData = useMemo(() => {
    if (!enriched.length) return null
    return {
      labels: enriched.map((r) => r.fund.name),
      datasets: [
        {
          data: enriched.map((r) => Number((r.weight * 100).toFixed(2))),
          backgroundColor: ['#ffd8c2', '#cfe1ff', '#d9fbe7', '#f1d6ff', '#fff1b8', '#d6f0ff'],
          borderWidth: 1,
        },
      ],
    }
  }, [enriched])

  const attributionPieData = useMemo(() => {
    if (!attribution.length) return null
    return {
      labels: attribution.map((item) => item.name),
      datasets: [
        {
          data: attribution.map((item) => Number((item.impactRatio * 100).toFixed(2))),
          backgroundColor: ['#ffcab7', '#cfe1ff', '#d6f5df', '#f0dbff', '#ffe8a3', '#d6f0ff'],
          borderWidth: 1,
        },
      ],
    }
  }, [attribution])

  const lineData = useMemo(() => {
    if (!portfolioSeries?.dates?.length) return null
    return {
      labels: portfolioSeries.dates,
      datasets: [
        {
          label: '组合净值（指数化）',
          data: portfolioSeries.values.map((v) => Number(v.toFixed(2))),
          borderColor: '#1c1c1c',
          backgroundColor: 'rgba(0,0,0,0.08)',
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.2,
        },
      ],
    }
  }, [portfolioSeries])

  const lineOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { ticks: { maxTicksLimit: 6 } },
      },
    }),
    [],
  )

  useEffect(() => {
    setAiAttributionText('')
    setAiError('')
  }, [attribution, enriched])

  const generateAiAttribution = async () => {
    if (!enriched.length || !portfolioMetrics) return
    setAiLoading(true)
    setAiError('')
    try {
      const data = await chatAssistant({
        question:
          '请基于当前持仓的收益归因、组合收益、回撤和集中度，输出一段结构化中文分析。请重点说明哪几只基金在拖累或贡献收益、当前持仓可能存在的风险点，以及后续应该关注的调整方向。不要推荐具体产品。',
        context: {
          user: { username: '持有诊断用户' },
          overview: {
            purchasedCount: enriched.length,
            holdingAmount: enriched.reduce((sum, item) => sum + item.value, 0),
            holdingIncome: enriched.reduce((sum, item) => sum + (item.value - item.cost), 0),
            yesterdayIncome: enriched.reduce((sum, item) => sum + (item.shares * (item.nav - (item.fund?.navSeries?.[item.fund.navSeries.length - 2]?.nav || item.nav))), 0),
          },
          holdings: enriched.map((item) => ({
            fundId: item.fundId,
            code: item.fund.code,
            name: item.fund.name,
            type: item.fund.type,
            riskLevel: item.fund.riskLevel,
            value: Number(item.value.toFixed(2)),
            holdingIncome: Number((item.value - item.cost).toFixed(2)),
            holdingYield: Number(item.ret.toFixed(4)),
            yesterdayIncome: Number((item.shares * (item.nav - (item.fund?.navSeries?.[item.fund.navSeries.length - 2]?.nav || item.nav))).toFixed(2)),
          })),
          attribution: attribution.map((item) => ({
            name: item.name,
            pnl: Number(item.pnl.toFixed(2)),
            contrib: Number(item.contrib.toFixed(4)),
          })),
          portfolioMetrics: {
            totalReturn: Number((portfolioMetrics.totalReturn || 0).toFixed(4)),
            maxDrawdown: Number((portfolioMetrics.maxDrawdown || 0).toFixed(4)),
            sharpe: Number((portfolioMetrics.sharpe || 0).toFixed(4)),
            vol: Number((portfolioMetrics.vol || 0).toFixed(4)),
          },
        },
      })
      setAiAttributionText(data.reply || '')
    } catch (err) {
      setAiError(err.message || 'AI 分析暂时不可用，请稍后再试。')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>持有诊断（基于模拟购买数据）</div>
          <div className="pill">持仓 {enriched.length}</div>
        </div>

        {enriched.length === 0 ? (
          <div className="muted">还没有购买记录。先到「智能选基」里点击“购买”。</div>
        ) : (
          <div className="grid2">
            <div className="pill">组合累计收益 {pct(portfolioMetrics?.totalReturn || 0, 2)}</div>
            <div className="pill">最大回撤 {pct(portfolioMetrics?.maxDrawdown || 0, 2)}</div>
            <div className="pill">夏普比 {toNumber(portfolioMetrics?.sharpe, 0).toFixed(2)}</div>
            <div className="pill">年化波动 {pct(portfolioMetrics?.vol || 0, 2)}</div>
            <div className="pill">回撤修复期 {portfolioMetrics?.recoveryDays ?? 0} 天</div>
            <div className="pill">集中度 Top1 {pct(concentration.top1 || 0, 1)}</div>
          </div>
        )}
      </div>

      {enriched.length > 0 && (
        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>组合走势（近 120 个交易日）</div>
            <div className="pill">指数化</div>
          </div>
          <div style={{ height: 240 }}>{lineData && <Line className="chart" data={lineData} options={lineOptions} />}</div>
        </div>
      )}

      {enriched.length > 0 && (
        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>持仓结构</div>
            <div className="pill">按当前市值权重</div>
          </div>
          <div className="grid2">
            <div style={{ height: 220 }}>{pieData && <Doughnut className="chart" data={pieData} options={{ plugins: { legend: { display: false } } }} />}</div>
            <div className="stack">
              {enriched.slice(0, 6).map((r) => {
                return (
                  <div key={r.fundId} className="row" style={{ fontSize: 13 }}>
                    <div style={{ maxWidth: 220 }}>
                      <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.fund.name}
                      </div>
                      <div className="muted">
                        权重 {pct(r.weight, 1)} · 近3月 {pct(r.fund.performance?.quarter || 0, 2)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800 }}>{pct(r.ret, 2)}</div>
                      <div className="muted">¥{r.value.toFixed(0)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {enriched.length > 0 && (
        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>收益归因</div>
            <div className="pill">按贡献比例展示</div>
          </div>
          <div className="grid2">
            <div style={{ height: 240 }}>
              {attributionPieData && (
                <Doughnut
                  className="chart"
                  data={attributionPieData}
                  options={{
                    plugins: {
                      legend: { display: false },
                    },
                  }}
                />
              )}
            </div>
            <div className="stack">
              {attribution.map((a) => (
                <div key={a.fundId} className="row" style={{ fontSize: 13 }}>
                  <div style={{ maxWidth: 220 }}>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                    <div className="muted">扇形占比 {pct(a.impactRatio, 1)}</div>
                  </div>
                  <div className="muted" style={{ textAlign: 'right' }}>
                    贡献 {pct(a.contrib, 1)} · 盈亏 ¥{toNumber(a.pnl, 0).toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {enriched.length > 0 && (
        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>风险暴露</div>
            <div className="pill">行业/风格</div>
          </div>
          <div className="grid2">
            <ExposureList title="行业暴露" exposure={exposures?.industry || {}} />
            <ExposureList title="风格暴露" exposure={exposures?.style || {}} />
          </div>
        </div>
      )}

      {enriched.length > 0 && (
        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>AI 收益归因分析</div>
            <button type="button" className="btn btn-secondary btn-small" onClick={generateAiAttribution} disabled={aiLoading}>
              {aiLoading ? '分析中...' : aiAttributionText ? '重新分析' : '生成分析'}
            </button>
          </div>
          <div className="xh-card" style={{ lineHeight: 1.8 }}>
            {aiAttributionText ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{aiAttributionText}</div>
            ) : (
              <div className="muted">点击右上角按钮后，AI 会结合当前持仓收益归因、回撤和集中度生成分析反馈。</div>
            )}
          </div>
          {aiError && (
            <div className="muted" style={{ color: '#b42318', fontSize: 12 }}>
              {aiError}
            </div>
          )}
        </div>
      )}

    </div>
  )
}

const ExposureList = ({ title, exposure }) => {
  const entries = Object.entries(exposure)
    .map(([k, v]) => [k, v])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  return (
    <div className="card stack" style={{ padding: 12 }}>
      <div className="row">
        <div style={{ fontWeight: 800 }}>{title}</div>
        <div className="pill">Top {entries.length}</div>
      </div>
      {entries.length === 0 ? (
        <div className="muted">暂无</div>
      ) : (
        <div className="stack">
          {entries.map(([k, v]) => (
            <div key={k} className="row" style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 700 }}>{k}</div>
              <div className="muted">{pct(v, 1)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
