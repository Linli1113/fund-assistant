import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import './layout.css'

const Tab = ({ to, label }) => {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => (isActive ? 'tab tab-active' : 'tab')}
      end
    >
      {label}
    </NavLink>
  )
}

export default function Layout({ user, onLogout }) {
  const nav = useNavigate()
  return (
    <div className="app">
      <header className="app-header">
        <div className="row" style={{ alignItems: 'center' }}>
          <div>
            <div className="app-title">基金陪伴小助手</div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              onLogout?.()
              nav('/login', { replace: true })
            }}
          >
            退出
          </button>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="主导航">
        <Tab to="/home" label="首页" />
        <Tab to="/pick" label="智能选基" />
        <Tab to="/simulate" label="模拟投资" />
        <Tab to="/diagnose" label="持有诊断" />
        <Tab to="/watch" label="智能盯盘" />
        <Tab to="/me" label="我的" />
      </nav>
    </div>
  )
}
