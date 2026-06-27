import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { updateUserProfile } from '../lib/auth'
import { useFunds } from '../lib/fundsContext'
import { useLocalStorageState } from '../lib/useLocalStorageState'
import { LS_KEYS } from '../lib/keys'
import { MARKET_OPEN_LABEL, computeHoldings, enrichHoldings } from '../lib/holdingUtils'
import { pct } from '../lib/finance'
import { chatAssistant } from '../lib/fundApi'
import { uid } from '../lib/storage'

const formatAmount = (value) =>
  Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const getProviderLabel = (provider) => {
  if (provider === 'phone') return '手机号用户'
  return '账号用户'
}

const QUESTION_SUGGESTIONS = ['什么是定投？', '我的组合风险高吗？', '回撤是什么意思？', '基金应该怎么止盈止损？']
const DEFAULT_ASSISTANT_MESSAGES = [
  {
    id: 'welcome',
    role: 'assistant',
    text: '你好呀，我是你的 AI小助。你可以问我基金、定投、回撤、组合风险、止盈止损等问题。',
  },
]

export default function MyPage({ user, onUpdateUser }) {
  const [txs, setTxs] = useLocalStorageState(LS_KEYS.holdingsTx, [])
  const [rules] = useLocalStorageState(LS_KEYS.watchRules, [])
  const [messages, setMessages] = useLocalStorageState(LS_KEYS.profileAssistantMessages, DEFAULT_ASSISTANT_MESSAGES)
  const { ensureFundDetails, getFundById } = useFunds()
  const fileRef = useRef(null)
  const [question, setQuestion] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantError, setAssistantError] = useState('')
  const [redeemTarget, setRedeemTarget] = useState(null)
  const [addPositionTarget, setAddPositionTarget] = useState(null)

  const holdings = useMemo(() => computeHoldings(txs), [txs])

  useEffect(() => {
    ensureFundDetails(holdings.map((item) => item.fundId)).catch(() => {})
  }, [ensureFundDetails, holdings])

  const enrichedHoldings = useMemo(() => enrichHoldings(holdings, getFundById), [getFundById, holdings])

  const overview = useMemo(() => {
    const holdingAmount = enrichedHoldings.reduce((sum, item) => sum + item.value, 0)
    const holdingIncome = enrichedHoldings.reduce((sum, item) => sum + item.holdingIncome, 0)
    const yesterdayIncome = enrichedHoldings.reduce((sum, item) => sum + item.yesterdayIncome, 0)
    return {
      purchasedCount: enrichedHoldings.length,
      holdingAmount,
      holdingIncome,
      yesterdayIncome,
    }
  }, [enrichedHoldings])

  const assistantContext = useMemo(
    () => ({
      user: {
        id: user?.id,
        username: user?.username,
      },
      overview,
      holdings: enrichedHoldings.map((item) => ({
        fundId: item.fundId,
        code: item.fund.code,
        name: item.fund.name,
        type: item.fund.type,
        riskLevel: item.fund.riskLevel,
        value: Number(item.value.toFixed(2)),
        holdingIncome: Number(item.holdingIncome.toFixed(2)),
        holdingYield: Number(item.holdingYield.toFixed(4)),
        yesterdayIncome: Number(item.yesterdayIncome.toFixed(2)),
      })),
      watchRules: (rules || []).map((item) => ({
        fundId: item.fundId,
        fundName: item.fundName,
        targetProfitRate: item.targetProfitRate,
        maxLossRate: item.maxLossRate,
      })),
    }),
    [enrichedHoldings, overview, rules, user?.id, user?.username],
  )

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const updatedUser = updateUserProfile(user?.id, { avatar: reader.result })
      if (updatedUser) onUpdateUser?.(updatedUser)
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const sendQuestion = async (customQuestion) => {
    const text = String(customQuestion ?? question).trim()
    if (!text) return
    const userMessage = { id: uid('msg_user'), role: 'user', text }
    const nextMessages = [...(messages || DEFAULT_ASSISTANT_MESSAGES), userMessage]
    setMessages(nextMessages)
    setQuestion('')
    setAssistantError('')
    setAssistantLoading(true)
    try {
      const data = await chatAssistant({
        question: text,
        history: nextMessages.slice(-8).map((item) => ({ role: item.role, content: item.text })),
        context: assistantContext,
      })
      setMessages((prev) => [
        ...(prev || DEFAULT_ASSISTANT_MESSAGES),
        { id: uid('msg_ai'), role: 'assistant', text: data.reply || 'AI 助手暂未返回内容。' },
      ])
    } catch (err) {
      setAssistantError(err.message || 'AI 助手暂时不可用，请稍后再试。')
    } finally {
      setAssistantLoading(false)
    }
  }

  const handleRedeemConfirm = ({ holding, redeemAmount, ratio }) => {
    const latestNav = Number(holding.latestNav || 0)
    if (!latestNav || latestNav <= 0) return
    const safeRatio = Math.min(1, Math.max(0, ratio))
    const shares = Number((holding.shares * safeRatio).toFixed(6))
    const costImpact = Number((holding.cost * safeRatio).toFixed(2))
    const amount = Number((redeemAmount).toFixed(2))
    const isAllRedeem = safeRatio >= 0.999

    setTxs((prev) => [
      ...(prev || []),
      {
        id: uid('tx'),
        fundId: holding.fundId,
        action: 'sell',
        date: holding.fund.latestDate || new Date().toISOString().slice(0, 10),
        amount,
        shares: isAllRedeem ? holding.shares : shares,
        costImpact: isAllRedeem ? holding.cost : costImpact,
        nav: latestNav,
        redeemType: isAllRedeem ? 'all' : 'partial',
      },
    ])
    setRedeemTarget(null)
  }

  const handleAddPositionConfirm = ({ holding, amount, date }) => {
    const latestNav = Number(holding.latestNav || 0)
    const feeRate = Number(holding.fund?.feeRate || 0)
    if (!latestNav || latestNav <= 0 || amount <= 0 || !date) return
    const fee = amount * feeRate
    const net = Math.max(0, amount - fee)
    const shares = net / latestNav
    setTxs((prev) => [
      ...(prev || []),
      {
        id: uid('tx'),
        fundId: holding.fundId,
        action: 'buy',
        date,
        amount,
        feeRate,
        fee,
        shares,
      },
    ])
    setAddPositionTarget(null)
  }

  return (
    <div className="stack">
      <div className="profile-hero card stack">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="profile-user">
            <button type="button" className="profile-avatar-btn" onClick={() => fileRef.current?.click()}>
              {user?.avatar ? (
                <img src={user.avatar} alt="头像" className="profile-avatar" />
              ) : (
                <div className="profile-avatar profile-avatar-fallback">{(user?.username || '我').slice(0, 1)}</div>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
            <div>
              <div className="profile-name">{user?.username || '用户'}</div>
              <div className="profile-sub">{getProviderLabel(user?.provider)} · 点击头像可上传图片</div>
            </div>
          </div>
          <div className="pill">我的</div>
        </div>

        <div className="profile-total-card">
          <div className="profile-total-label">基金持仓金额</div>
          <div className="profile-total-value">¥{formatAmount(overview.holdingAmount)}</div>
          <div className="profile-total-grid">
            <div>
              <div className={overview.yesterdayIncome >= 0 ? 'detail-positive' : 'detail-negative'}>¥{formatAmount(overview.yesterdayIncome)}</div>
              <div className="profile-total-note">昨日收益</div>
            </div>
            <div>
              <div className={overview.holdingIncome >= 0 ? 'detail-positive' : 'detail-negative'}>¥{formatAmount(overview.holdingIncome)}</div>
              <div className="profile-total-note">持仓收益</div>
            </div>
            <div>
              <div style={{ fontWeight: 900, color: '#111827' }}>{overview.purchasedCount}</div>
              <div className="profile-total-note">已购基金</div>
            </div>
          </div>
        </div>

        <div className="home-metrics">
          <div className="home-metric-card">
            <div className="home-metric-label">已购基金</div>
            <div className="home-metric-value">{overview.purchasedCount}</div>
          </div>
          <div className="home-metric-card">
            <div className="home-metric-label">基金持仓金额</div>
            <div className="home-metric-value">¥{Math.round(overview.holdingAmount)}</div>
          </div>
          <div className="home-metric-card">
            <div className="home-metric-label">开放时间</div>
            <div className="home-metric-value profile-open-time">{MARKET_OPEN_LABEL}</div>
          </div>
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>我的基金</div>
          <div className="pill">点击查看详情</div>
        </div>
        {!enrichedHoldings.length ? (
          <div className="muted">还没有已购基金。先去「智能选基」或「模拟投资」完成买入后，这里会展示你的基金持仓总览。</div>
        ) : (
          <div className="stack">
            {enrichedHoldings.map((item) => (
              <div key={item.fundId} className="profile-holding-card">
                <div className="profile-holding-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Link to={`/me/holding/${item.fundId}`} className="fund-name-link">
                      {item.fund.name}
                    </Link>
                    <div className="xh-sub">
                      {item.fund.code} · {item.fund.type} · R{item.fund.riskLevel}
                    </div>
                  </div>
                  <div className="profile-holding-actions">
                    <Link to={`/me/holding/${item.fundId}`} className="btn btn-secondary btn-small" style={{ textDecoration: 'none' }}>
                      详情
                    </Link>
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setAddPositionTarget(item)}>
                      加仓
                    </button>
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setRedeemTarget(item)}>
                      赎回
                    </button>
                  </div>
                </div>
                <div className="profile-holding-grid">
                  <div>
                    <div className="profile-mini-label">持仓金额</div>
                    <div className="profile-mini-value">¥{formatAmount(item.value)}</div>
                  </div>
                  <div>
                    <div className="profile-mini-label">昨日收益</div>
                    <div className={item.yesterdayIncome >= 0 ? 'detail-positive' : 'detail-negative'}>¥{formatAmount(item.yesterdayIncome)}</div>
                  </div>
                  <div>
                    <div className="profile-mini-label">持仓收益</div>
                    <div className={item.holdingIncome >= 0 ? 'detail-positive' : 'detail-negative'}>¥{formatAmount(item.holdingIncome)}</div>
                  </div>
                  <div>
                    <div className="profile-mini-label">持仓收益率</div>
                    <div className={item.holdingYield >= 0 ? 'detail-positive' : 'detail-negative'}>{pct(item.holdingYield, 2)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>AI小助</div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <div className="pill">大模型</div>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                setMessages(DEFAULT_ASSISTANT_MESSAGES)
                setAssistantError('')
                setQuestion('')
              }}
              disabled={assistantLoading}
            >
              清空对话
            </button>
          </div>
        </div>
        <div className="tags">
          {QUESTION_SUGGESTIONS.map((item) => (
            <button key={item} type="button" className="range-chip" onClick={() => sendQuestion(item)} disabled={assistantLoading}>
              {item}
            </button>
          ))}
        </div>
        <div className="profile-ai-board">
          {messages.map((item) => (
            <div key={item.id} className={item.role === 'assistant' ? 'profile-ai-bubble profile-ai-bubble-assistant' : 'profile-ai-bubble profile-ai-bubble-user'}>
              {item.text}
            </div>
          ))}
          {assistantLoading && <div className="profile-ai-bubble profile-ai-bubble-assistant">AI 助手正在思考，请稍候...</div>}
        </div>
        <div className="stack">
          <textarea
            className="input profile-ai-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：我的组合风险高吗？基金定投适合我吗？"
          />
          <div className="row">
            <div className="muted" style={{ fontSize: 12 }}>
              已接入后端大模型代理，会结合你的当前持仓和盯盘规则回答问题；也可以先清空历史对话再重新询问。
            </div>
            <button type="button" className="btn btn-small" onClick={() => sendQuestion()} disabled={!question.trim() || assistantLoading}>
              {assistantLoading ? '发送中...' : '发送'}
            </button>
          </div>
          {assistantError && <div className="muted" style={{ color: '#b42318', fontSize: 12 }}>{assistantError}</div>}
        </div>
      </div>

      {redeemTarget && (
        <RedeemModal
          holding={redeemTarget}
          onClose={() => setRedeemTarget(null)}
          onConfirm={handleRedeemConfirm}
        />
      )}

      {addPositionTarget && (
        <AddPositionModal
          holding={addPositionTarget}
          onClose={() => setAddPositionTarget(null)}
          onConfirm={handleAddPositionConfirm}
        />
      )}
    </div>
  )
}

const RedeemModal = ({ holding, onClose, onConfirm }) => {
  const maxAmount = Number(holding?.value || 0)
  const [amount, setAmount] = useState(maxAmount > 0 ? maxAmount.toFixed(2) : '')
  const amountN = Math.max(0, Number(amount || 0))
  const clampedAmount = Math.min(maxAmount, amountN)
  const ratio = maxAmount > 0 ? clampedAmount / maxAmount : 0
  const isAllRedeem = ratio >= 0.999

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 900 }}>赎回基金</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="xh-card">
          <div className="xh-title">{holding.fund.name}</div>
          <div className="xh-sub">
            当前持仓金额 ¥{formatAmount(holding.value)} · 持有份额 {holding.shares.toFixed(4)}
          </div>
        </div>
        <div className="stack">
          <input
            className="input"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="输入赎回金额（元）"
            inputMode="decimal"
          />
          <div className="grid2">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setAmount(maxAmount.toFixed(2))}>
              全部赎回
            </button>
            <div className="pill" style={{ justifyContent: 'center' }}>
              {isAllRedeem ? '本次将完全赎回' : `预计赎回 ${pct(ratio, 1)}`}
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            说明：完全赎回后，该基金会从“我的基金”和“持有诊断”中自动移除；部分赎回则按比例减少持仓金额与持仓成本。
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn"
            disabled={clampedAmount <= 0 || maxAmount <= 0}
            onClick={() =>
              onConfirm({
                holding,
                redeemAmount: clampedAmount,
                ratio,
              })
            }
          >
            确认赎回
          </button>
        </div>
      </div>
    </div>
  )
}

