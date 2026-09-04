import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  description: string
  actions?: ReactNode
  compact?: boolean
}

/**
 * The standard frame for client-facing ERP pages. Keeping the title, guidance
 * and primary action together makes frequent workflows easier to scan on both
 * desktop and mobile.
 */
export function PageHeader({ title, description, actions, compact = false }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
      <div className="min-w-0">
        <h1 className={`${compact ? 'text-xl' : 'text-2xl sm:text-3xl'} font-semibold tracking-tight text-foreground`}>
          {title}
        </h1>
        <p className={`${compact ? 'text-xs mt-0.5' : 'text-sm mt-1.5'} max-w-2xl text-muted-foreground`}>
          {description}
        </p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
