'use client'

import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { CalendarClock, Sunrise, Sunset, Clock } from 'lucide-react'

type BizDayResult = {
  bizDay: string
  startUtc: string
  endUtc: string
  hourInBiz: number
}

type ApiResponse = {
  now: BizDayResult
  nearMidnightNextDay: BizDayResult
  nearMidnightSameDay: BizDayResult
  note: string
}

export function BizDayTestView() {
  const q = useQuery<ApiResponse>({
    queryKey: ['biz-day-test'],
    queryFn: () => fetch('/api/test-biz-day').then((r) => r.json()),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Biz-Day Test
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Phase 1 gate #12: confirm Asia/Karachi midnight boundary grouping for UTC instants near
          midnight.
        </p>
      </div>

      <div className="card-3d border-primary/30 p-5 sm:p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid place-items-center size-9 rounded-xl icon-3d">
            <CalendarClock className="size-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-primary">Boundary cases</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Asia/Karachi is UTC+5 · no DST
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-4">{q.data?.note}</p>

        {q.data && (
          <div className="grid sm:grid-cols-3 gap-3">
            <ResultCard
              title="Now"
              icon={Clock}
              r={q.data.now}
            />
            <ResultCard
              title="19:30Z → 00:30+1 KHI"
              icon={Sunrise}
              r={q.data.nearMidnightNextDay}
              highlight
            />
            <ResultCard
              title="18:30Z → 23:30 KHI"
              icon={Sunset}
              r={q.data.nearMidnightSameDay}
              highlight
            />
          </div>
        )}

        <div className="mt-5 pt-5 border-t border-border">
          <div className="text-xs text-muted-foreground font-medium mb-2">Expected:</div>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
              <span>
                <strong className="text-foreground">19:30Z</strong> → 00:30 next-day KHI → bizDay
                should be the next calendar day.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
              <span>
                <strong className="text-foreground">18:30Z</strong> → 23:30 same-day KHI → bizDay
                should be the same calendar day.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
              <span>
                The two instants are only <strong className="text-foreground">1 hour apart</strong>{' '}
                in UTC but fall on different KHI business days.
              </span>
            </li>
          </ul>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-4 press-sm"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          {q.isFetching ? 'Re-running…' : 'Re-run test'}
        </Button>
      </div>
    </div>
  )
}

function ResultCard({
  title,
  icon: Icon,
  r,
  highlight,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  r: BizDayResult
  highlight?: boolean
}) {
  return (
    <div
      className={
        highlight
          ? 'border border-primary/30 bg-accent/40 p-4 rounded-xl'
          : 'border border-border bg-background p-4 rounded-xl'
      }
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`grid place-items-center size-7 rounded-lg ${
            highlight ? 'icon-3d' : 'icon-3d-muted'
          }`}
        >
          <Icon className={`size-3.5 ${highlight ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {title}
        </div>
      </div>
      <div className="space-y-1.5 text-xs">
        <div>
          <span className="text-muted-foreground">bizDay:</span>{' '}
          <span className="font-mono text-primary font-semibold" data-num>
            {r.bizDay}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">hour in KHI:</span>{' '}
          <span className="font-mono text-foreground" data-num>
            {String(r.hourInBiz).padStart(2, '0')}:00
          </span>
        </div>
        <div className="pt-2 border-t border-border/60">
          <span className="text-muted-foreground">UTC range:</span>
          <div className="font-mono text-[10px] text-foreground/70 mt-1" data-num>
            {new Date(r.startUtc).toISOString()}
          </div>
          <div className="font-mono text-[10px] text-foreground/70" data-num>
            {new Date(r.endUtc).toISOString()}
          </div>
        </div>
      </div>
    </div>
  )
}
