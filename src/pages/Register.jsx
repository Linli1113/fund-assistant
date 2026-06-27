import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUser, findUserByPhone, findUserByUsername, isValidPhone, normalizePhone, validatePassword } from '../lib/auth'
import './layout.css'
import './auth.css'

export default function Register() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  const passwordError = useMemo(() => validatePassword(password), [password])
  const canSubmit = useMemo(() => {
    const u = username.trim()
    const p = normalizePhone(phone)
    if (!u) return false
    if (!isValidPhone(p)) return false
    if (passwordError) return false
    if (password !== confirm) return false
    return true
  }, [username, phone, passwordError, password, confirm])

  const submit = (e) => {
    e.preventDefault()
    setError('')
    const u = username.trim()
    const p = normalizePhone(phone)

    if (!u) {
      setError('请输入账号')
      return
    }
    if (findUserByUsername(u)) {
      setError('该账号已存在')
      return
    }
    if (!isValidPhone(p)) {
      setError('请输入正确的手机号')
      return
    }
    if (findUserByPhone(p)) {
      setError('该手机号已注册，可直接用手机号登录')
      return
    }
    const pe = validatePassword(password)
    if (pe) {
      setError(pe)
      return
    }
    if (password !== confirm) {
      setError('两次密码不一致')
      return
    }

    createUser({ username: u, phone: p, password, provider: 'account' })
    nav('/login', { replace: true })
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <div className="auth-title">注册账号</div>
          <div className="auth-subtitle">注册后可使用账号密码、手机号验证码登录。</div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <div className="stack">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="账号（用于账号登录）" />
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="手机号（用于手机号登录）"
            inputMode="numeric"
          />
          <input
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（8-12 位，英文+数字）"
            type="password"
          />
          <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="确认密码" type="password" />
          {passwordError && <div className="muted" style={{ fontSize: 12 }}>{passwordError}</div>}
        </div>

        <button type="submit" className="btn" disabled={!canSubmit}>
          注册
        </button>

        <div className="auth-foot">
          <div>
            已有账号？ <Link className="auth-link" to="/login">去登录</Link>
          </div>
          <div className="muted">不涉及真实资金与交易</div>
        </div>
      </form>
    </div>
  )
}

