import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFunds } from '../lib/fundsContext'
import { getLatestDate, getLatestNav } from '../lib/fundUtils'
import { useLocalStorageState } from '../lib/useLocalStorageState'
import { LS_KEYS } from '../lib/keys'
import { pct, toNumber } from '../lib/finance'
import { uid } from '../lib/storage'

const DRAWDOWN_OPTIONS = [
  { value: '0-0.05', label: '5%以内', min: 0, max: 0.05 },
  { value: '0.05-0.10', label: '5%-10%', min: 0.05, max: 0.1 },
  { value: '0.10-0.15', label: '10%-15%', min: 0.1, max: 0.15 },
  { value: '0.15-0.20', label: '15%-20%', min: 0.15, max: 0.2 },
  { value: '0.20-0.30', label: '20%-30%', min: 0.2, max: 0.3 },
  { value: '0.30-0.50', label: '30%-50%', min: 0.3, max: 0.5 },
  { value: '0.50+', label: '50%以上', min: 0.5, max: null },
]

const QUICK_BUY_AMOUNTS = [1000, 3000, 5000, 10000]

const DEFAULT_PICKER_STATE = {
  keyword: '',
  riskLevel: 'all',
  theme: 'all',
  type: 'all',
  maxDrawdownBand: 'all',
  hasSearched: false,
  appliedFilters: null,
}

