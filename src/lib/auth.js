import { LS_KEYS } from './keys'
import { readJson, writeJson, uid } from './storage'

export const validatePassword = (password) => {
  if (typeof password !== 'string') return '密码格式不正确'
  if (password.length < 8 || password.length > 12) return '密码需为 8-12 位'
  const hasLetter = /[A-Za-z]/.test(password)
  const hasDigit = /\d/.test(password)
  const onlyAllowed = /^[A-Za-z\d]+$/.test(password)
  if (!hasLetter || !hasDigit) return '密码需同时包含英文与数字'
  if (!onlyAllowed) return '密码仅支持英文与数字'
  return null
}

export const normalizePhone = (phone) => String(phone || '').replace(/\s+/g, '')

export const isValidPhone = (phone) => /^1\d{10}$/.test(normalizePhone(phone))

export const getUsers = () => readJson(LS_KEYS.users, [])

export const setUsers = (users) => writeJson(LS_KEYS.users, users)

export const findUserByUsername = (username) => {
  const u = String(username || '').trim()
  if (!u) return null
  return getUsers().find((x) => x.username === u) || null
}

export const findUserByPhone = (phone) => {
  const p = normalizePhone(phone)
  if (!p) return null
  return getUsers().find((x) => x.phone === p) || null
}

export const createUser = ({ username, phone, password, provider }) => {
  const users = getUsers()
  const u = String(username || '').trim()
  const p = normalizePhone(phone)
  const next = {
    id: uid('user'),
    username: u || `用户${Math.random().toString(10).slice(2, 6)}`,
    phone: p || null,
    password: password || null,
    provider: provider || 'account',
    createdAt: new Date().toLocaleString(),
  }
  users.push(next)
  setUsers(users)
  return next
}

export const ensurePhoneUser = (phone) => {
  const p = normalizePhone(phone)
  const found = findUserByPhone(p)
  if (found) return found
  return createUser({ username: `手机用户${p.slice(-4)}`, phone: p, provider: 'phone' })
}

export const createWeChatUser = () => {
  const users = getUsers()
  const suffix = Math.random().toString(16).slice(2, 6)
  const next = {
    id: uid('wx'),
    username: `微信用户${suffix}`,
    phone: null,
    password: null,
    provider: 'wechat',
    createdAt: new Date().toLocaleString(),
  }
  users.push(next)
  setUsers(users)
  return next
}

export const updateUserProfile = (userId, patch) => {
  if (!userId) return null
  const users = getUsers()
  let updatedUser = null
  const nextUsers = users.map((user) => {
    if (user.id !== userId) return user
    updatedUser = { ...user, ...patch }
    return updatedUser
  })
  if (!updatedUser) return null
  setUsers(nextUsers)
  setCurrentUser(updatedUser)
  return updatedUser
}

export const setCurrentUser = (user) => writeJson(LS_KEYS.currentUser, user)
export const getCurrentUser = () => readJson(LS_KEYS.currentUser, null)
