'use client'

import { motion } from 'framer-motion'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── GlassPanel ──────────────────────────────────────────────────────────────

export function GlassPanel({
  children,
  className,
  padding = 'p-5 sm:p-6',
}: {
  children: React.ReactNode
  className?: string
  padding?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl',
        'shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.1)]',
        'transition-shadow duration-300',
        padding,
        className,
      )}
    >
      {/* subtle inner highlight */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/40 via-transparent to-transparent" />
      {children}
    </motion.div>
  )
}

// ── KpiCard ─────────────────────────────────────────────────────────────────

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'bg-primary/10 text-primary',
  delay = 0,
}: {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  accent?: string
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3, scale: 1.01 }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl p-4 sm:p-5 shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-[0_16px_48px_rgba(0,0,0,0.12)] transition-all duration-300"
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/40 via-transparent to-transparent" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            {label}
          </span>
          <div className={cn('grid place-items-center size-8 rounded-xl', accent)}>
            <Icon className="size-4" />
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-semibold mt-2 text-foreground tracking-tight">
          {value}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </div>
    </motion.div>
  )
}

// ── QuickActionButton ───────────────────────────────────────────────────────

export function QuickActionButton({
  label,
  icon: Icon,
  onClick,
  variant = 'default',
}: {
  label: string
  icon: LucideIcon
  onClick?: () => void
  variant?: 'default' | 'secondary'
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center gap-2.5 p-4 rounded-2xl border border-white/10 backdrop-blur-xl transition-all duration-200',
        'shadow-[0_4px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]',
        variant === 'default'
          ? 'bg-primary text-primary-foreground'
          : 'bg-white/70 dark:bg-white/10 text-foreground',
      )}
    >
      <Icon className="size-5" />
      <span className="text-xs font-semibold">{label}</span>
    </motion.button>
  )
}

// ── SectionHeader ───────────────────────────────────────────────────────────

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ── EmptyState ──────────────────────────────────────────────────────────────

export function EmptyState({ message = 'Not available' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
        No data
      </div>
      <div className="text-xs text-muted-foreground/80">{message}</div>
    </div>
  )
}

// ── Skeleton card ───────────────────────────────────────────────────────────

export function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-xl p-4 sm:p-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-3 w-16 rounded bg-muted/60" />
        <div className="size-8 rounded-xl bg-muted/60" />
      </div>
      <div className="h-7 w-24 rounded bg-muted/60 mt-3" />
      <div className="h-3 w-20 rounded bg-muted/40 mt-2" />
    </div>
  )
}