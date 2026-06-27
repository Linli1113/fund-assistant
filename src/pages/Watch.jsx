import { useEffect, useMemo, useState } from 'react'
import { useLocalStorageState } from '../lib/useLocalStorageState'
import { LS_KEYS } from '../lib/keys'
import { pct, toNumber } from '../lib/finance'
import { uid } from '../lib/storage'
import { useFunds } from '../lib/fundsContext'
import { getLatestNav } from '../lib/fundUtils'

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))

const todayKey = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const isAfterClose = () => {
  const d = new Date()
  const h = d.getHours()
  const min = d.getMinutes()
  return h > 15 || (h === 15 && min >= 0)
}

const computeAvgCostNav = (txs, fundId) => {
  let cost = 0
  let shares = 0
  for (const t of txs) {
    if (t.fundId !== fundId) continue
    if (t.action === 'buy') {
      cost += toNumber(t.amount, 0)
      shares += toNumber(t.shares, 0)
    }
  }
  if (shares <= 0) return null
  return cost / shares
}

const pushNotification = (title, body) => {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'granted') {
    new Notification(title, { body })
    return
  }
}

export default function Watch() {
  const [watchlist] = useLocalStorageState(LS_KEYS.watchlist, [])
  const [txs] = useLocalStorageState(LS_KEYS.holdingsTx, [])
  const [rules, setRules] = useLocalStorageState(LS_KEYS.watchRules, [])
  const [alarms, setAlarms] = useLocalStorageState(LS_KEYS.alarms, [])
  const [lastCloseCheck, setLastCloseCheck] = useLocalStorageState(LS_KEYS.lastCloseCheck, null)
  const { ensureFundDetails, getFundById } = useFunds()

  useEffect(() => {
    const ids = new Set(watchlist)
    for (const tx of txs) if (tx.fundId) ids.add(tx.fundId)
    for (const rule of rules) if (rule.fundId) ids.add(rule.fundId)
    for (const alarm of alarms) if (alarm.fundId) ids.add(alarm.fundId)
    ensureFundDetails(Array.from(ids)).catch(() => {})
  }, [alarms, ensureFundDetails, rules, txs, watchlist])

  const selectableFunds = useMemo(() => {
    const ids = new Set(watchlist)
    for (const t of txs) if (t.fundId) ids.add(t.fundId)
    return Array.from(ids).map((id) => getFundById(id)).filter(Boolean)
  }, [getFundById, txs, watchlist])

  const [fundId, setFundId] = useState(selectableFunds[0]?.id || '')
  const [targetReturn, setTargetReturn] = useState('10')
  const [maxLoss, setMaxLoss] = useState('10')
  const [alarmModalOpen, setAlarmModalOpen] = useState(false)

  useEffect(() => {
    if (!fundId && selectableFunds[0]?.id) setFundId(selectableFunds[0].id)
  }, [fundId, selectableFunds])

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') await Notification.requestPermission()
  }

  const evaluateRules = () => {
    const today = todayKey()
    const now = new Date().toLocaleString()
    const nextRules = rules.map((r) => ({ ...r }))
    const newAlarms = []

    for (let i = 0; i < nextRules.length; i += 1) {
      const r = nextRules[i]
      const fund = getFundById(r.fundId)
      if (!fund) continue
      const nav = getLatestNav(fund)
      const basisCostNav = computeAvgCostNav(txs, r.fundId)
      const referenceNav = basisCostNav ?? r.referenceNav ?? nav
      const ret = referenceNav > 0 ? nav / referenceNav - 1 : 0
      const target = toNumber(r.targetReturn, 0) / 100
      const stop = toNumber(r.maxLoss, 0) / 100
      const hitTarget = ret >= target
      const hitStop = ret <= -stop

      if ((hitTarget || hitStop) && r.lastTriggeredOn !== today) {
        const type = hitTarget ? 'target' : 'stop'
        const message = hitTarget
          ? `${fund.name} 达到目标收益 ${pct(ret, 2)}`
          : `${fund.name} 触及亏损阈值 ${pct(ret, 2)}`
        const alarm = { id: uid('alarm'), dateTime: now, today, fundId: fund.id, type, ret, message }
        newAlarms.push(alarm)
        r.lastTriggeredOn = today
        pushNotification('基金盯盘提醒', message)
      }

      if (r.referenceNav == null && basisCostNav == null) r.referenceNav = nav
    }

    if (newAlarms.length) setAlarms((prev) => [...newAlarms, ...prev].slice(0, 50))
    setRules(nextRules)
    setLastCloseCheck(today)
    return newAlarms.length
  }

  useEffect(() => {
    requestPermission()
  }, [])

  useEffect(() => {
    const today = todayKey()
    if (!isAfterClose()) return
    if (lastCloseCheck === today) return
    if (rules.length === 0) return
    evaluateRules()
  }, [lastCloseCheck, rules.length])

  const addRule = (alarmConfig = {}) => {
    if (!fundId) return
    setRules((prev) => [
      ...prev,
      {
        id: uid('rule'),
        fundId,
        targetReturn: toNumber(targetReturn, 10),
        maxLoss: toNumber(maxLoss, 10),
        createdAt: new Date().toLocaleString(),
        referenceNav: null,
        lastTriggeredOn: null,
        reminderName: alarmConfig.reminderName || '',
        reminderHour: alarmConfig.reminderHour || '15',
        reminderMinute: alarmConfig.reminderMinute || '00',
        reminderDateLabel: alarmConfig.reminderDateLabel || '明天',
        soundEnabled: alarmConfig.soundEnabled ?? true,
        autoDelete: alarmConfig.autoDelete ?? false,
        snoozeEnabled: alarmConfig.snoozeEnabled ?? true,
        voiceEnabled: alarmConfig.voiceEnabled ?? false,
      },
    ])
  }

  const removeRule = (id) => setRules((prev) => prev.filter((r) => r.id !== id))

  const clearAlarms = () => setAlarms([])

  const clearAll = () => {
    setRules([])
    setAlarms([])
    setLastCloseCheck(null)
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>智能盯盘（闭市后触发）</div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          规则每天闭市后检查一次：达到目标收益或触及最大亏损比例才提醒，未达条件不触发。
        </div>
        <div className="grid2">
          <div className="stack" style={{ gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>基金名</div>
            <select className="select" value={fundId} onChange={(e) => setFundId(e.target.value)}>
              <option value="">选择基金</option>
              {selectableFunds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}（{f.code}）
                </option>
              ))}
            </select>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>目标收益率</div>
            <input
              className="input"
              value={targetReturn}
              onChange={(e) => setTargetReturn(e.target.value)}
              placeholder="如 10 表示目标收益率 10%"
              inputMode="decimal"
            />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>最大亏损率</div>
            <input
              className="input"
              value={maxLoss}
              onChange={(e) => setMaxLoss(e.target.value)}
              placeholder="如 10 表示最大可承受亏损 10%"
              inputMode="decimal"
            />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>添加提醒</div>
          <button
            type="button"
            className="btn"
            disabled={!fundId}
            style={{
              background: 'linear-gradient(135deg, #f8ead8, #f6e7cf)',
              color: '#7c5a35',
              boxShadow: '0 10px 24px rgba(199, 164, 115, 0.18)',
              border: '1px solid rgba(124, 90, 53, 0.08)',
            }}
            onClick={() => setAlarmModalOpen(true)}
          >
            添加提醒
          </button>
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-small" onClick={clearAll} disabled={rules.length === 0 && alarms.length === 0}>
            清空全部
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          最近一次闭市检查：{lastCloseCheck || '—'} · 当前时间是否闭市后：{isAfterClose() ? '是' : '否'}
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>盯盘规则</div>
        </div>
        {rules.length === 0 ? (
          <div className="muted">还没有规则。可以先从自选/持仓里选择基金添加提醒。</div>
        ) : (
          <div className="stack">
            {rules.map((r) => {
              const fund = getFundById(r.fundId)
              const nav = fund ? getLatestNav(fund) : null
              const avgCostNav = computeAvgCostNav(txs, r.fundId)
              const ref = avgCostNav ?? r.referenceNav ?? nav ?? 1
              const ret = nav && ref > 0 ? nav / ref - 1 : 0
              return (
                <div key={r.id} className="card stack" style={{ padding: 12 }}>
                  <div className="row">
                    <div style={{ fontWeight: 800 }}>
                      {fund?.name || r.fundId} <span className="muted">({fund?.code || '—'})</span>
                    </div>
                    <button type="button" className="btn btn-danger btn-small" onClick={() => removeRule(r.id)}>
                      删除
                    </button>
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <span className="pill">目标 {toNumber(r.targetReturn, 0).toFixed(1)}%</span>
                    <span className="pill">止损 {toNumber(r.maxLoss, 0).toFixed(1)}%</span>
                    <span className="pill">提醒 {r.reminderHour || '15'}:{r.reminderMinute || '00'}</span>
                    <span className="pill">当前收益 {pct(ret, 2)}</span>
                    <span className="pill">基准 {avgCostNav != null ? '成本' : '创建时净值'}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    创建于：{r.createdAt} · 上次触发：{r.lastTriggeredOn || '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>提醒记录</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={clearAlarms} disabled={alarms.length === 0}>
            清空
          </button>
        </div>
        {alarms.length === 0 ? (
          <div className="muted">暂无提醒。闭市后达到条件才会出现记录。</div>
        ) : (
          <div className="stack">
            {alarms.slice(0, 20).map((a) => {
              const fund = getFundById(a.fundId)
              return (
                <div key={a.id} className="row" style={{ fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{fund?.name || a.fundId}</div>
                    <div className="muted">{a.dateTime}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800 }}>{pct(a.ret, 2)}</div>
                    <div className="muted">{a.type === 'target' ? '达标' : '止损'}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {alarmModalOpen && (
        <AlarmSetupModal
          fund={getFundById(fundId)}
          onClose={() => setAlarmModalOpen(false)}
          onConfirm={(alarmConfig) => {
            addRule(alarmConfig)
            setAlarmModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

const AlarmSetupModal = ({ fund, onClose, onConfirm }) => {
  const [reminderHour, setReminderHour] = useState('15')
  const [reminderMinute, setReminderMinute] = useState('00')
  const [reminderDateLabel, setReminderDateLabel] = useState('明天')
  const [reminderName, setReminderName] = useState(`${fund?.name || '基金'}盯盘提醒`)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [autoDelete, setAutoDelete] = useState(false)
  const [snoozeEnabled, setSnoozeEnabled] = useState(true)
  const [voiceEnabled, setVoiceEnabled] = useState(false)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal alarm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="alarm-modal-header">
          <button type="button" className="alarm-modal-link" onClick={onClose}>
            取消
          </button>
          <div className="alarm-modal-title">新建闹钟</div>
          <button
            type="button"
            className="alarm-modal-link"
            onClick={() =>
              onConfirm({
                reminderHour,
                reminderMinute,
                reminderDateLabel,
                reminderName,
                soundEnabled,
                autoDelete,
                snoozeEnabled,
                voiceEnabled,
              })
            }
          >
            完成
          </button>
        </div>

        <div className="alarm-clock-panel">
          <div className="alarm-clock-labels">
            <span>时</span>
            <span>分</span>
          </div>
          <div className="alarm-time-grid">
            <select className="select alarm-time-select" value={reminderHour} onChange={(e) => setReminderHour(e.target.value)}>
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hour}
                </option>
              ))}
            </select>
            <select className="select alarm-time-select" value={reminderMinute} onChange={(e) => setReminderMinute(e.target.value)}>
              {MINUTES.map((minute) => (
                <option key={minute} value={minute}>
                  {minute}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="alarm-setting-card">
          <div className="alarm-setting-row">
            <div>
              <div className="alarm-setting-label">日期</div>
              <div className="alarm-setting-desc">提醒时间生效日期</div>
            </div>
            <select className="select alarm-inline-select" value={reminderDateLabel} onChange={(e) => setReminderDateLabel(e.target.value)}>
              <option value="今天">今天</option>
              <option value="明天">明天</option>
            </select>
          </div>

          <div className="alarm-setting-row">
            <div>
              <div className="alarm-setting-label">闹钟名称</div>
              <div className="alarm-setting-desc">默认带入当前基金名称</div>
            </div>
            <input
              className="input alarm-inline-input"
              value={reminderName}
              onChange={(e) => setReminderName(e.target.value)}
              placeholder="请输入提醒名称"
            />
          </div>

          <div className="alarm-setting-row">
            <div>
              <div className="alarm-setting-label">铃声与振动</div>
              <div className="alarm-setting-desc">{soundEnabled ? '默认铃声' : '关闭'}</div>
            </div>
            <button type="button" className={soundEnabled ? 'alarm-toggle alarm-toggle-on' : 'alarm-toggle'} onClick={() => setSoundEnabled((prev) => !prev)}>
              <span className="alarm-toggle-thumb" />
            </button>
          </div>

          <div className="alarm-setting-row">
            <div>
              <div className="alarm-setting-label">提醒关闭后删除此闹钟</div>
              <div className="alarm-setting-desc">闹钟响起时关闭闹钟，此闹钟会被删除。</div>
            </div>
            <button type="button" className={autoDelete ? 'alarm-toggle alarm-toggle-on' : 'alarm-toggle'} onClick={() => setAutoDelete((prev) => !prev)}>
              <span className="alarm-toggle-thumb" />
            </button>
          </div>

          <div className="alarm-setting-row">
            <div>
              <div className="alarm-setting-label">稍后提醒</div>
              <div className="alarm-setting-desc">{snoozeEnabled ? '间隔 5 分钟，提醒 5 次' : '关闭'}</div>
            </div>
            <button type="button" className={snoozeEnabled ? 'alarm-toggle alarm-toggle-on' : 'alarm-toggle'} onClick={() => setSnoozeEnabled((prev) => !prev)}>
              <span className="alarm-toggle-thumb" />
            </button>
          </div>

          <div className="alarm-setting-row">
            <div>
              <div className="alarm-setting-label">语音播报</div>
              <div className="alarm-setting-desc">{voiceEnabled ? '开启' : '关闭'}</div>
            </div>
            <button type="button" className={voiceEnabled ? 'alarm-toggle alarm-toggle-on' : 'alarm-toggle'} onClick={() => setVoiceEnabled((prev) => !prev)}>
              <span className="alarm-toggle-thumb" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
