import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ensurePhoneUser,
  findUserByUsername,
  isValidPhone,
  normalizePhone,
  setCurrentUser,
} from '../lib/auth'
import './layout.css'
import './auth.css'

const modes = [
  { key: 'account', label: '账号' },
  { key: 'phone', label: '手机号' },
]

export default function Login({ onLogin }) {
  const nav = useNavigate()
  const [mode, setMode] = useState('account')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)

  const [error, setError] = useState('')

  const canLogin = useMemo(() => {
    if (mode === 'account') return username.trim() && password
    if (mode === 'phone') return isValidPhone(phone) && otp.trim().length === 6
    return false
  }, [mode, username, password, phone, otp])

  const doLogin = (user) => {
    setCurrentUser(user)
    onLogin?.(user)
    nav('/home', { replace: true })
  }

  const submit = (e) => {
    e.preventDefault()
    setError('')

    if (mode === 'account') {
      const u = findUserByUsername(username)
      if (!u) {
        setError('账号不存在，请先注册')
        return
      }
      if ((u.password || '') !== password) {
        setError('密码错误')
        return
      }
      doLogin(u)
      return
    }

    if (mode === 'phone') {
      const p = normalizePhone(phone)
      if (!isValidPhone(p)) {
        setError('请输入正确的手机号')
        return
      }
      if (!otpSent) {
        setError('请先获取验证码')
        return
      }
      if (otp !== '123456') {
        setError('验证码错误（测试验证码：123456）')
        return
      }
      const u = ensurePhoneUser(p)
      doLogin(u)
    }
  }

  const sendOtp = () => {
    setError('')
    const p = normalizePhone(phone)
    if (!isValidPhone(p)) {
      setError('请输入正确的手机号')
      return
    }
    setOtpSent(true)
    setOtp('123456')
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <div className="auth-title">欢迎回来</div>
          <div className="auth-subtitle">登录后可使用选基、模拟、诊断、盯盘等功能（模拟数据）。</div>
        </div>

        <div className="segmented" role="tablist" aria-label="登录方式">
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              className={mode === m.key ? 'seg-btn seg-btn-active' : 'seg-btn'}
              onClick={() => {
                setMode(m.key)
                setError('')
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {error && <div className="auth-error">{error}</div>}

        {mode === 'account' && (
          <div className="stack">
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="账号" />
            <input
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              type="password"
            />
          </div>
        )}

        {mode === 'phone' && (
          <div className="stack">
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="手机号（11 位）"
              inputMode="numeric"
            />
            <div className="otp-row">
              <input
                className="input"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="验证码（测试：123456）"
                inputMode="numeric"
              />
              <button type="button" className="btn btn-secondary" onClick={sendOtp}>
                获取验证码
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              MVP 版本不接短信服务，验证码固定为 123456。
            </div>
          </div>
        )}

        <button type="submit" className="btn" disabled={!canLogin}>
          登录
        </button>

        <div className="auth-foot">
          <div>
            还没有账号？ <Link className="auth-link" to="/register">去注册</Link>
          </div>
          <div className="muted">密码需 8-12 位且包含英文+数字</div>
        </div>
      </form>
    </div>
  )
}
