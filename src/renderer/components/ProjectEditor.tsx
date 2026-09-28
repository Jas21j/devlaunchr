import { useEffect } from 'react'
import type { ProjectType } from '@shared/types'
import { useApp } from '../store'
import { TYPE_LABELS, TYPE_ORDER, tildePath, platformCopy } from '../labels'
import { Button, Kbd } from './Button'
import { Field, Input, Select, TextArea, Toggle } from './form'
import { Modal, ModalFooter, ModalHeader } from './Modal'

export function ProjectEditor(): React.JSX.Element | null {
  const draft = useApp((s) => s.draft)
  const update = useApp((s) => s.updateDraft)
  const cancel = useApp((s) => s.cancelDraft)
  const commit = useApp((s) => s.commitDraft)
  const home = useApp((s) => s.info?.home ?? '')
  const platform = useApp((s) => s.info?.platform)

  const isStatic = draft?.type === 'static'
  const port = draft?.preferredPort ? Number(draft.preferredPort) : null
  const portInvalid = port !== null && (port < 1 || port > 65535)
  const canSave = !!draft && !portInvalid && (isStatic || draft.startCommand.trim().length > 0)

  useEffect(() => {
    if (!draft) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSave) void commit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, canSave, commit])

  if (!draft) return null
  const mod = platformCopy(platform).mod

  return (
    <Modal label={draft.id ? 'Edit project' : 'Add project'} onClose={cancel} width={540}>
        <ModalHeader
          title={draft.id ? 'Edit project' : 'Add project'}
          subtitle={<span className="selectable font-mono">{tildePath(draft.path, home)}</span>}
        />

        <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto px-[20px] py-[16px]">
          {draft.detection && (
            <div className="flex flex-col gap-[6px] rounded-card bg-accent-soft p-[12px]">
              <span className="text-caption text-ink-secondary">
                Detected as <strong className="font-semibold text-ink">{TYPE_LABELS[draft.type]}</strong>{' '}
                — {draft.detection.reason}.
              </span>
              {draft.detection.alternatives.map((alt) => (
                <button
                  key={alt.type}
                  type="button"
                  onClick={() => update({ type: alt.type, startCommand: alt.startCommand })}
                  className="self-start rounded-[8px] border border-hairline bg-raised px-[8px] py-[2px] text-caption text-ink-secondary hover:bg-hover"
                >
                  Use {TYPE_LABELS[alt.type]} instead ({alt.reason})
                </button>
              ))}
              {draft.detection.warnings.map((warning) => (
                <span key={warning} className="text-caption text-warn">
                  {warning}
                </span>
              ))}
            </div>
          )}

          <Field label="Name">
            <Input
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
            <Field
              label="Preferred port"
              hint={portInvalid ? <span className="text-danger">Ports run from 1 to 65535.</span> : 'Blank assigns a free one.'}
            >
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

          <div className="flex flex-col px-[8px]">
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

        <ModalFooter
          hint={
            <span className="flex items-center gap-[4px]">
              <Kbd>{mod === '⌘' ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>↵</Kbd> to save
            </span>
          }
        >
          <Button variant="subtle" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void commit()}>
            {draft.id ? 'Save' : 'Add project'}
          </Button>
        </ModalFooter>
    </Modal>
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
              className="flex size-[30px] shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-hover hover:text-ink"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ env: [...env, { key: '', value: '' }] })}
          className="self-start rounded-[8px] border border-hairline px-[8px] py-[3px] text-caption text-ink-secondary hover:bg-hover"
        >
          + Add variable
        </button>
      </div>
    </Field>
  )
}
