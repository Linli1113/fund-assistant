from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any

import akshare as ak
import pandas as pd
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Fund Companion AKShare API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_CACHE: dict[str, dict[str, Any]] = {}
SOURCE_PRIORITY = {"catalog": 0, "open": 1, "money": 2, "exchange": 3, "index": 4}
SOURCE_LIMITS = {"catalog": 500, "open": 800, "money": 300, "exchange": 500, "index": 400}
DEFAULT_LLM_BASE = "https://api.deepseek.com"
DEFAULT_LLM_MODEL = "deepseek-chat"
CUSTOM_INDEX_LABELS = {
    "sh000300": "沪深300",
    "sh000001": "上证指数",
    "sh000016": "上证50",
    "sh000905": "中证500",
    "sz399001": "深证成指",
    "cbond_mixed": "中债混合",
}


def now_ts() -> float:
    return time.time()


def cached(key: str, ttl_seconds: int, loader):
    item = _CACHE.get(key)
    if item and now_ts() - item["ts"] < ttl_seconds:
        return item["value"]
    value = loader()
    _CACHE[key] = {"ts": now_ts(), "value": value}
    return value


def get_llm_settings() -> tuple[str, str, str]:
    api_key = os.getenv("LLM_API_KEY", "").strip()
    api_base = os.getenv("LLM_API_BASE", DEFAULT_LLM_BASE).strip().rstrip("/")
    model = os.getenv("LLM_MODEL", DEFAULT_LLM_MODEL).strip() or DEFAULT_LLM_MODEL
    return api_key, api_base, model


def to_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, str):
        text = value.replace("%", "").replace(",", "").replace("元", "").replace(" ", "")
        if text in {"", "--", "nan", "None"}:
            return default
        try:
            return float(text)
        except ValueError:
            return default
    try:
        if pd.isna(value):
            return default
    except TypeError:
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_text(value: Any) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except TypeError:
        pass
    return str(value).strip()


