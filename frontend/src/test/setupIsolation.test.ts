import { describe, expect, it, vi } from 'vitest'

describe('全局测试清理', () => {
  it('故意污染滚动、全局和环境', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 160 })
    vi.stubGlobal('print', undefined)
    vi.stubEnv('QIZHANG_ISOLATION', 'dirty')
    localStorage.setItem('dirty', 'value')
  })

  it('下一条测试从干净的全局环境开始', () => {
    expect(window.scrollY).toBe(0)
    expect(vi.isMockFunction(window.scrollTo)).toBe(true)
    expect(window.print).not.toBeUndefined()
    expect(process.env.QIZHANG_ISOLATION).toBeUndefined()
    expect(localStorage.getItem('dirty')).toBeNull()
  })
})
