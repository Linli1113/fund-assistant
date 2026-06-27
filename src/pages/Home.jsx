import { Link } from 'react-router-dom'
import { useLocalStorageState } from '../lib/useLocalStorageState'
import { LS_KEYS } from '../lib/keys'

export default function Home({ user }) {
  const [watchlist] = useLocalStorageState(LS_KEYS.watchlist, [])
  const [txs] = useLocalStorageState(LS_KEYS.holdingsTx, [])
  const [rules] = useLocalStorageState(LS_KEYS.watchRules, [])

  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ fontWeight: 900, fontSize: 18 }}>你好，{user?.username || '用户'}</div>
        <div className="home-metrics">
          <div className="home-metric-card">
            <div className="home-metric-label">自选</div>
            <div className="home-metric-value">{watchlist.length}</div>
          </div>
          <div className="home-metric-card">
            <div className="home-metric-label">持仓</div>
            <div className="home-metric-value">{txs.length}</div>
          </div>
          <div className="home-metric-card">
            <div className="home-metric-label">盯盘规则</div>
            <div className="home-metric-value">{rules.length}</div>
          </div>
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>快速入口</div>
          <div className="pill">全流程陪伴</div>
        </div>
        <div className="grid2">
          <Link className="btn btn-secondary" to="/pick" style={{ textDecoration: 'none', textAlign: 'center' }}>
            智能选基
          </Link>
          <Link className="btn btn-secondary" to="/simulate" style={{ textDecoration: 'none', textAlign: 'center' }}>
            模拟投资
          </Link>
          <Link className="btn btn-secondary" to="/diagnose" style={{ textDecoration: 'none', textAlign: 'center' }}>
            持有诊断
          </Link>
          <Link className="btn btn-secondary" to="/watch" style={{ textDecoration: 'none', textAlign: 'center' }}>
            智能盯盘
          </Link>
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <div style={{ fontWeight: 800 }}>演示路径</div>
          <div className="pill">建议</div>
        </div>
        <div className="stack" style={{ fontSize: 13 }}>
          <div className="pill" style={{ justifyContent: 'flex-start' }}>
            1）去「智能选基」筛选并加入自选，点“购买”生成持仓
          </div>
          <div className="pill" style={{ justifyContent: 'flex-start' }}>
            2）去「模拟投资」从自选勾选基金，查看组合曲线、买入历史与诊断
          </div>
          <div className="pill" style={{ justifyContent: 'flex-start' }}>
            3）去「持有诊断」查看收益归因、风险暴露与方向性建议
          </div>
          <div className="pill" style={{ justifyContent: 'flex-start' }}>
            4）去「智能盯盘」设置闭市后收益/亏损阈值提醒
          </div>
          <div className="home-disclaimer">
            数据来源于 AKShare 等公开数据接口，基金过往业绩并不预示未来表现，市场有风险，投资须谨慎。
          </div>
        </div>
      </div>
    </div>
  )
}