def truncate_text(value: str, limit: int = 200) -> str:
    text = safe_text(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


def pct_to_ratio(value: Any) -> float:
    return to_float(value, 0.0) / 100


def normalize_id(code: str) -> str:
    return f"fund_{code}"


def extract_code(value: str) -> str:
    return value.replace("fund_", "").strip()


def normalize_type_label(value: str) -> str:
    return safe_text(value).replace(" ", "")


def load_fund_type_map() -> dict[str, str]:
    def _loader() -> dict[str, str]:
        try:
            df = ak.fund_name_em().fillna("")
        except Exception:
            return {}
        result: dict[str, str] = {}
        for row in df.to_dict("records"):
            code = safe_text(row.get("基金代码"))
            fund_type = normalize_type_label(row.get("基金类型"))
            if code and fund_type:
                result[code] = fund_type
        return result

    return cached("fund_type_map", 24 * 60 * 60, _loader)


def load_low_medium_risk_catalog() -> pd.DataFrame:
    def _loader() -> pd.DataFrame:
        try:
            df = ak.fund_name_em().fillna("")
        except Exception:
            return pd.DataFrame()

        selected_rows: list[dict[str, Any]] = []
        bucket_limits = {2: 260, 3: 240}
        bucket_counts = {2: 0, 3: 0}

        for row in df.to_dict("records"):
            code = safe_text(row.get("基金代码"))
            name = safe_text(row.get("基金简称"))
            raw_type = normalize_type_label(row.get("基金类型"))
            if not code or not name or not raw_type:
                continue

            fund_type = infer_type(name, raw_type, "catalog")
            theme = infer_theme(name, "", fund_type)
            risk_level = infer_risk_level(fund_type, theme, raw_type)
            if risk_level not in bucket_limits:
                continue
            if bucket_counts[risk_level] >= bucket_limits[risk_level]:
                continue

            selected_rows.append(
                {
                    "基金代码": code,
                    "基金简称": name,
                    "类型": raw_type,
                    "跟踪标的": "",
                    "单位净值": "",
                    "日期": "",
                    "手续费": "",
                }
            )
            bucket_counts[risk_level] += 1
            if all(bucket_counts[level] >= bucket_limits[level] for level in bucket_limits):
                break

        return pd.DataFrame(selected_rows)

    return cached("fund_catalog_low_medium", 24 * 60 * 60, _loader)


def infer_type(name: str, raw_type: str = "", source: str = "") -> str:
    text = normalize_type_label(f"{name} {raw_type}").lower()
    if "货币" in text:
        return "货币基金"
    if "债" in text or "固收" in text:
        return "债券基金"
    if "指数" in text or "etf" in text or "lof" in text or "被动" in text:
        return "指数基金"
    if "qdii" in text:
        return "主动权益"
    if "股票" in text or "混合" in text or "reits" in text:
        return "主动权益"
    if source == "money":
        return "货币基金"
    return "主动权益"


THEME_ALIASES = [
    ("沪深300", "沪深300"),
    ("中证500", "中证500"),
    ("中证1000", "中证1000"),
    ("上证50", "上证50"),
    ("创业板", "创业板"),
    ("科创50", "科创"),
    ("科创", "科创"),
    ("红利", "红利"),
    ("人工智能", "人工智能"),
    ("ai", "人工智能"),
    ("算力", "算力"),
    ("半导体", "半导体"),
    ("芯片", "芯片"),
    ("5g", "通信"),
    ("通信", "通信"),
    ("白酒", "白酒"),
    ("医药", "医药"),
    ("医疗", "医药"),
    ("消费", "消费"),
    ("新能源", "新能源"),
    ("光伏", "新能源"),
    ("储能", "新能源"),
    ("军工", "军工"),
    ("银行", "银行"),
    ("证券", "证券"),
    ("黄金", "黄金"),
    ("港股", "港股"),
    ("恒生", "港股"),
    ("纳斯达克", "美股"),
    ("标普", "美股"),
    ("美股", "美股"),
    ("海外", "海外"),
    ("债券", "债券"),
]
HIGH_VOLATILITY_THEMES = {
    "人工智能",
    "算力",
    "半导体",
    "芯片",
    "新能源",
    "军工",
    "港股",
    "美股",
    "海外",
    "黄金",
    "白酒",
    "通信",
    "行业主题",
}


def infer_theme(name: str, tracked_target: str = "", fund_type: str = "") -> str:
    text = f"{tracked_target} {name} {fund_type}".lower()
    for keyword, theme in THEME_ALIASES:
        if keyword in text:
            return theme
    if any(keyword in text for keyword in {"主题", "行业", "龙头", "etf"}) and "联接" not in text:
        return "行业主题"
    if "货币" in text:
        return "现金管理"
    if "债" in text:
        return "债券"
    if "指数" in text:
        return "宽基"
    return "均衡"


def infer_risk_level(fund_type: str, theme: str = "", raw_type: str = "") -> int:
    type_text = normalize_type_label(raw_type)
    if "货币" in type_text or fund_type == "货币基金":
        return 1
    if any(keyword in type_text for keyword in {"中短债", "短债", "同业存单"}):
        return 2
    if any(keyword in type_text for keyword in {"偏债", "债券混合", "混合债"}):
        return 3
    if "债券" in type_text or fund_type == "债券基金":
        if any(keyword in type_text for keyword in {"可转债", "混合二级", "混合一级"}):
            return 3
        return 2
    if any(keyword in type_text for keyword in {"reits", "reit", "fof", "养老目标"}):
        return 3
    if "qdii" in type_text:
        return 5
    if fund_type == "指数基金":
        if theme in HIGH_VOLATILITY_THEMES:
            return 5
        return 4
    if any(keyword in type_text for keyword in {"股票", "偏股", "灵活配置", "混合"}):
        if theme in HIGH_VOLATILITY_THEMES - {"行业主题"}:
            return 5
        return 4
    if fund_type == "货币基金":
        return 1
    if fund_type == "债券基金":
        return 2
    return 4


def benchmark_meta(theme: str, fund_type: str) -> dict[str, str] | None:
    if fund_type == "货币基金":
        return None
    if fund_type == "债券基金":
        return {"symbol": "sh000012", "name": "上证国债指数"}
    if theme == "沪深300":
        return {"symbol": "sh000300", "name": "沪深300"}
    if theme == "中证500":
        return {"symbol": "sh000905", "name": "中证500"}
    if theme == "中证1000":
        return {"symbol": "sh000852", "name": "中证1000"}
    if theme == "创业板":
        return {"symbol": "sz399006", "name": "创业板指"}
    if "科创" in theme:
        return {"symbol": "sh000688", "name": "科创50"}
    return {"symbol": "sh000300", "name": "沪深300"}


def infer_style_exposure(summary: dict[str, Any]) -> dict[str, float]:
    fund_type = summary["type"]
    theme = summary["theme"]
    if fund_type == "货币基金":
        return {"稳健": 0.85, "流动性": 0.15}
    if fund_type == "债券基金":
        return {"稳健": 0.7, "固收增强": 0.3}
    if theme in {"红利", "银行", "债券"}:
        return {"价值": 0.55, "成长": 0.15, "小盘": 0.1, "稳健": 0.2}
    if theme in {"人工智能", "算力", "半导体", "芯片", "新能源", "科创"}:
        return {"价值": 0.1, "成长": 0.6, "小盘": 0.2, "稳健": 0.1}
    return {"价值": 0.25, "成长": 0.45, "小盘": 0.15, "稳健": 0.15}


def latest_year_candidates() -> list[str]:
    year = datetime.now().year
    return [str(year), str(year - 1), str(year - 2)]


def normalize_summary(row: dict[str, Any], source: str) -> dict[str, Any]:
    code = safe_text(row.get("基金代码"))
    name = safe_text(row.get("基金简称") or row.get("基金名称"))
    official_type = load_fund_type_map().get(code, "")
    raw_type = normalize_type_label(official_type or row.get("类型") or row.get("跟踪方式"))
    tracked_target = safe_text(row.get("跟踪标的"))
    fund_type = infer_type(name, raw_type, source)
    theme = infer_theme(name, tracked_target, fund_type)
    benchmark = benchmark_meta(theme, fund_type)
    latest_nav = to_float(row.get("单位净值"), 1.0)
    if fund_type == "货币基金" and latest_nav <= 0:
        latest_nav = 1.0
    summary = {
        "id": normalize_id(code),
        "code": code,
        "name": name,
        "type": fund_type,
        "rawType": raw_type,
        "riskLevel": infer_risk_level(fund_type, theme, raw_type),
        "theme": theme,
        "feeRate": pct_to_ratio(row.get("手续费")),
        "latestNav": latest_nav,
        "latestDate": safe_text(row.get("日期")),
        "maxDrawdownHint": None,
        "benchmarkCode": benchmark["symbol"] if benchmark else None,
        "benchmarkName": benchmark["name"] if benchmark else None,
        "trackedTarget": tracked_target,
        "sourceCategory": source,
        "performance": {
            "day": pct_to_ratio(row.get("日增长率")),
            "week": pct_to_ratio(row.get("近1周")),
            "month": pct_to_ratio(row.get("近1月")),
            "quarter": pct_to_ratio(row.get("近3月") or row.get("近3 月")),
            "halfYear": pct_to_ratio(row.get("近6月")),
            "year": pct_to_ratio(row.get("近1年")),
        },
        "_priority": SOURCE_PRIORITY.get(source, 0),
    }
    return summary


def merge_summary(store: dict[str, dict[str, Any]], incoming: dict[str, Any]) -> None:
    code = incoming["code"]
    current = store.get(code)
    if current is None:
        store[code] = incoming
        return
    if incoming["_priority"] >= current["_priority"]:
        merged = {**current, **incoming}
    else:
        merged = {**incoming, **current}
    merged["_priority"] = max(current["_priority"], incoming["_priority"])
    if not merged.get("latestNav"):
        merged["latestNav"] = current.get("latestNav") or incoming.get("latestNav") or 1.0
    if not merged.get("latestDate"):
        merged["latestDate"] = current.get("latestDate") or incoming.get("latestDate") or ""
    store[code] = merged


def load_fund_universe() -> list[dict[str, Any]]:
    def _loader() -> list[dict[str, Any]]:
        summary_by_code: dict[str, dict[str, Any]] = {}
        sources = [
            ("catalog", load_low_medium_risk_catalog),
            ("open", ak.fund_open_fund_rank_em),
            ("money", ak.fund_money_rank_em),
            ("exchange", ak.fund_exchange_rank_em),
            ("index", lambda: ak.fund_info_index_em(symbol="全部")),
        ]
        for source_name, fetcher in sources:
            try:
                df = fetcher()
            except Exception:
                continue
            limit = SOURCE_LIMITS.get(source_name, 300)
            trimmed_df = df.head(limit).fillna("")
            for row in trimmed_df.to_dict("records"):
                code = safe_text(row.get("基金代码"))
                if not code:
                    continue
                merge_summary(summary_by_code, normalize_summary(row, source_name))
        return sorted(summary_by_code.values(), key=lambda item: (item["type"], item["name"]))

    return cached("fund_universe", 6 * 60 * 60, _loader)


def compute_max_drawdown(values: list[float]) -> float:
    peak = -math.inf
    worst = 0.0
    for value in values:
        peak = max(peak, value)
        if peak > 0:
            drawdown = value / peak - 1
            worst = min(worst, drawdown)
    return abs(worst)


def build_money_nav_series(code: str) -> list[dict[str, Any]]:
    df = ak.fund_money_fund_info_em(symbol=code)
    df = df.sort_values("净值日期")
    nav = 1.0
    series = []
    for row in df.to_dict("records"):
        gain = to_float(row.get("每万份收益"), 0.0) / 10000
        nav *= 1 + gain
        series.append({"date": safe_text(row.get("净值日期")), "nav": round(nav, 4)})
    return series


def build_open_nav_series(code: str) -> list[dict[str, Any]]:
    series: list[dict[str, Any]] = []
    indicator_candidates = [
        ("单位净值走势", "单位净值"),
        ("累计净值走势", "累计净值"),
    ]
    for indicator, value_key in indicator_candidates:
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator=indicator)
        except Exception:
            continue
        if df.empty:
            continue
        df = df.sort_values("净值日期")
        series = [
            {"date": safe_text(row.get("净值日期")), "nav": round(to_float(row.get(value_key), 1.0), 4)}
            for row in df.to_dict("records")
            if safe_text(row.get("净值日期"))
        ]
        if series:
            break
    return series


