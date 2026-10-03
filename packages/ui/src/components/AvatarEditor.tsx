import { AVATAR_FIELDS, type AvatarField, type AvatarSpec } from '@huddle/shared';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { AvatarPaletteUi, AvatarPreviewHandle } from '../store.ts';
import { Icon } from './icons.tsx';
import { IconButton, Slider } from './ui.tsx';

type FieldKind = 'style' | 'color' | 'range' | 'toggle';

interface FieldDef {
  field: AvatarField;
  kind: FieldKind;
  palette?: keyof AvatarPaletteUi;
}

interface GroupDef {
  id: string;
  /** Preview framing: 0 = full body, 1 = face. */
  framing: number;
  fields: FieldDef[];
}

const GROUPS: readonly GroupDef[] = [
  {
    id: 'body',
    framing: 0,
    fields: [
      { field: 'bodyType', kind: 'style' },
      { field: 'height', kind: 'range' },
      { field: 'skinTone', kind: 'color', palette: 'skin' },
    ],
  },
  {
    id: 'face',
    framing: 1,
    fields: [
      { field: 'faceShape', kind: 'style' },
      { field: 'eyeStyle', kind: 'style' },
      { field: 'eyeColor', kind: 'color', palette: 'eye' },
      { field: 'browStyle', kind: 'style' },
      { field: 'mouthStyle', kind: 'style' },
      { field: 'noseStyle', kind: 'style' },
      { field: 'freckles', kind: 'toggle' },
    ],
  },
  {
    id: 'hair',
    framing: 1,
    fields: [
      { field: 'hairStyle', kind: 'style' },
      { field: 'hairColor', kind: 'color', palette: 'hair' },
      { field: 'facialHair', kind: 'style' },
    ],
  },
  {
    id: 'outfit',
    framing: 0,
    fields: [
      { field: 'topStyle', kind: 'style' },
      { field: 'topColor', kind: 'color', palette: 'cloth' },
      { field: 'topPattern', kind: 'style' },
      { field: 'patternColor', kind: 'color', palette: 'cloth' },
      { field: 'bottomStyle', kind: 'style' },
      { field: 'bottomColor', kind: 'color', palette: 'cloth' },
      { field: 'shoeStyle', kind: 'style' },
      { field: 'shoeColor', kind: 'color', palette: 'cloth' },
    ],
  },
  {
    id: 'extras',
    framing: 0.55,
    fields: [
      { field: 'headwear', kind: 'style' },
      { field: 'headwearColor', kind: 'color', palette: 'cloth' },
      { field: 'glasses', kind: 'style' },
      { field: 'accessory', kind: 'style' },
      { field: 'accessoryColor', kind: 'color', palette: 'cloth' },
    ],
  },
];

