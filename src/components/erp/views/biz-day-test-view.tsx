'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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
        <h1 className="text-2xl font-semibold tracking-tight">Biz-Day Test</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Phase 1 gate #12: confirm Asia/Karachi midnight boundary grouping for UTC instants near
          midnight.
        </p>
      </div>

      <Card className="bg-card border-primary/30">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base text-primary">Boundary cases</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3 text-sm">
          <p className="text-muted-foreground">{q.data?.note}</p>
          {q.data && (
            <div className="grid sm:grid-cols-3 gap-3">
              <ResultCard title="Now" r={q.data.now} />
              <ResultCard title="19:30Z (next KHI day)" r={q.data.nearMidnightNextDay} highlight />
              <ResultCard title="18:30Z (same KHI day)" r={q.data.nearMidnightSameDay} highlight />
            </div>
          )}
          <div className="text-xs text-muted-foreground pt-2 border-t border-border">
            Expected:
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>19:30Z → 00:30 next-day KHI → bizDay should be the next calendar day.</li>
              <li>18:30Z → 23:30 same-day KHI → bizDay should be the same calendar day.</li>
              <li>The two instants are only 1 hour apart in UTC but fall on different KHI business days.</li>
            </ul>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>
            Re-run test
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function ResultCard({
  title,
  r,
  highlight,
}: {
  title: string
  r: BizDayResult
  highlight?: boolean
}) {
  return (
    <div className={highlight ? 'border border-primary/40 bg-primary/5 p-3' : 'border border-border bg-background p-3'}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-1 space-y-0.5 text-xs">
        <div>
          <span className="text-muted-foreground">bizDay:</span>{' '}
          <span className="font-mono text-primary" data-num>{r.bizDay}</span>
        </div>
        <div>
          <span className="text-muted-foreground">hour in KHI:</span>{' '}
          <span data-num>{r.hourInBiz}:00</span>
        </div>
        <div>
          <span className="text-muted-foreground">UTC range start:</span>
          <br />
          <span className="font-mono text-[10px]" data-num>{new Date(r.startUtc).toISOString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground">UTC range end:</span>
          <br />
          <span className="font-mono text-[10px]" data-num>{new Date(r.endUtc).toISOString()}</span>
        </div>
      </div>
    </div>
  )
}
