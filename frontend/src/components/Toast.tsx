import type { ReactNode } from 'react'

interface ToastProps {
  open: boolean
  children: ReactNode
}

export function Toast({ open, children }: ToastProps) {
  if (!open) return null

  return <div className="toast" role="status">{children}</div>
}
