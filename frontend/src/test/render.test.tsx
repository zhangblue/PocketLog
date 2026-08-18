import { act, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FinanceProvider, useFinance } from '../app/FinanceProvider'
import { sampleTransactions } from '../domain/sampleData'
import { cleanupRenderedRoots, click, render } from './render'

function DeleteProbe() {
  const { actions, state } = useFinance()
  const [deletions, setDeletions] = useState(0)

  return (
    <>
      <output data-testid="deletions">{deletions}</output>
      <output data-testid="deleted">{state.deletedTransaction?.id ?? ''}</output>
      <button type="button" onClick={() => {
        actions.deleteTransaction(sampleTransactions[0])
        setDeletions(current => current + 1)
      }}>删除</button>
    </>
  )
}

describe('render', () => {
  it('集中卸载 Provider root 后推进撤销计时器不会产生 React 更新警告', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const clearTimeout = vi.spyOn(window, 'clearTimeout')
    try {
      const { container } = await render(<FinanceProvider><DeleteProbe /></FinanceProvider>)

      await click(container.querySelector('button')!)
      await cleanupRenderedRoots()
      await act(async () => vi.advanceTimersByTime(5000))

      expect(container.textContent).toBe('')
      expect(clearTimeout).toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      clearTimeout.mockRestore()
      consoleError.mockRestore()
    }
  })
})