def build_exchange_nav_series(code: str) -> list[dict[str, Any]]:
    df = ak.fund_etf_fund_info_em(fund=code, start_date="20000101", end_date="20500101")
    df = df.sort_values("净值日期")
    return [
        {"date": safe_text(row.get("净值日期")), "nav": round(to_float(row.get("单位净值"), 1.0), 4)}
        for row in df.to_dict("records")
        if safe_text(row.get("净值日期"))
    ]


def get_fund_summary(code: str) -> dict[str, Any]:
    for item in load_fund_universe():
        if item["code"] == code:
            return dict(item)
    raise HTTPException(status_code=404, detail=f"基金 {code} 不存在或暂不可用")


def get_fund_detail(code: str) -> dict[str, Any]:
    def _loader() -> dict[str, Any]:
        summary = get_fund_summary(code)
        source = summary["sourceCategory"]
        try:
            if source == "money" or summary["type"] == "货币基金":
                nav_series = build_money_nav_series(code)
            elif source == "exchange":
                nav_series = build_exchange_nav_series(code)
            else:
                nav_series = build_open_nav_series(code)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"获取基金净值失败：{exc}") from exc

        if not nav_series and source != "exchange":
            try:
                nav_series = build_exchange_nav_series(code)
            except Exception:
                nav_series = nav_series
        if not nav_series and source != "open":
            try:
                nav_series = build_open_nav_series(code)
            except Exception:
                nav_series = nav_series

        max_drawdown_hint = compute_max_drawdown([item["nav"] for item in nav_series[-252:]]) if nav_series else 0.0

        industry_exposure: dict[str, float] = {}
        if summary["type"] != "货币基金":
            for year in latest_year_candidates():
                try:
                    df = ak.fund_portfolio_industry_allocation_em(symbol=code, date=year)
                except Exception:
                    continue
                if df.empty:
                    continue
                industry_exposure = {
                    safe_text(row.get("行业类别")): round(pct_to_ratio(row.get("占净值比例")), 4)
                    for row in df.to_dict("records")
                    if safe_text(row.get("行业类别"))
                }
                if industry_exposure:
                    break

        detail = {
            **summary,
            "maxDrawdownHint": round(max_drawdown_hint, 4),
            "navSeries": nav_series,
            "exposures": {
                "industry": industry_exposure,
                "style": infer_style_exposure(summary),
            },
        }
        if nav_series:
            detail["latestNav"] = nav_series[-1]["nav"]
            detail["latestDate"] = nav_series[-1]["date"]
        return detail

    return cached(f"fund_detail:{code}", 12 * 60 * 60, _loader)


