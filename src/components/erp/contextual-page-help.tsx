'use client'

import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { getPageHelp } from '@/lib/onboarding/page-help'

export function ContextualPageHelp({ pageKey }: { pageKey: string }) {
  const help = getPageHelp(pageKey)
  if (!help) return null

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-primary/20 bg-card text-xs text-foreground hover:bg-primary/[0.08]"
          aria-label={`What is ${help.title}?`}
        >
          <CircleHelp className="size-3.5 text-primary" strokeWidth={1.9} />
          What is this page?
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{help.title}</DialogTitle>
          <DialogDescription className="leading-6">{help.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" className="min-h-11">Got it</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
