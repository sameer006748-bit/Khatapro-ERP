'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Minus,
  Package,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { useRiderDashboard, type RiderDashboardData } from '@/hooks/use-rider-dashboard'
import { formatMoney, parseMoney } from '@/lib/format'
import type { MeUser } from '@/components/erp/erp-app'

type RiderSection = 'home' | 'deliveries' | 'cash'
type RiderOrder = RiderDashboardData['recentOrders'][number]
type DeliveryItem = {
  invoiceItemId: string
  productName: string
  unitPrice: string
  orderedQty: number
  deliveredQty: number
  returnedQty: number
  remainingQty: number
}
type DeliveryDetailData = { order: RiderOrder; items: DeliveryItem[] }
type Outcome = 'delivered' | 'partial' | 'returned' | null

const ACTIVE_STATUSES = new Set(['assigned', 'out_for_delivery', 'Partially Delivered', 'partially_delivered'])
const COMPLETE_STATUSES = new Set(['delivered', 'Delivered'])

function simpleStatus(status: string): 'Pending' | 'Delivered' | 'Returned' | 'Partial' {
  if (COMPLETE_STATUSES.has(status)) return 'Delivered'
  if (status === 'returned' || status === 'Returned / Failed') return 'Returned'
  if (status === 'Partially Delivered' || status === 'partially_delivered') return 'Partial'
  return 'Pending'
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error('Could not save. Please try again.')
    return body as T
  } catch (error) {
    if (error instanceof Error && error.message === 'Could not save. Please try again.') throw error
    throw new Error('Could not save. Please try again.')
  } finally {
    window.clearTimeout(timer)
  }
}

function riderPage(path: 'delivery' | 'rider-cash' | 'my-profile'): string {
  return `/?page=${path}`
}

export function RiderDashboard({
  user,
  section = 'home',
}: {
  user: MeUser
  section?: RiderSection
}) {
  const router = useRouter()
  const query = useRiderDashboard()
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const orders = query.data?.recentOrders ?? []
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null

  if (query.isLoading) return <RiderLoading />

  const notLinked = query.error instanceof Error && query.error.message === 'NotLinked'
  if (notLinked) {
    return (
      <RiderMessage
        title="Your rider account is not connected yet."
        message="Please ask the office to connect your rider account."
        onRetry={() => void query.refetch()}
      />
    )
  }

  if (query.error || !query.data?.summary) {
    return (
      <RiderMessage
        title="Could not load deliveries."
        message="Check your internet and try again."
        onRetry={() => void query.refetch()}
      />
    )
  }

  if (selectedOrder) {
    return (
      <DeliveryDetail
        order={selectedOrder}
        onBack={() => setSelectedOrderId(null)}
        onChanged={() => void query.refetch()}
      />
    )
  }

  if (section === 'deliveries') {
    return (
      <DeliveryList
        orders={orders}
        onOpen={(order) => setSelectedOrderId(order.id)}
        onRetry={() => void query.refetch()}
        refreshing={query.isFetching}
      />
    )
  }

  if (section === 'cash') {
    return <CashScreen data={query.data} />
  }

  const activeCount = orders.filter((order) => ACTIVE_STATUSES.has(order.status)).length
  const completedToday = query.data.summary.deliveredToday ?? 0
  const firstName = (query.data.riderName || user.displayName || 'Rider').trim().split(/\s+/)[0]

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="pt-1">
        <p className="text-sm text-muted-foreground">Assalam-o-Alaikum,</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{firstName}</h1>
      </header>

      <section className="rounded-3xl bg-primary p-6 text-primary-foreground shadow-lg">
        <p className="text-sm font-medium opacity-85">Today</p>
        <p className="mt-1 text-4xl font-black" data-num>{activeCount} Deliveries</p>
      </section>

      <div className="grid gap-4">
        <Button
          className="h-20 justify-between rounded-2xl px-5 text-lg font-bold shadow-md"
          onClick={() => router.push(riderPage('delivery'))}
        >
          <span className="flex items-center gap-3"><Package className="size-6" /> Start Deliveries</span>
          <ChevronRight className="size-6" />
        </Button>
        <Button
          variant="outline"
          className="h-20 justify-between rounded-2xl border-2 px-5 text-lg font-bold"
          onClick={() => router.push(riderPage('rider-cash'))}
        >
          <span className="flex items-center gap-3"><Wallet className="size-6 text-amber-600" /> Cash to Submit</span>
          <ChevronRight className="size-6" />
        </Button>
      </div>

      <button
        type="button"
        className="flex min-h-14 w-full items-center justify-between rounded-2xl bg-muted/70 px-4 text-left"
        onClick={() => router.push(riderPage('delivery'))}
      >
        <span className="flex items-center gap-3 font-medium">
          <CheckCircle2 className="size-5 text-emerald-600" />
          Completed Today
        </span>
        <span className="text-xl font-bold" data-num>{completedToday}</span>
      </button>
    </div>
  )
}