def filter_funds(
    keyword: str = "",
    fund_type: str = "all",
    risk_level: str = "all",
    theme: str = "all",
) -> list[dict[str, Any]]:
    keyword_lc = keyword.strip().lower()
    results = []
    for item in load_fund_universe():
        haystack = f'{item["name"]} {item["code"]} {item["theme"]}'.lower()
        if keyword_lc and keyword_lc not in haystack:
            continue
        if fund_type != "all" and item["type"] != fund_type:
            continue
        if risk_level != "all" and item["riskLevel"] != int(risk_level):
            continue
        if theme != "all" and item["theme"] != theme:
            continue
        results.append(dict(item))
    return results


@app.get("/api/health")
def health():
    return {"code": 0, "message": "ok", "data": {"status": "ok"}}


@app.get("/api/funds")
def list_funds(
    keyword: str = "",
    type: str = Query("all"),
    riskLevel: str = Query("all"),
    theme: str = Query("all"),
    minDrawdown: float | None = Query(None),
    maxDrawdown: float | None = Query(None),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
):
    items = filter_funds(keyword=keyword, fund_type=type, risk_level=riskLevel, theme=theme)
    safe_page_size = min(pageSize, 20)
    page_items = []
    if minDrawdown is None and maxDrawdown is None:
        page_items = items[:safe_page_size]
    else:
        for item in items:
            detail = get_fund_detail(item["code"])
            drawdown = to_float(detail.get("maxDrawdownHint"), 0.0)
            if minDrawdown is not None and drawdown < minDrawdown:
                continue
            if maxDrawdown is not None and drawdown > maxDrawdown:
                continue
            page_items.append(detail)
            if len(page_items) >= safe_page_size:
                break

    result = []
    for item in page_items:
        detail = item if item.get("maxDrawdownHint") is not None else get_fund_detail(item["code"])
        result.append({key: value for key, value in detail.items() if key not in {"navSeries", "exposures", "_priority"}})

    all_items = load_fund_universe()
    meta = {
        "types": sorted({item["type"] for item in all_items}),
        "themes": sorted({item["theme"] for item in all_items}),
    }
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "list": result,
            "total": len(result),
            "page": 1,
            "pageSize": safe_page_size,
            "totalPages": 1,
            "meta": meta,
        },
    }


