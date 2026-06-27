import { useEffect, useState } from 'react'
import { readJson, writeJson } from './storage'

export const useLocalStorageState = (key, initialValue) => {
  const [state, setState] = useState(() => readJson(key, initialValue))

  useEffect(() => {
    writeJson(key, state)
  }, [key, state])

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== key) return
      setState(readJson(key, initialValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [initialValue, key])

  return [state, setState]
}

