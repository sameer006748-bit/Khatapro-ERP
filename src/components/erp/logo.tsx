'use client'

import { cn } from '@/lib/utils'

/**
 * KhataPro ERP wordmark + logomark.
 *
 * The logomark is a rounded emerald square with a stylized "K" cut from
 * negative space (using a soft inner shadow + gradient), giving it a
 * subtle 3D depth without being toy-like.
 */
export function KhataProLogo({
  size = 'md',
  showWordmark = true,
  className,
}: {
  size?: 'sm' | 'md' | 'lg'
  showWordmark?: boolean
  className?: string
}) {
  const box = size === 'sm' ? 'size-7' : size === 'lg' ? 'size-10' : 'size-8'
  const text = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-xl' : 'text-lg'
  const sub = size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-[11px]' : 'text-[10px]'

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Logomark className={box} />
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span className={cn('font-semibold tracking-tight text-foreground', text)}>
            KhataPro <span className="text-primary">ERP</span>
          </span>
          <span className={cn('text-muted-foreground tracking-wide uppercase mt-0.5', sub)}>
            Accounting-first
          </span>
        </div>
      )}
    </div>
  )
}

export function Logomark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative grid place-items-center icon-3d overflow-hidden',
        className,
      )}
      style={{ borderRadius: '30%' }}
      aria-hidden
    >
      {/* Stylized "K" built from two rounded bars. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="size-[58%] relative z-10"
        aria-hidden
      >
        <path
          d="M6 5.5v13"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M6 12l7-6.5M6 12l7 6.5"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* Top inner highlight for 3D feel. */}
      <div
        className="absolute inset-x-0 top-0 h-1/2"
        style={{
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.35), transparent)',
          borderRadius: '30% 30% 0 0',
        }}
      />
    </div>
  )
}
