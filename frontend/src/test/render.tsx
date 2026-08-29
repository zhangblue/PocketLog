import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const roots = new Set<Root>()

export async function settle() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  })
}

export async function cleanupRenderedRoots() {
  const mountedRoots = [...roots]
  roots.clear()
  await act(async () => {
    mountedRoots.forEach(root => root.unmount())
  })
}

export async function render(ui: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.add(root)
  await act(async () => {
    root.render(ui)
    // FinanceApi effects are asynchronous even for an in-memory fixture.
    // Drain the bootstrap/request chain so page tests observe a settled panel.
    await Promise.resolve()
    await Promise.resolve()
  })
  return {
    container,
    unmount: async () => {
      roots.delete(root)
      await act(async () => root.unmount())
    },
  }
}

export async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  })
}

export async function changeInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error('HTMLInputElement.value setter 不可用')
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

export async function changeSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  if (!setter) throw new Error('HTMLSelectElement.value setter 不可用')
  await act(async () => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

export async function keyDown(element: HTMLElement, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}
