// Building blocks for the Settings tabs: page header, cards, rows, copyable code, status dot.
import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
export function SettingsPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-6', className)}>{children}</div>
}
export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
  testid
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
  testid?: string
}) {
  return (
    <section data-testid={testid} className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
      {(title || description || action) && (
        <header className="flex items-start gap-4 px-5 pt-4">
          <div className="min-w-0 flex-1 space-y-1">
            {title && <h3 className="text-sm font-semibold leading-tight">{title}</h3>}
            {description && <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children && <div className="px-5 pb-4 pt-3">{children}</div>}
    </section>
  )
}
/** A label and hint on the left, a control on the right; rows in a card are divided by lines. */
export function SettingRow({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-center gap-6 py-3 first:pt-0 last:pb-0 [&+&]:border-t">
      <div className="min-w-0 flex-1 space-y-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <div className="text-sm font-medium">{label}</div>
        )}
        {hint && <div className="text-[13px] leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
/** Code with a copy button in its corner. The copy itself runs in main when onCopy says so. */
export function CopyBlock({
  text,
  onCopy,
  testid,
  copyTestid,
  copyLabel = 'Copy',
  extra,
  className
}: {
  text: string
  onCopy: () => void
  testid?: string
  copyTestid?: string
  copyLabel?: string
  extra?: ReactNode
  className?: string
}) {
  return (
    // Buttons sit beside the code, never over it, so long lines scroll instead of hiding under them
    <div className={cn('flex items-start rounded-lg border bg-muted/50', className)}>
      <pre data-testid={testid} className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-3 py-2.5 font-mono text-xs leading-relaxed">
        {text}
      </pre>
      <div className="flex shrink-0 gap-1 p-1.5">
        {extra}
        <Button size="sm" variant="outline" className="h-7 bg-background px-2 text-xs" onClick={onCopy} data-testid={copyTestid}>
          <Copy className="mr-1 h-3 w-3" aria-hidden />
          {copyLabel}
        </Button>
      </div>
    </div>
  )
}
export type DotTone = 'ok' | 'off' | 'warn' | 'error'
const DOT: Record<DotTone, string> = {
  ok: 'bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20',
  off: 'bg-muted-foreground/40',
  warn: 'bg-amber-500 shadow-[0_0_0_3px] shadow-amber-500/20',
  error: 'bg-red-500 shadow-[0_0_0_3px] shadow-red-500/20'
}
/** Always used next to text, so colour is never the only signal. */
export function StatusDot({ tone }: { tone: DotTone }) {
  return <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT[tone])} />
}
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'red'; className?: string }) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'
  }
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none', tones[tone], className)}>
      {children}
    </span>
  )
}
export function Callout({ tone, icon, children, testid }: { tone: 'info' | 'warn' | 'danger'; icon?: ReactNode; children: ReactNode; testid?: string }) {
  const tones = {
    info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200',
    warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    danger: 'border-red-300 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200'
  }
  return (
    <div data-testid={testid} className={cn('flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed', tones[tone])}>
      {icon && <span className="mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
/** Inline keyboard keys from README-style text: `Cmd/Ctrl+K`, `F5` → chips. */
export function Keys({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/).filter(Boolean)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((p, i) =>
        p.startsWith('`') ? (
          <kbd key={i} className="rounded border border-b-2 bg-background px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
            {p.slice(1, -1)}
          </kbd>
        ) : (
          <span key={i} className="text-xs text-muted-foreground">
            {p.trim()}
          </span>
        )
      )}
    </span>
  )
}