const AddPositionModal = ({ holding, onClose, onConfirm }) => {
  const [amount, setAmount] = useState('1000')
  const [date, setDate] = useState(holding?.fund?.latestDate || new Date().toISOString().slice(0, 10))
  const amountN = Math.max(0, Number(amount || 0))
  const feeRate = Number(holding?.fund?.feeRate || 0)
  const latestNav = Number(holding?.latestNav || 0)
  const fee = amountN * feeRate
  const shares = latestNav > 0 ? Math.max(0, amountN - fee) / latestNav : 0

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 900 }}>加仓基金</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="xh-card">
          <div className="xh-title">{holding.fund.name}</div>
          <div className="xh-sub">
            当前持仓金额 ¥{formatAmount(holding.value)} · 最新净值 {latestNav.toFixed(4)}
          </div>
        </div>
        <div className="stack">
          <div className="grid2">
            <input
              className="input"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="加仓金额（元）"
              inputMode="decimal"
            />
            <input className="input" value={date} onChange={(event) => setDate(event.target.value)} placeholder="日期（YYYY-MM-DD）" />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            预计净申购金额 ¥{Math.max(0, amountN - fee).toFixed(2)}，预计新增份额 {shares.toFixed(4)}。
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn"
            disabled={!date || amountN <= 0}
            onClick={() =>
              onConfirm({
                holding,
                amount: amountN,
                date,
              })
            }
          >
            确认加仓
          </button>
        </div>
      </div>
    </div>
  )
}