@app.get("/api/funds/{fund_id}")
def fund_detail(fund_id: str):
    code = extract_code(fund_id)
    detail = get_fund_detail(code)
    detail.pop("_priority", None)
    return {"code": 0, "message": "ok", "data": detail}


@app.get("/api/indexes/{symbol}/history")
def index_history(
    symbol: str,
    startDate: str | None = None,
    endDate: str | None = None,
):
    try:
        if symbol == "cbond_mixed":
            df = ak.bond_new_composite_index_cbond(indicator="净价", period="总值")
        else:
            df = ak.stock_zh_index_daily(symbol=symbol)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取指数历史失败：{exc}") from exc

    if not df.empty:
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

    if startDate:
        df = df[df["date"] >= startDate]
    if endDate:
        df = df[df["date"] <= endDate]

    series = [
        {"date": safe_text(row.get("date")), "value": round(to_float(row.get("close"), 0.0), 4)}
        for row in df.to_dict("records")
    ]
    if symbol == "cbond_mixed":
        series = [
            {"date": safe_text(row.get("date")), "value": round(to_float(row.get("value"), 0.0), 4)}
            for row in df.to_dict("records")
        ]
    return {
        "code": 0,
        "message": "ok",
        "data": {"symbol": symbol, "name": CUSTOM_INDEX_LABELS.get(symbol, symbol), "series": series},
    }