function FieldRow({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: number;
  onChange: (v: number) => void;
}): ReactNode {
  const t = useT();
  const palette = useHud((s) => s.avatarPalette);
  const count = AVATAR_FIELDS[def.field];
  const options = Array.from({ length: count }, (_, i) => i);
  return (
    <div className="field-row">
      <span className="field-row__label">{t(`avatar.field.${def.field}`)}</span>
      {def.kind === 'range' && (
        <Slider
          label={t(`avatar.field.${def.field}`)}
          value={value}
          min={0}
          max={count - 1}
          step={1}
          onChange={onChange}
        />
      )}
      {def.kind === 'toggle' && (
        <button
          type="button"
          className={`chip ${value > 0 ? 'is-active' : ''}`}
          onClick={() => onChange(value > 0 ? 0 : 1)}
          aria-pressed={value > 0}
        >
          {t(value > 0 ? 'avatar.on' : 'avatar.off')}
        </button>
      )}
      {def.kind === 'color' && (
        <div className="swatches" role="radiogroup" aria-label={t(`avatar.field.${def.field}`)}>
          {options.map((i) => {
            const hex = def.palette ? palette[def.palette][i] : undefined;
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={value === i}
                className={`swatch ${value === i ? 'is-active' : ''}`}
                style={{ background: hex ?? '#888' }}
                onClick={() => onChange(i)}
                aria-label={`${i + 1}`}
              />
            );
          })}
        </div>
      )}
      {def.kind === 'style' && (
        <div className="chips" role="radiogroup" aria-label={t(`avatar.field.${def.field}`)}>
          {options.map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={value === i}
              className={`chip ${value === i ? 'is-active' : ''}`}
              onClick={() => onChange(i)}
            >
              {t(`avatar.${def.field}.${i}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Character creator: live turntable preview plus every look option. */
export function AvatarEditor(): ReactNode {
  const t = useT();
  const c = useCommands();
  const open = useHud((s) => s.avatarOpen);
  const initial = useHud((s) => s.avatarSpec);
  const initialName = useHud((s) => s.playerName);
  if (!open || !initial) return null;
  return (
    <EditorBody
      initial={initial}
      initialName={initialName}
      onClose={() => c.setAvatarOpen(false)}
      title={t('avatar.title')}
    />
  );
}

function EditorBody({
  initial,
  initialName,
  onClose,
  title,
}: {
  initial: AvatarSpec;
  initialName: string;
  onClose: () => void;
  title: string;
}): ReactNode {
  const t = useT();
  const c = useCommands();
  const [spec, setSpec] = useState<AvatarSpec>(initial);
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState<GroupDef>(GROUPS[0] as GroupDef);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const preview = useRef<AvatarPreviewHandle | null>(null);
  const drag = useRef<number | null>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const handle = c.mountAvatarPreview(el);
    preview.current = handle;
    return () => {
      handle.dispose();
      preview.current = null;
    };
  }, [c]);
  useEffect(() => {
    preview.current?.setSpec(spec);
  }, [spec]);
  useEffect(() => {
    preview.current?.setFraming(group.framing);
  }, [group]);
  const set = (field: AvatarField, v: number): void => setSpec((s) => ({ ...s, [field]: v }));
  const onDown = (e: ReactPointerEvent): void => {
    drag.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent): void => {
    if (drag.current === null) return;
    preview.current?.drag(e.clientX - drag.current);
    drag.current = e.clientX;
  };
  return (
    <div
      className="modal-backdrop enter-fade"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal editor enter-scale"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <div className="editor__stage">
          <canvas
            ref={canvas}
            className="editor__canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            aria-label={t('avatar.preview')}
          />
          <p className="editor__drag" aria-hidden="true">
            {t('avatar.dragHint')}
          </p>
          <div className="editor__stage-actions">
            <button
              type="button"
              className="btn btn--sm btn--glass"
              onClick={() => setSpec(c.randomAvatar())}
            >
              <Icon name="shuffle" size={16} />
              {t('avatar.shuffle')}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--glass"
              onClick={() => preview.current?.play('wave')}
            >
              <Icon name="hand" size={16} />
              {t('emote.wave')}
            </button>
          </div>
        </div>
        <div className="editor__side">
          <header className="modal__head">
            <h2 id="editor-title" className="modal__title">
              {title}
            </h2>
            <IconButton
              icon="close"
              label={t('settings.close')}
              tip={false}
              size="sm"
              onClick={onClose}
            />
          </header>
          <div className="field editor__name">
            <label className="field__label" htmlFor="editor-name">
              {t('avatar.name')}
            </label>
            <input
              id="editor-name"
              className="input"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => c.setTyping(true)}
              onBlur={() => c.setTyping(false)}
            />
          </div>
          <div className="tabs" role="tablist">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={group.id === g.id}
                className={`tab ${group.id === g.id ? 'is-active' : ''}`}
                onClick={() => setGroup(g)}
              >
                {t(`avatar.group.${g.id}`)}
              </button>
            ))}
          </div>
          <div className="editor__fields" role="tabpanel">
            {group.fields.map((f) => (
              <FieldRow
                key={f.field}
                def={f}
                value={spec[f.field]}
                onChange={(v) => set(f.field, v)}
              />
            ))}
          </div>
          <footer className="editor__footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              {t('avatar.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                c.saveAvatar(spec, name.trim() || initialName);
                onClose();
              }}
            >
              <Icon name="check" size={18} />
              {t('avatar.save')}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
