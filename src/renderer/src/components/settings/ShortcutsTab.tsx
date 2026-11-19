import { SHORTCUT_ROWS } from '../../../../main/shortcut-table'
import { Keys, SettingsCard, SettingsPage } from './shared'
export function ShortcutsTab() {
  return (
    <SettingsPage>
      <SettingsCard
        title="Keyboard shortcuts"
        description="They work in the toolbar and inside pages, and act on the focused pane. Cmd on macOS, Ctrl elsewhere; Ctrl+Tab is Ctrl everywhere."
      >
        <table data-testid="shortcuts-table" className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-[45%] pb-2 font-medium">Shortcut</th>
              <th className="pb-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUT_ROWS.map((r) => (
              <tr key={r.keys} className="border-t">
                <td className="py-2 pr-4">
                  <Keys text={r.keys} />
                </td>
                <td className="py-2 text-[13px]">{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          A combination with extra modifiers (for example Ctrl+Shift+K) goes to the page. Shortcuts can't be changed yet.
        </p>
      </SettingsCard>
    </SettingsPage>
  )
}
