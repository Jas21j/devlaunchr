import { useEffect, useRef } from 'react'
import type { ProjectType } from '@shared/types'
import { useApp } from '../store'
import { TYPE_LABELS, TYPE_ORDER, tildePath } from '../labels'
import { Button } from './Button'
import { Field, Input, Select, TextArea, Toggle } from './form'

export function ProjectEditor({ home }: { home: string }): React.JSX.Element | null {
  const draft = useApp((s) => s.draft)
  const update = useApp((s) => s.updateDraft)
  const cancel = useApp((s) => s.cancelDraft)
  const commit = useApp((s) => s.commitDraft)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (draft) nameRef.current?.focus()
  }, [draft?.path])

  useEffect(() => {
    if (!draft) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel()
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void commit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, cancel, commit])

  if (!draft) return null

  const isStatic = draft.type === 'static'
  const canSave = isStatic || draft.startCommand.trim().length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-[24px]"
      style={{ background: 'rgba(9, 9, 11, 0.32)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel()
      }}
    >
      <div
        className="flex max-h-full w-[520px] flex-col overflow-hidden rounded-panel bg-raised"
        style={{ boxShadow: 'var(--shadow-overlay)' }}
      >
        <header className="flex shrink-0 flex-col gap-[2px] border-b border-hairline px-[20px] py-[16px]">
          <h2 className="text-subheading font-semibold tracking-[-0.01em]">
            {draft.id ? 'Edit project' : 'Add project'}
          </h2>
          <p className="selectable truncate font-mono text-caption text-ink-muted">
            {tildePath(draft.path, home)}
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto px-[20px] py-[16px]">
          {draft.detection && (
            <div className="flex flex-col gap-[6px] rounded-card border border-hairline bg-recessed p-[12px]">
              <span className="text-caption text-ink-secondary">
                Detected as <strong className="font-semibold text-ink">{TYPE_LABELS[draft.type]}</strong>{' '}
                — {draft.detection.reason}.
              </span>
              {draft.detection.alternatives.map((alt) => (
                <button
                  key={alt.type}
                  type="button"
                  onClick={() => update({ type: alt.type, startCommand: alt.startCommand })}
                  className="self-start rounded-badge border border-hairline px-[8px] py-[2px] text-caption text-ink-secondary hover:bg-[var(--surface-hover)]"
                >
                  Use {TYPE_LABELS[alt.type]} instead ({alt.reason})
                </button>
              ))}
              {draft.detection.warnings.map((warning) => (
                <span key={warning} className="text-caption" style={{ color: 'var(--status-pending)' }}>
                  {warning}
                </span>
              ))}
            </div>
          )}

          <Field label="Name">
            <Input
              ref={nameRef}
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>

          <Field label="Type">
            <Select
              value={draft.type}
              onChange={(event) => update({ type: event.target.value as ProjectType })}
            >
              {TYPE_ORDER.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Start command"
            hint={
              isStatic
                ? 'Static projects are served by the built-in server — no command needed.'
                : 'Runs in the project folder. $PORT is replaced with the assigned port.'
            }
          >
            <Input
              mono
              disabled={isStatic}
              placeholder={isStatic ? 'built-in static server' : 'npm run dev'}
              value={draft.startCommand}
              onChange={(event) => update({ startCommand: event.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-[12px]">
            <Field label="Install command" hint="Optional.">
              <Input
                mono
                placeholder="npm install"
                value={draft.installCommand}
                onChange={(event) => update({ installCommand: event.target.value })}
              />
            </Field>
            <Field label="Preferred port" hint="Blank auto-assigns.">
              <Input
                mono
                inputMode="numeric"
                placeholder="3000"
                value={draft.preferredPort}
                onChange={(event) =>
                  update({ preferredPort: event.target.value.replace(/[^0-9]/g, '') })
                }
              />
            </Field>
          </div>

          <EnvEditor />

          <Field label="Notes" hint="Optional.">
            <TextArea
              rows={2}
              value={draft.notes}
              onChange={(event) => update({ notes: event.target.value })}
            />
          </Field>

          <div className="flex flex-col">
            <Toggle
              checked={draft.favorite}
              onChange={(favorite) => update({ favorite })}
              label="Favorite"
              hint="Pins this project to the top of the sidebar."
            />
            <Toggle
              checked={draft.autoOpen}
              onChange={(autoOpen) => update({ autoOpen })}
              label="Open a tab automatically"
              hint="Opens the site as soon as the server answers."
            />
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-[8px] border-t border-hairline px-[20px] py-[12px]">
          <Button variant="subtle" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void commit()}>
            {draft.id ? 'Save' : 'Add project'}
          </Button>
        </footer>
      </div>
    </div>
  )
}

function EnvEditor(): React.JSX.Element {
  const env = useApp((s) => s.draft?.env ?? [])
  const update = useApp((s) => s.updateDraft)

  const setRow = (index: number, patch: Partial<{ key: string; value: string }>): void => {
    const next = env.map((row, i) => (i === index ? { ...row, ...patch } : row))
    update({ env: next })
  }

  return (
    <Field label="Environment variables" hint="Merged over the inherited environment.">
      <div className="flex flex-col gap-[6px]">
        {env.map((row, index) => (
          <div key={index} className="flex items-center gap-[6px]">
            <Input
              mono
              placeholder="KEY"
              value={row.key}
              onChange={(event) => setRow(index, { key: event.target.value })}
            />
            <Input
              mono
              placeholder="value"
              value={row.value}
              onChange={(event) => setRow(index, { value: event.target.value })}
            />
            <button
              type="button"
              aria-label="Remove variable"
              onClick={() => update({ env: env.filter((_, i) => i !== index) })}
              className="flex size-[26px] shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-[var(--surface-hover)] hover:text-ink"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ env: [...env, { key: '', value: '' }] })}
          className="self-start rounded-badge border border-hairline px-[8px] py-[3px] text-caption text-ink-secondary hover:bg-[var(--surface-hover)]"
        >
          + Add variable
        </button>
      </div>
    </Field>
  )
}