function RiderLoading() {
  return (
    <div className="mx-auto max-w-xl space-y-5" aria-label="Loading deliveries">
      <div className="h-20 animate-pulse rounded-2xl bg-muted" />
      <div className="h-32 animate-pulse rounded-3xl bg-muted" />
      <div className="h-20 animate-pulse rounded-2xl bg-muted" />
      <div className="h-20 animate-pulse rounded-2xl bg-muted" />
    </div>
  )
}

function RiderMessage({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry: () => void
}) {
  return (
    <div className="mx-auto max-w-xl rounded-3xl border bg-card p-6 text-center shadow-sm">
      <Package className="mx-auto size-12 text-muted-foreground" />
      <h1 className="mt-4 text-xl font-bold">{title}</h1>
      <p className="mt-2 text-base text-muted-foreground">{message}</p>
      <Button className="mt-6 h-14 w-full rounded-2xl text-base font-bold" onClick={onRetry}>
        <RefreshCw className="size-5" /> Try Again
      </Button>
    </div>
  )
}

function DeliveryList({
  orders,
  onOpen,
  onRetry,
  refreshing,
}: {
  orders: RiderOrder[]
  onOpen: (order: RiderOrder) => void
  onRetry: () => void
  refreshing: boolean
}) {
  const active = orders.filter((order) => ACTIVE_STATUSES.has(order.status))
  const completed = orders.filter((order) => COMPLETE_STATUSES.has(order.status))

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Deliveries</h1>
          <p className="mt-1 text-base text-muted-foreground">{active.length} jobs to do</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-12 rounded-2xl"
          aria-label="Reload deliveries"
          disabled={refreshing}
          onClick={onRetry}
        >
          <RefreshCw className={refreshing ? 'animate-spin' : ''} />
        </Button>
      </div>

      {active.length === 0 ? (
        <div className="rounded-3xl border bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
          <p className="mt-3 text-xl font-bold">No deliveries right now.</p>
          <p className="mt-1 text-muted-foreground">New work will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {active.map((order) => <DeliveryCard key={order.id} order={order} onOpen={() => onOpen(order)} />)}
        </div>
      )}

      {completed.length > 0 && (
        <section className="rounded-2xl bg-muted/60 p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">Completed</span>
            <span className="text-lg font-bold" data-num>{completed.length}</span>
          </div>
        </section>
      )}
    </div>
  )
}

