'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Eye, EyeOff, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Trash2, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

type ConnectionStatus =
  | 'not_configured'
  | 'not_tested'
  | 'connected'
  | 'invalid'
  | 'failed'
  | 'configuration_error'

type AiSettingsData = {
  configured: boolean
  provider: string
  status: ConnectionStatus
  lastTestedAt: string | null
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ComponentType<{ className?: string }> }> = {
  not_configured: { label: 'Not configured', color: 'secondary', icon: AlertTriangle },
  not_tested: { label: 'Saved, not tested', color: 'outline', icon: RefreshCw },
  connected: { label: 'Connected', color: 'default', icon: CheckCircle2 },
  invalid: { label: 'Invalid key', color: 'destructive', icon: XCircle },
  failed: { label: 'Connection error', color: 'destructive', icon: XCircle },
  configuration_error: { label: 'Connection error', color: 'destructive', icon: AlertTriangle },
}

async function fetchSettings(): Promise<AiSettingsData> {
  const r = await fetch('/api/ai-settings', { cache: 'no-store' })
  if (!r.ok) throw new Error('Failed to fetch settings')
  return r.json()
}

async function saveSettings(apiKey: string): Promise<AiSettingsData> {
  const r = await fetch('/api/ai-settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
    cache: 'no-store',
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error ?? 'Failed to save')
  return j
}

async function testConnection(): Promise<{ status: ConnectionStatus; lastTestedAt: string }> {
  const r = await fetch('/api/ai-settings/test', {
    method: 'POST',
    cache: 'no-store',
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error ?? 'Test failed')
  return j
}

async function removeSettings(): Promise<void> {
  const r = await fetch('/api/ai-settings', { method: 'DELETE', cache: 'no-store' })
  if (!r.ok) throw new Error('Failed to remove')
}

export function AiSettingsView() {
  const qc = useQueryClient()
  const [showInput, setShowInput] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const settingsQ = useQuery<AiSettingsData>({
    queryKey: ['ai-settings'],
    queryFn: fetchSettings,
    refetchOnMount: true,
  })

  const saveMut = useMutation({
    mutationFn: () => saveSettings(apiKey),
    onSuccess: () => {
      toast.success('API key saved')
      setApiKey('')
      setShowInput(false)
      setShowKey(false)
      void qc.invalidateQueries({ queryKey: ['ai-settings'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
    },
  })

  const testMut = useMutation({
    mutationFn: testConnection,
    onSuccess: (data) => {
      if (data.status === 'connected') {
        toast.success('Connection successful')
      } else {
        toast.error(`Connection: ${data.status}`)
      }
      void qc.invalidateQueries({ queryKey: ['ai-settings'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
      void qc.invalidateQueries({ queryKey: ['ai-settings'] })
    },
  })

  const removeMut = useMutation({
    mutationFn: removeSettings,
    onSuccess: () => {
      toast.success('API key removed')
      setConfirmRemove(false)
      void qc.invalidateQueries({ queryKey: ['ai-settings'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
    },
  })

  const settings = settingsQ.data
  const status = settings?.status ?? 'not_configured'
  const statusCfg = STATUS_CONFIG[status]
  const StatusIcon = statusCfg.icon
  const isBusy = saveMut.isPending || testMut.isPending || removeMut.isPending

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">AI Settings</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Configure your Gemini API key for the AI assistant. The key is encrypted at rest and
          never returned to the browser after saving.
        </p>
      </div>

      {/* Status card */}
      <Card className="card-3d">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              Gemini API
            </CardTitle>
            <CardDescription>Google Gemini AI provider configuration</CardDescription>
          </div>
          <Badge variant={statusCfg.color} className="gap-1.5">
            <StatusIcon className="size-3" />
            {statusCfg.label}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Never render any stored key characters back into the browser. */}
          {settings?.configured && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Gemini API key</Label>
              <div className="text-sm bg-muted px-3 py-2 rounded-md">
                Stored securely. The saved key cannot be displayed.
              </div>
            </div>
          )}

          {/* Key input (hidden until user clicks "Edit" or "Add") */}
          {(showInput || !settings?.configured) && (
            <div className="space-y-2">
              <Label htmlFor="api-key" className="text-xs text-muted-foreground">
                {settings?.configured ? 'Replace API key' : 'Gemini API key'}
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="api-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your Gemini API key"
                    disabled={isBusy}
                    className="pr-10 font-mono text-sm"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground press-sm"
                    aria-label={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => saveMut.mutate()}
                  disabled={!apiKey.trim() || isBusy}
                  className="press-sm"
                >
                  {saveMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Save key
                </Button>
                {settings?.configured && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowInput(false)
                      setApiKey('')
                    }}
                    disabled={isBusy}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Actions when configured and input is not shown */}
          {settings?.configured && !showInput && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowInput(true)
                  setShowKey(false)
                }}
                disabled={isBusy}
                className="press-sm"
              >
                Replace key
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => testMut.mutate()}
                disabled={isBusy}
                className="press-sm"
              >
                {testMut.isPending ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="size-3.5 mr-1.5" />
                )}
                Test connection
              </Button>
              {confirmRemove ? (
                <div className="flex gap-2 items-center">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeMut.mutate()}
                    disabled={isBusy}
                    className="press-sm"
                  >
                    {removeMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Confirm remove
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmRemove(false)}
                    disabled={isBusy}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmRemove(true)}
                  disabled={isBusy}
                >
                  <Trash2 className="size-3.5 mr-1.5" />
                  Remove key
                </Button>
              )}
            </div>
          )}

          {/* Last tested */}
          {settings?.lastTestedAt && (
            <p className="text-[11px] text-muted-foreground pt-2">
              Last tested: {new Date(settings.lastTestedAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Info alert */}
      <Alert className="bg-muted/50 border-border">
        <AlertTriangle className="size-4 text-muted-foreground" />
        <AlertDescription className="text-xs text-muted-foreground">
          The API key is encrypted using AES-256-GCM with a server-only master key. It is never
          stored in plaintext, never returned to the client, and never logged. Only users with the
          Owner/Admin role can manage AI settings.
        </AlertDescription>
      </Alert>
    </div>
  )
}
