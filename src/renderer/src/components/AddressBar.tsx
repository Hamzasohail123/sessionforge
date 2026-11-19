import { forwardRef, useState, useEffect, useImperativeHandle, useRef } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, X, Lock, Globe, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { cn } from '../lib/utils'
import { toUrl } from '../lib/url'
import { callMain } from '../lib/ipc'

interface AddressBarProps {
  tabId: string | null
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  isLoading?: boolean
  currentUrl?: string
  pageTitle?: string
}

export const AddressBar = forwardRef<HTMLInputElement, AddressBarProps>(function AddressBar(
  {
    tabId,
    onNavigate,
    onBack,
    onForward,
    onReload,
    onStop,
    canGoBack = false,
    canGoForward = false,
    isLoading = false,
    currentUrl = '',
    pageTitle = ''
  },
  ref
) {
  const [urlInput, setUrlInput] = useState(currentUrl)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Ctrl+L (App) focuses the input through this ref
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

  useEffect(() => {
    if (!isFocused) {
      setUrlInput(currentUrl)
    }
  }, [currentUrl, isFocused])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!urlInput.trim()) return

    onNavigate(toUrl(urlInput.trim()))
    inputRef.current?.blur()
  }

  const handleFocus = () => {
    setIsFocused(true)
    inputRef.current?.select()
  }

  const handleBlur = () => {
    setIsFocused(false)
    setUrlInput(currentUrl)
  }

  const isSecure = currentUrl.startsWith('https://')

  return (
    <div data-testid="address-bar" className="h-12 bg-background border-b flex items-center gap-2 px-2">
      {/* Navigation controls */}
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={onBack}
          disabled={!canGoBack || !tabId}
          title="Back (Alt+Left)"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={onForward}
          disabled={!canGoForward || !tabId}
          title="Forward (Alt+Right)"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>

        {isLoading ? (
          <Button
            size="icon"
            variant="ghost"
            onClick={onStop}
            disabled={!tabId}
            title="Stop (Esc)"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            onClick={onReload}
            disabled={!tabId}
            title="Reload (Ctrl+R)"
            className={cn(isLoading && 'animate-spin')}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Address input */}
      <form onSubmit={handleSubmit} className="flex-1 flex items-center relative">
        {/* Loading progress bar */}
        {isLoading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-muted overflow-hidden">
            <div className="h-full bg-primary animate-progress-bar w-full" />
          </div>
        )}

        <div className="relative flex-1 flex items-center">
          <div className="absolute left-3 flex items-center pointer-events-none">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : isSecure ? (
              <Lock className="h-4 w-4 text-green-600" />
            ) : (
              <Globe className="h-4 w-4 text-muted-foreground" />
            )}
          </div>

          <Input
            ref={inputRef}
            type="text"
            value={isFocused ? urlInput : (pageTitle || currentUrl)}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            data-testid="address-input"
            disabled={!tabId}
            placeholder={tabId ? 'Search or enter address' : 'Pick a session for this pane'}
            className={cn(
              'pl-10 pr-4 h-9',
              !isFocused && pageTitle && 'text-sm'
            )}
          />
        </div>
      </form>

      {/* Extension/tools area */}
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            if (tabId) {
              callMain(window.api.tab.openDevTools(tabId))
            }
          }}
          disabled={!tabId}
          title="Developer Tools (F12)"
        >
          <span className="text-xs">🔧</span>
        </Button>
      </div>
    </div>
  )
})