export default function FundPicker() {
  const [watchlist, setWatchlist] = useLocalStorageState(LS_KEYS.watchlist, [])
  const [txs, setTxs] = useLocalStorageState(LS_KEYS.holdingsTx, [])
  const [pickerState, setPickerState] = useLocalStorageState(LS_KEYS.fundPickerState, DEFAULT_PICKER_STATE)
  const { funds, meta, loading, searching, error, resultMeta, runSearch, getFundById } = useFunds()

  const [keyword, setKeyword] = useState(() => pickerState.keyword || '')
  const [riskLevel, setRiskLevel] = useState(() => pickerState.riskLevel || 'all')
  const [theme, setTheme] = useState(() => pickerState.theme || 'all')
  const [type, setType] = useState(() => pickerState.type || 'all')
  const [maxDrawdownBand, setMaxDrawdownBand] = useState(() => pickerState.maxDrawdownBand || 'all')
  const [purchaseFundId, setPurchaseFundId] = useState(null)
  const [hasSearched, setHasSearched] = useState(() => Boolean(pickerState.hasSearched))
  const [appliedFilters, setAppliedFilters] = useState(() => pickerState.appliedFilters || null)

  const themeOptions = useMemo(() => meta.themes || [], [meta.themes])
  const typeOptions = useMemo(() => meta.types || [], [meta.types])
  const pageNumbers = useMemo(
    () => Array.from({ length: resultMeta.totalPages || 0 }, (_, index) => index + 1),
    [resultMeta.totalPages],
  )

  useEffect(() => {
    setPickerState({
      keyword,
      riskLevel,
      theme,
      type,
      maxDrawdownBand,
      hasSearched,
      appliedFilters,
    })
  }, [appliedFilters, hasSearched, keyword, maxDrawdownBand, riskLevel, setPickerState, theme, type])

  const submitSearch = async (page = 1) => {
    const selectedBand = DRAWDOWN_OPTIONS.find((item) => item.value === maxDrawdownBand)
    const nextFilters = {
      keyword,
      riskLevel,
      theme,
      type,
      minDrawdown: selectedBand?.min,
      maxDrawdown: selectedBand?.max,
      page,
      pageSize: 20,
    }
    setHasSearched(true)
    setAppliedFilters(nextFilters)
    await runSearch(nextFilters)
  }

  const changePage = async (page) => {
    if (!appliedFilters) return
    const nextFilters = { ...appliedFilters, page }
    setAppliedFilters(nextFilters)
    await runSearch(nextFilters)
  }

  const toggleWatch = (fundId) => {
    setWatchlist((prev) => (prev.includes(fundId) ? prev.filter((x) => x !== fundId) : [...prev, fundId]))
  }

  const addBuyTx = ({ fund, amount, date }) => {
    const nav = getLatestNav(fund)
    const feeRate = fund.feeRate
    const fee = amount * feeRate
    const net = Math.max(0, amount - fee)
    const shares = nav > 0 ? net / nav : 0

    setTxs((prev) => [
      ...prev,
      {
        id: uid('tx'),
        fundId: fund.id,
        action: 'buy',
        date,
        amount,
        feeRate,
        fee,
        shares,
      },
    ])
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>筛选条件</div>
          <div className="pill">自选 {watchlist.length}</div>
        </div>
        <input
          className="input"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="基金代码/名称（选填）"
        />
        <div className="grid2">
          <select className="select" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
            <option value="all">风险等级（可选）</option>
            <option value="1">R1 低</option>
            <option value="2">R2</option>
            <option value="3">R3</option>
            <option value="4">R4</option>
            <option value="5">R5 高</option>
          </select>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">基金类型（可选）</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select className="select" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="all">行业主题（可选）</option>
            {themeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select className="select" value={maxDrawdownBand} onChange={(e) => setMaxDrawdownBand(e.target.value)}>
            <option value="all">最大回撤（可选）</option>
            {DRAWDOWN_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            style={{ minWidth: 88, background: '#f8e7de', color: '#7c3f2a', border: '1px solid rgba(124, 63, 42, 0.08)' }}
            onClick={() => submitSearch(1)}
            disabled={searching}
          >
            {searching ? '筛选中...' : '筛选'}
          </button>
        </div>
        {error && <div className="muted" style={{ color: '#b42318', fontSize: 12 }}>{error}</div>}
        <div className="muted" style={{ fontSize: 12 }}>
          基金代码和名称、风险等级、基金类型、行业主题、最大回撤均可自由组合筛选。
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>搜索结果</div>
          <div className="pill">
            {searching || loading ? '加载中' : hasSearched ? `共 ${resultMeta.total} 只` : '待筛选'}
          </div>
        </div>
        {!hasSearched ? (
          <div className="muted">可按任意筛选条件组合后点击「筛选」，页面将按页展示 20 条符合要求的在售基金。</div>
        ) : loading ? (
          <div className="muted">基金列表加载中...</div>
        ) : (
          <div className="stack">
            {searching && <div className="muted">正在筛选符合条件的基金，请稍候...</div>}
            {funds.map((f) => {
              const inWatch = watchlist.includes(f.id)
              const latestDate = getLatestDate(f)
              const latestNav = getLatestNav(f)
              return (
                <div key={f.id} className="card stack" style={{ padding: 12 }}>
                  <div className="row">
                    <Link to={`/funds/${f.id}`} className="fund-name-link">
                      {f.name} <span className="muted">({f.code})</span>
                    </Link>
                    <div className="pill">R{f.riskLevel}</div>
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <span className="pill">{f.type}</span>
                    <span className="pill">{f.theme}</span>
                    <span className="pill">费率 {pct(f.feeRate, 2)}</span>
                    <span className="pill">最大回撤 {f.maxDrawdownHint == null ? '—' : pct(f.maxDrawdownHint, 1)}</span>
                    <span className="pill">最新净值 {latestNav.toFixed(4)}</span>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className={inWatch ? 'btn btn-secondary btn-small' : 'btn btn-small'}
                      onClick={() => toggleWatch(f.id)}
                    >
                      {inWatch ? '已加入自选' : '加入自选'}
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => setPurchaseFundId((p) => (p === f.id ? null : f.id))}>
                      购买
                    </button>
                  </div>

                  {purchaseFundId === f.id && (
                    <PurchaseModal
                      fund={f}
                      defaultDate={latestDate}
                      onCancel={() => setPurchaseFundId(null)}
                      onConfirm={(payload) => {
                        addBuyTx(payload)
                        setPurchaseFundId(null)
                      }}
                    />
                  )}

                  <div className="muted" style={{ fontSize: 12 }}>
                    数据日期：{latestDate || '—'}
                  </div>
                </div>
              )
            })}
            {!funds.length && !searching && <div className="muted">未找到符合条件的基金，试试放宽筛选条件。</div>}
            {resultMeta.totalPages > 1 && (
              <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                {pageNumbers.map((page) => (
                  <button
                    key={page}
                    type="button"
                    className={resultMeta.page === page ? 'btn btn-small' : 'btn btn-secondary btn-small'}
                    onClick={() => changePage(page)}
                    disabled={searching}
                  >
                    {page}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {txs.length > 0 && (
        <div className="card stack">
          <div className="row">
            <div style={{ fontWeight: 800 }}>最近购买记录</div>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => setTxs([])}
            >
              清空
            </button>
          </div>
          <div className="stack">
            {txs
              .slice()
              .reverse()
              .slice(0, 5)
              .map((t) => {
                const fund = getFundById(t.fundId)
                return (
                  <div key={t.id} className="row" style={{ fontSize: 13 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{fund?.name || t.fundId}</div>
                      <div className="muted">{t.date}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800 }}>¥{toNumber(t.amount).toFixed(2)}</div>
                      <div className="muted">份额 {toNumber(t.shares).toFixed(4)}</div>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

const PurchaseModal = ({ fund, defaultDate, onCancel, onConfirm }) => {
  const today = new Date().toISOString().slice(0, 10)
  const [amount, setAmount] = useState(String(QUICK_BUY_AMOUNTS[0]))
  const [acknowledged, setAcknowledged] = useState(false)
  const nav = getLatestNav(fund)
  const feeRate = fund.feeRate
  const amountN = Math.max(0, toNumber(amount, 0))
  const fee = amountN * feeRate
  const shares = nav > 0 ? Math.max(0, amountN - fee) / nav : 0
  const date = defaultDate || today
  const documentLinks = {
    rights: `https://fundf10.eastmoney.com/jjgg_${fund.code}_5.html`,
    contract: `https://fundf10.eastmoney.com/jjgg_${fund.code}_1.html`,
    prospectus: `https://fundf10.eastmoney.com/jjgg_${fund.code}_1.html`,
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div style={{ fontWeight: 900 }}>购买基金</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={onCancel}>
            关闭
          </button>
        </div>

        <div className="xh-card">
          <div className="xh-header">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="xh-title">{fund.name}</div>
              <div className="xh-sub">
                {fund.code} · {fund.type} · R{fund.riskLevel}
              </div>
            </div>
            <span className="tag tag-warm">申购</span>
          </div>
          <div className="grid2" style={{ marginTop: 12 }}>
            <div className="pill" style={{ justifyContent: 'center' }}>
              最新净值 {nav.toFixed(4)}
            </div>
            <div className="pill" style={{ justifyContent: 'center' }}>
              申购费率 {pct(feeRate, 2)}
            </div>
          </div>
        </div>

        <div className="stack">
          <div style={{ fontWeight: 800, fontSize: 13 }}>选择购买金额</div>
          <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            {QUICK_BUY_AMOUNTS.map((item) => (
              <button
                key={item}
                type="button"
                className={toNumber(amount, 0) === item ? 'btn btn-small' : 'btn btn-secondary btn-small'}
                onClick={() => setAmount(String(item))}
              >
                ¥{item.toLocaleString('zh-CN')}
              </button>
            ))}
          </div>
          <input
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="自定义购买金额（元）"
            inputMode="decimal"
          />
        </div>

        <div className="xh-card" style={{ background: 'linear-gradient(135deg, rgba(255,244,230,0.92), rgba(245,242,255,0.9))' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800 }}>申购测算</div>
              <div className="xh-sub">预计净申购金额与份额按最新净值估算，最终以基金确认结果为准。</div>
            </div>
          </div>
          <div className="grid2" style={{ marginTop: 10 }}>
            <div className="pill" style={{ justifyContent: 'center' }}>
              预计净申购 ¥{Math.max(0, amountN - fee).toFixed(2)}
            </div>
            <div className="pill" style={{ justifyContent: 'center' }}>
              预计份额 {shares.toFixed(4)}
            </div>
          </div>
        </div>

        <div className="xh-card">
          <div style={{ fontWeight: 800 }}>基金文件</div>
          <div className="stack" style={{ marginTop: 10 }}>
            <a className="fund-doc-link" href={documentLinks.rights} target="_blank" rel="noreferrer">
              《投资人权益须知》
            </a>
            <a className="fund-doc-link" href={documentLinks.contract} target="_blank" rel="noreferrer">
              《基金合同》
            </a>
            <a className="fund-doc-link" href={documentLinks.prospectus} target="_blank" rel="noreferrer">
              《招募说明书》
            </a>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            文件入口跳转至基金公告/销售文件页，请以基金管理人披露的最新版本为准。
          </div>
        </div>

        <div className="xh-card" style={{ background: 'rgba(255, 247, 240, 0.92)' }}>
          <div style={{ fontWeight: 800 }}>风险提示</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginTop: 6 }}>
            基金投资有风险，过往业绩不预示未来表现。申购前请认真阅读《投资人权益须知》《基金合同》《招募说明书》，并结合自身风险承受能力谨慎决策。
          </div>
          <label className="row" style={{ justifyContent: 'flex-start', marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span style={{ fontSize: 12 }}>我已阅读并知悉上述基金文件与风险提示</span>
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn"
            disabled={amountN <= 0 || !acknowledged}
            onClick={() =>
              onConfirm({
                fund,
                amount: amountN,
                date,
              })
            }
          >
            确认购买
          </button>
        </div>
      </div>
    </div>
  )
}
