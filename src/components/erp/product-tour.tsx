'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, Compass, Sparkles } from 'lucide-react'
import type { MeUser } from '@/components/erp/erp-app'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  PRODUCT_TOUR_RESTART_EVENT,
  buildProductTour,
  readOnboardingState,
  resetOnboardingState,
  writeOnboardingState,
  type TourStep,
} from '@/lib/onboarding/product-tour'

type SpotlightRect = {
  left: number
  top: number
  width: number
  height: number
}

function findVisibleTarget(selector: string): HTMLElement | null {
  const matches = Array.from(document.querySelectorAll<HTMLElement>(selector))
  return matches.find((element) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  }) ?? null
}

function useSpotlight(selector: string | undefined, active: boolean): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null)

  useEffect(() => {
    if (!active || !selector) {
      return
    }

    let frame = 0
    let observedTarget: HTMLElement | null = null
    const resizeObserver = new ResizeObserver(() => update())
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const target = findVisibleTarget(selector)
        if (!target) {
          setRect(null)
          return
        }
        if (target !== observedTarget) {
          resizeObserver.disconnect()
          resizeObserver.observe(target)
          observedTarget = target
        }
        const next = target.getBoundingClientRect()
        const padding = 6
        const nextRect = {
          left: Math.max(8, next.left - padding),
          top: Math.max(8, next.top - padding),
          width: Math.min(window.innerWidth - 16, next.width + padding * 2),
          height: Math.min(window.innerHeight - 16, next.height + padding * 2),
        }
        setRect((current) => current
          && current.left === nextRect.left
          && current.top === nextRect.top
          && current.width === nextRect.width
          && current.height === nextRect.height
          ? current
          : nextRect)
      })
    }

    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    const settleTimers = [window.setTimeout(update, 120), window.setTimeout(update, 320)]
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      resizeObserver.disconnect()
      settleTimers.forEach((timer) => window.clearTimeout(timer))
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [active, selector])

  return rect
}

export function ProductTourGuide({
  user,
  visiblePageKeys,
  onNavigate,
  onStepChange,
}: {
  user: MeUser
  visiblePageKeys: string[]
  onNavigate: (pageKey: string) => void
  onStepChange?: (step: TourStep | null) => void
}) {
  const tour = useMemo(
    () => buildProductTour(user.roleName, visiblePageKeys),
    [user.roleName, visiblePageKeys],
  )
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const step = tour?.steps[stepIndex]
  const spotlight = useSpotlight(step?.target, tourOpen)

  useEffect(() => {
    if (!tour) return
    const frame = requestAnimationFrame(() => {
      const existing = readOnboardingState(window.localStorage, user.id)
      if (!existing || existing.role !== tour.role) setWelcomeOpen(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [tour, user.id])

  useEffect(() => {
    const restart = () => {
      if (!tour) return
      resetOnboardingState(window.localStorage, user.id)
      onNavigate('home')
      setWelcomeOpen(false)
      setStepIndex(0)
      setTourOpen(true)
    }
    window.addEventListener(PRODUCT_TOUR_RESTART_EVENT, restart)
    return () => window.removeEventListener(PRODUCT_TOUR_RESTART_EVENT, restart)
  }, [onNavigate, tour, user.id])

  useEffect(() => {
    onStepChange?.(tourOpen && step ? step : null)
  }, [onStepChange, step, tourOpen])

  if (!tour || tour.steps.length === 0 || !step) return null

  const isLast = stepIndex === tour.steps.length - 1

  function save(status: 'completed' | 'dismissed') {
    writeOnboardingState(window.localStorage, user.id, tour!.role, status)
  }

  function dismissWelcome() {
    save('dismissed')
    setWelcomeOpen(false)
  }

  function startTour() {
    setWelcomeOpen(false)
    setStepIndex(0)
    onNavigate('home')
    setTourOpen(true)
  }

  function skipTour() {
    save('dismissed')
    setTourOpen(false)
  }

  function finish(destination: string) {
    save('completed')
    setTourOpen(false)
    onNavigate(destination)
  }

  return (
    <>
      {tourOpen && spotlight && createPortal(
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[55] rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background shadow-[0_0_0_9999px_rgba(15,23,42,0.48)]"
          style={spotlight}
        />,
        document.body,
      )}

      <Dialog
        open={welcomeOpen}
        onOpenChange={(open) => {
          if (!open && welcomeOpen) dismissWelcome()
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader className="items-center text-center sm:text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary/[0.12] text-primary">
              <Sparkles className="size-6" strokeWidth={1.9} />
            </span>
            <DialogTitle className="text-xl">Welcome to KhataPro</DialogTitle>
            <DialogDescription className="leading-6">
              Here&apos;s a quick guide to the areas you&apos;ll use most as {tour.role === 'Owner/Admin' ? 'an Owner/Admin' : `a ${tour.role}`}.
            </DialogDescription>
          </DialogHeader>
          <p className="text-center text-xs text-muted-foreground">
            You can restart this guide anytime from My Profile.
          </p>
          <DialogFooter className="sm:justify-center">
            <Button type="button" variant="ghost" className="min-h-11" onClick={dismissWelcome}>
              Skip for now
            </Button>
            <Button type="button" className="min-h-11" onClick={startTour}>
              <Compass className="size-4" strokeWidth={1.9} /> Start Tour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tourOpen}
        onOpenChange={(open) => {
          if (!open && tourOpen) skipTour()
        }}
      >
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-transparent"
          className="z-[60] sm:top-auto sm:left-auto sm:right-6 sm:bottom-6 sm:translate-x-0 sm:translate-y-0 sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto border-primary/20 shadow-2xl"
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary" aria-live="polite">
                {stepIndex + 1} of {tour.steps.length}
              </span>
              <Button type="button" variant="ghost" size="sm" className="min-h-10 px-3 text-xs" onClick={skipTour}>
                Skip
              </Button>
            </div>
            <DialogTitle className="text-xl">{step.title}</DialogTitle>
            <DialogDescription className="leading-6">{step.body}</DialogDescription>
          </DialogHeader>

          <div className="flex gap-1.5" aria-hidden="true">
            {tour.steps.map((item, index) => (
              <span
                key={item.id}
                className={index <= stepIndex ? 'h-1.5 flex-1 rounded-full bg-primary' : 'h-1.5 flex-1 rounded-full bg-muted'}
              />
            ))}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
            >
              <ArrowLeft className="size-4" strokeWidth={1.9} /> Back
            </Button>
            {isLast ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {tour.finishPageKey !== 'home' && (
                  <Button type="button" variant="ghost" className="min-h-11" onClick={() => finish('home')}>
                    Stay on Home
                  </Button>
                )}
                <Button type="button" className="min-h-11" onClick={() => finish(tour.finishPageKey)}>
                  <Check className="size-4" strokeWidth={1.9} /> {tour.finishLabel}
                </Button>
              </div>
            ) : (
              <Button type="button" className="min-h-11" onClick={() => setStepIndex((index) => index + 1)}>
                Next <ArrowRight className="size-4" strokeWidth={1.9} />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