def build_assistant_context_text(context: dict[str, Any]) -> str:
    overview = context.get("overview") or {}
    holdings = context.get("holdings") or []
    rules = context.get("watchRules") or []
    attribution = context.get("attribution") or []
    portfolio_metrics = context.get("portfolioMetrics") or {}
    user = context.get("user") or {}

    lines = [
        f"用户昵称：{safe_text(user.get('username')) or '未提供'}",
        f"已购基金数：{int(to_float(overview.get('purchasedCount'), 0))}",
        f"基金持仓金额：{to_float(overview.get('holdingAmount'), 0.0):.2f} 元",
        f"昨日收益：{to_float(overview.get('yesterdayIncome'), 0.0):.2f} 元",
        f"持仓收益：{to_float(overview.get('holdingIncome'), 0.0):.2f} 元",
    ]

    if holdings:
        lines.append("当前持仓：")
        for item in holdings[:8]:
            lines.append(
                "- "
                f"{safe_text(item.get('name'))}（{safe_text(item.get('code'))}），"
                f"{safe_text(item.get('type'))}，R{int(to_float(item.get('riskLevel'), 0))}，"
                f"持仓金额 {to_float(item.get('value'), 0.0):.2f} 元，"
                f"持仓收益 {to_float(item.get('holdingIncome'), 0.0):.2f} 元，"
                f"持仓收益率 {to_float(item.get('holdingYield'), 0.0) * 100:.2f}%"
            )
    else:
        lines.append("当前无持仓。")

    if rules:
        lines.append("盯盘规则：")
        for rule in rules[:5]:
            lines.append(
                "- "
                f"{safe_text(rule.get('fundName') or rule.get('fundId'))}，"
                f"目标收益率 {to_float(rule.get('targetProfitRate'), 0.0) * 100:.2f}% ，"
                f"最大亏损率 {to_float(rule.get('maxLossRate'), 0.0) * 100:.2f}%"
            )
    else:
        lines.append("当前未设置盯盘规则。")

    if portfolio_metrics:
        lines.append(
            "组合指标："
            f"累计收益 {to_float(portfolio_metrics.get('totalReturn'), 0.0) * 100:.2f}% ，"
            f"最大回撤 {to_float(portfolio_metrics.get('maxDrawdown'), 0.0) * 100:.2f}% ，"
            f"夏普比 {to_float(portfolio_metrics.get('sharpe'), 0.0):.2f} ，"
            f"年化波动 {to_float(portfolio_metrics.get('vol'), 0.0) * 100:.2f}% 。"
        )

    if attribution:
        lines.append("收益归因：")
        for item in attribution[:8]:
            lines.append(
                "- "
                f"{safe_text(item.get('name'))}："
                f"盈亏 {to_float(item.get('pnl'), 0.0):.2f} 元，"
                f"贡献比例 {to_float(item.get('contrib'), 0.0) * 100:.2f}%"
            )

    return "\n".join(lines)


def request_chat_completion(
    question: str,
    context_text: str,
    history: list[dict[str, Any]] | None = None,
) -> tuple[str, str]:
    api_key, api_base, model = get_llm_settings()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="未配置大模型 API Key，请先设置环境变量 LLM_API_KEY；如使用 DeepSeek，可同时设置 LLM_API_BASE=https://api.deepseek.com 和 LLM_MODEL=deepseek-chat。",
        )

    endpoint = api_base if api_base.endswith("/chat/completions") else f"{api_base}/chat/completions"
    messages = [
        {
            "role": "system",
            "content": (
                "你是“基金陪伴小助手”的中文 AI 问答助手。"
                "你需要结合用户当前持仓、收益和盯盘规则回答问题，语气清晰、专业、易懂。"
                "不要编造收益或净值，无法确定时要明确说明。"
                "可以解释概念、分析风险、给出组合优化方向，但不要推荐具体基金买卖，也不要承诺收益。"
                "回答尽量结构化，控制在 2-5 段。"
            ),
        }
    ]

    for item in (history or [])[-6:]:
        role = safe_text(item.get("role"))
        content = truncate_text(item.get("content") or item.get("text"), 1500)
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})

    messages.append(
        {
            "role": "user",
            "content": f"这是用户当前的账户上下文：\n{context_text}\n\n用户问题：{question}",
        }
    )

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.5,
        "max_tokens": 900,
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"大模型服务调用失败：{truncate_text(detail, 240)}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"大模型服务调用失败：{exc}") from exc

    reply = safe_text(((result.get("choices") or [{}])[0].get("message") or {}).get("content"))
    if not reply:
        raise HTTPException(status_code=502, detail="大模型未返回有效内容，请稍后重试。")
    return reply, model


@app.post("/api/assistant/chat")
def assistant_chat(payload: dict[str, Any] = Body(default_factory=dict)):
    question = safe_text(payload.get("question"))
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    context = payload.get("context") or {}
    history = payload.get("history") or []
    context_text = build_assistant_context_text(context)
    reply, model = request_chat_completion(question=question, context_text=context_text, history=history)
    return {"code": 0, "message": "ok", "data": {"reply": reply, "model": model}}
