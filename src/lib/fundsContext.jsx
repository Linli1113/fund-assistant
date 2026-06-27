import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchFundDetail, fetchIndexHistory, searchFunds } from './fundApi'

const FundsContext = createContext(null)

const upsertFunds = (prev, nextList) => {
  const map = new Map(prev.map((item) => [item.id, item]))
  for (const item of nextList) {
    if (!item?.id) continue
    map.set(item.id, { ...map.get(item.id), ...item })
  }
  return Array.from(map.values())
}

export function FundsProvider({ children }) {
  const [funds, setFunds] = useState([])
  const [fundDetails, setFundDetails] = useState({})
  const [meta, setMeta] = useState({ types: [], themes: [] })
  const [resultMeta, setResultMeta] = useState({ total: 0, page: 1, pageSize: 20, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const detailPromises = useRef(new Map())
  const indexCache = useRef(new Map())

  const runSearch = useCallback(async (filters = {}) => {
    setSearching(true)
    setError('')
    try {
      const data = await searchFunds(filters)
      setFunds(data.list || [])
      setMeta(data.meta || { types: [], themes: [] })
      setResultMeta({
        total: data.total || 0,
        page: data.page || 1,
        pageSize: data.pageSize || 20,
        totalPages: data.totalPages || 0,
      })
      setFundDetails((prev) => {
        const next = { ...prev }
        for (const item of data.list || []) next[item.id] = { ...next[item.id], ...item }
        return next
      })
      return data
    } catch (err) {
      setError(err.message || '加载基金列表失败')
      return []
    } finally {
      setSearching(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    runSearch()
  }, [runSearch])

  const ensureFundDetails = useCallback(
    async (fundIds) => {
      const ids = Array.from(new Set((fundIds || []).filter(Boolean)))
      const pending = ids
        .filter((id) => !fundDetails[id]?.navSeries?.length)
        .map((id) => {
          if (detailPromises.current.has(id)) return detailPromises.current.get(id)
          const promise = fetchFundDetail(id)
            .then((detail) => {
              setFundDetails((prev) => ({ ...prev, [id]: detail }))
              setFunds((prev) => upsertFunds(prev, [detail]))
              detailPromises.current.delete(id)
              return detail
            })
            .catch((err) => {
              detailPromises.current.delete(id)
              throw err
            })
          detailPromises.current.set(id, promise)
          return promise
        })
      return Promise.all(pending)
    },
    [fundDetails],
  )

  const getFundById = useCallback(
    (id) => {
      if (!id) return null
      return fundDetails[id] || funds.find((item) => item.id === id) || null
    },
    [fundDetails, funds],
  )

  const loadIndexSeries = useCallback(async (symbol, startDate, endDate) => {
    if (!symbol) return []
    const key = `${symbol}:${startDate || ''}:${endDate || ''}`
    if (indexCache.current.has(key)) return indexCache.current.get(key)
    const data = await fetchIndexHistory(symbol, startDate, endDate)
    const series = data.series || []
    indexCache.current.set(key, series)
    return series
  }, [])

  const value = useMemo(
    () => ({
      funds,
      fundDetails,
      meta,
      loading,
      searching,
      error,
      resultMeta,
      runSearch,
      ensureFundDetails,
      getFundById,
      loadIndexSeries,
    }),
    [ensureFundDetails, error, fundDetails, funds, getFundById, loadIndexSeries, loading, meta, resultMeta, runSearch, searching],
  )

  return <FundsContext.Provider value={value}>{children}</FundsContext.Provider>
}

export const useFunds = () => {
  const value = useContext(FundsContext)
  if (!value) throw new Error('useFunds 必须在 FundsProvider 中使用')
  return value
}