function DeliveryCard({ order, onOpen }: { order: RiderOrder; onOpen: () => void }) {
  const address = [order.customerAddress, order.customerCity].filter(Boolean).join(', ')
  const amount = BigInt(order.totalCodAmount) - BigInt(order.codCollectedAmount)

  return (
    <article className="overflow-hidden rounded-3xl border-2 bg-card shadow-sm">
      <div className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">{order.customerName || 'Customer'}</h2>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{address || 'Address not added'}</p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-bold">
            {simpleStatus(order.status)}
          </span>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Amount to Collect</p>
          <p className="text-3xl font-black text-amber-700" data-num>{formatMoney(amount)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {order.customerPhone ? (
            <Button asChild variant="outline" className="h-12 rounded-xl text-base">
              <a href={`tel:${order.customerPhone}`}><Phone className="size-5" /> Call</a>
            </Button>
          ) : <span />}
          {address && (
            <Button asChild variant="outline" className="h-12 rounded-xl text-base">
              <a href={`https://maps.google.com/?q=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">
                <MapPin className="size-5" /> Map
              </a>
            </Button>
          )}
        </div>
      </div>
      <Button className="h-16 w-full rounded-none text-lg font-bold" onClick={onOpen}>
        Open Delivery <ChevronRight className="size-6" />
      </Button>
    </article>
  )
}

function DeliveryDetail({
  order,
  onBack,
  onChanged,
}: {
  order: RiderOrder
  onBack: () => void
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const detail = useQuery<DeliveryDetailData>({
    queryKey: ['rider-delivery', order.id],
    queryFn: () => apiJson<DeliveryDetailData>(`/api/delivery-orders/${order.id}`),
  })
  const start = useMutation({
    mutationFn: () => apiJson(`/api/delivery-orders/${order.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newStatus: 'out_for_delivery' }),
    }),
    onSuccess: () => {
      toast.success('Delivery started')
      void queryClient.invalidateQueries({ queryKey: ['rider-dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['rider-delivery', order.id] })
      onChanged()
    },
    onError: () => toast.error('Could not save. Please try again.'),
  })

  if (detail.isLoading) return <RiderLoading />
  if (detail.error || !detail.data) {
    return <RiderMessage title="Could not load delivery." message="Please try again." onRetry={() => void detail.refetch()} />
  }

  const current = detail.data.order
  const address = [current.customerAddress, current.customerCity].filter(Boolean).join(', ')
  const amount = BigInt(current.totalCodAmount) - BigInt(current.codCollectedAmount)
  const readyForResult = current.status === 'out_for_delivery'
    || current.status === 'Partially Delivered'
    || current.status === 'partially_delivered'

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Button variant="ghost" className="h-12 rounded-xl px-2 text-base" onClick={onBack}>
        <ArrowLeft className="size-5" /> Back
      </Button>

      <section className="space-y-5 rounded-3xl border-2 bg-card p-5 shadow-sm">
        <div>
          <p className="text-sm text-muted-foreground">Customer</p>
          <h1 className="text-2xl font-black">{current.customerName || 'Customer'}</h1>
        </div>
        {current.customerPhone && (
          <a className="flex min-h-12 items-center gap-3 text-lg font-semibold text-primary" href={`tel:${current.customerPhone}`}>
            <Phone className="size-5" /> {current.customerPhone}
          </a>
        )}
        <div>
          <p className="text-sm text-muted-foreground">Address</p>
          <p className="mt-1 text-lg font-semibold leading-snug">{address || 'Address not added'}</p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-4 text-amber-950">
          <p className="text-sm font-medium">Amount to Collect</p>
          <p className="text-4xl font-black" data-num>{formatMoney(amount)}</p>
        </div>
        {detail.data.items.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold">Items</p>
            <div className="space-y-2">
              {detail.data.items.map((item) => (
                <div key={item.invoiceItemId} className="flex min-h-12 items-center justify-between rounded-xl bg-muted/60 px-3">
                  <span className="min-w-0 truncate font-medium">{item.productName}</span>
                  <span className="ml-3 shrink-0 font-bold" data-num>Qty {item.remainingQty}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {current.deliveryNote && (
          <div className="rounded-2xl bg-sky-50 p-4 text-sky-950">
            <p className="text-sm font-bold">Special Note</p>
            <p className="mt-1">{current.deliveryNote}</p>
          </div>
        )}
      </section>

      {current.status === 'assigned' && (
        <Button
          className="h-16 w-full rounded-2xl text-xl font-black"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          {start.isPending ? 'Starting...' : 'START DELIVERY'}
        </Button>
      )}

      {readyForResult && (
        <div className="grid gap-4">
          <Button className="h-16 rounded-2xl bg-emerald-600 text-xl font-black hover:bg-emerald-700" onClick={() => setOutcome('delivered')}>
            <Check className="size-6" /> DELIVERED
          </Button>
          <Button variant="outline" className="h-16 rounded-2xl border-2 border-amber-500 text-xl font-black text-amber-800" onClick={() => setOutcome('partial')}>
            <Package className="size-6" /> PARTIAL
          </Button>
          <Button variant="outline" className="h-16 rounded-2xl border-2 border-rose-500 text-xl font-black text-rose-700" onClick={() => setOutcome('returned')}>
            <RotateCcw className="size-6" /> RETURNED
          </Button>
        </div>
      )}

      {outcome && (
        <OutcomeDrawer
          kind={outcome}
          order={current}
          items={detail.data.items}
          onClose={() => setOutcome(null)}
          onSuccess={() => {
            setOutcome(null)
            onBack()
            void queryClient.invalidateQueries({ queryKey: ['rider-dashboard'] })
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function OutcomeDrawer({
  kind,
  order,
  items,
  onClose,
  onSuccess,
}: {
  kind: Exclude<Outcome, null>
  order: RiderOrder
  items: DeliveryItem[]
  onClose: () => void
  onSuccess: () => void
}) {
  const expectedCash = formatMoney(BigInt(order.totalCodAmount) - BigInt(order.codCollectedAmount), false)
  const [cash, setCash] = useState(expectedCash)
  const [reason, setReason] = useState('Customer refused')
  const [otherReason, setOtherReason] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [kind, order.id])

  const save = useMutation({
    mutationFn: async () => {
      if (kind === 'returned') {
        return apiJson(`/api/delivery-orders/${order.id}/returned`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            returnReason: reason === 'Other' ? otherReason : reason,
            idempotencyKey,
          }),
        })
      }

      const partialItems = kind === 'partial'
        ? items.filter((item) => item.remainingQty > 0).map((item) => {
          const deliveredQty = quantities[item.invoiceItemId] ?? 0
          return {
            invoiceItemId: item.invoiceItemId,
            deliveredQty,
            returnedQty: item.remainingQty - deliveredQty,
          }
        })
        : undefined

      return apiJson(`/api/delivery-orders/${order.id}/delivered`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          collectedAmount: cash,
          items: partialItems,
          idempotencyKey,
        }),
      })
    },
    onSuccess: () => {
      toast.success(
        kind === 'partial'
          ? 'Partial delivery saved'
          : kind === 'returned'
            ? 'Return recorded'
            : 'Delivery completed',
      )
      onSuccess()
    },
    onError: () => toast.error('Could not save. Please try again.'),
  })

  const deliveredUnits = Object.values(quantities).reduce((sum, qty) => sum + qty, 0)
  const reasonReady = reason !== 'Other' || otherReason.trim().length > 0
  const cashReady = parseMoney(cash) !== null
  const canSave = kind === 'returned' ? reasonReady : kind === 'partial' ? deliveredUnits > 0 && cashReady : cashReady

  return (
    <Drawer open={kind !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DrawerContent className="max-h-[92dvh]">
        <div className="mx-auto w-full max-w-xl overflow-y-auto">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-2xl">
              {kind === 'partial' ? 'Partial Delivery' : kind === 'returned' ? 'Return Delivery' : 'Confirm Delivered'}
            </DrawerTitle>
            <DrawerDescription className="text-base">
              {order.customerName || 'Customer'}
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-5 px-4">
            {kind === 'partial' && items.filter((item) => item.remainingQty > 0).map((item) => {
              const value = quantities[item.invoiceItemId] ?? 0
              return (
                <div key={item.invoiceItemId} className="rounded-2xl border p-4">
                  <p className="text-lg font-bold">{item.productName}</p>
                  <p className="text-sm text-muted-foreground">Ordered: <span data-num>{item.remainingQty}</span></p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-bold">Delivered</span>
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="size-12 rounded-full p-0"
                        aria-label={`Remove one ${item.productName}`}
                        onClick={() => setQuantities((current) => ({ ...current, [item.invoiceItemId]: Math.max(value - 1, 0) }))}
                      >
                        <Minus className="size-5" />
                      </Button>
                      <span className="w-8 text-center text-2xl font-black" data-num>{value}</span>
                      <Button
                        type="button"
                        variant="outline"
                        className="size-12 rounded-full p-0"
                        aria-label={`Add one ${item.productName}`}
                        onClick={() => setQuantities((current) => ({ ...current, [item.invoiceItemId]: Math.min(value + 1, item.remainingQty) }))}
                      >
                        <Plus className="size-5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}

            {kind !== 'returned' && (
              <label className="block">
                <span className="text-base font-bold">Cash received</span>
                <div className="relative mt-2">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold">Rs</span>
                  <Input
                    inputMode="decimal"
                    value={cash}
                    onChange={(event) => setCash(event.target.value)}
                    className="h-16 rounded-2xl pl-12 text-2xl font-black"
                    aria-label="Cash received"
                    data-num
                  />
                </div>
              </label>
            )}

            {kind === 'returned' && (
              <fieldset>
                <legend className="text-base font-bold">Reason</legend>
                <div className="mt-3 grid gap-3">
                  {['Customer refused', 'Customer unavailable', 'Wrong item', 'Other'].map((choice) => (
                    <button
                      type="button"
                      key={choice}
                      className={`min-h-14 rounded-2xl border-2 px-4 text-left text-base font-semibold ${reason === choice ? 'border-primary bg-primary/10' : 'border-border'}`}
                      onClick={() => setReason(choice)}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
                {reason === 'Other' && (
                  <Input
                    value={otherReason}
                    onChange={(event) => setOtherReason(event.target.value)}
                    className="mt-3 h-14 rounded-2xl"
                    placeholder="Write reason"
                    maxLength={200}
                  />
                )}
              </fieldset>
            )}
          </div>

          <DrawerFooter className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button
              className={`h-16 rounded-2xl text-lg font-black ${kind === 'returned' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
              disabled={!canSave || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? 'Saving...'
                : kind === 'partial'
                  ? 'Confirm Partial'
                  : kind === 'returned'
                    ? 'Confirm Return'
                    : 'Confirm Delivered'}
            </Button>
            <Button variant="ghost" className="h-12 rounded-xl" onClick={onClose}>Cancel</Button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function CashScreen({ data }: { data: RiderDashboardData }) {
  if (data.cashAvailable === false) {
    return (
      <RiderMessage
        title="Could not load cash."
        message="Please try again from the Cash button."
        onRetry={() => window.location.reload()}
      />
    )
  }
  const cash = BigInt(data.cash?.outstandingCod ?? '0')
  const delivered = data.cash?.invoiceCount
    ?? data.recentOrders.filter((order) => COMPLETE_STATUSES.has(order.status)).length

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Cash</h1>
        <p className="mt-1 text-base text-muted-foreground">Money collected from customers</p>
      </header>
      <section className="rounded-3xl bg-amber-50 p-6 text-amber-950 shadow-sm">
        <p className="text-sm font-black tracking-wide">CASH WITH YOU</p>
        <p className="mt-2 text-5xl font-black" data-num>{formatMoney(cash)}</p>
      </section>
      <div className="flex min-h-16 items-center justify-between rounded-2xl border-2 bg-card px-5">
        <span className="text-base font-semibold">Delivered orders</span>
        <span className="text-2xl font-black" data-num>{delivered}</span>
      </div>
      <div className="rounded-2xl bg-muted/70 p-4 text-center text-base">
        Cash to submit: <strong data-num>{formatMoney(cash)}</strong>
        <p className="mt-1 text-sm text-muted-foreground">Please submit this cash at the office.</p>
      </div>
    </div>
  )
}
