import { afterEach, vi } from 'vitest'
import { cleanupRenderedRoots } from './render'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const values = new Map<string, string>()
const memoryStorage: Storage = {
  get length() {
    return values.size
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => values.delete(key),
  setItem: (key, value) => values.set(key, String(value)),
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: memoryStorage,
})

function resetScrollEnvironment() {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() })
}

resetScrollEnvironment()

afterEach(async () => {
  await cleanupRenderedRoots()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  resetScrollEnvironment()
  document.body.replaceChildren()
  localStorage.clear()
})
