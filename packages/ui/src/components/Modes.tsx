import type { ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { BoardToolUi } from '../store.ts';
import { THROW_ICONS, type IconName } from './icons.tsx';
import { IconButton, Kbd, Sheet } from './ui.tsx';

const INKS = ['#1B1B2F', '#2F5BFF', '#E5322D', '#1E9E5A', '#FF7A1A', '#7B3CFF'];
const TOOLS: readonly { id: BoardToolUi; icon: IconName }[] = [
  { id: 'pen', icon: 'pen' },
  { id: 'marker', icon: 'marker' },
  { id: 'eraser', icon: 'eraser' },
];

/** Whiteboard drawing tools, shown instead of the control bar while drawing. */
export function BoardToolbar(): ReactNode {
  const t = useT();
  const c = useCommands();
  const board = useHud((s) => s.board);
  if (!board) return null;
  return (
    <div className="board-bar enter-up">
      <p className="board-bar__hint">{t('board.hint')}</p>
      <div className="cbar__inner surface" role="toolbar" aria-label={t('dock.board')}>
        {TOOLS.map((tool) => (
          <IconButton
            key={tool.id}
            icon={tool.icon}
            label={t(`board.${tool.id}`)}
            pressed={board.tool === tool.id}
            tone={board.tool === tool.id ? 'on' : null}
            onClick={() => c.setBoardTool(tool.id)}
          />
        ))}
        <span className="cbar__sep" aria-hidden="true" />
        <span className="board-bar__inks" role="radiogroup" aria-label={t('board.ink')}>
          {INKS.map((ink) => {
            const active = board.color === ink && board.tool !== 'eraser';
            return (
              <button
                key={ink}
                type="button"
                role="radio"
                aria-checked={active}
                className={`ink ${active ? 'is-active' : ''}`}
                style={{ background: ink }}
                onClick={() => c.setBoardTool(board.tool === 'eraser' ? 'pen' : board.tool, ink)}
                aria-label={ink}
              />
            );
          })}
        </span>
        <span className="cbar__sep" aria-hidden="true" />
        <IconButton icon="trash" label={t('board.clear')} onClick={() => c.clearBoard()} />
        <button type="button" className="btn btn--primary btn--sm" onClick={() => c.closeBoard()}>
          {t('board.done')}
        </button>
      </div>
    </div>
  );
}

/** Paper-plane wing tilt for the next throw: the arc curves left or right. */
function PlaneTilt(): ReactNode {
  const t = useT();
  const c = useCommands();
  const tilt = useHud((s) => s.play.tilt);
  const touch = useHud((s) => s.touch);
  const amount = Math.round(Math.abs(tilt) * 100);
  const label =
    tilt === 0
      ? t('throw.tiltStraight')
      : t(tilt < 0 ? 'throw.tiltLeft' : 'throw.tiltRight', { amount });
  return (
    <span className="tilt" role="group" aria-label={t('throw.tilt')}>
      <IconButton
        icon="chevronLeft"
        size="sm"
        tip={false}
        label={t('throw.tiltLeftButton')}
        disabled={tilt <= -1}
        onClick={() => c.tiltPlane(-0.25)}
      />
      <span
        className="tilt__plane"
        style={{ transform: `rotate(${tilt * 35}deg)` }}
        aria-hidden="true"
      >
        ✈️
      </span>
      <span className="tilt__value" aria-live="polite">
        {label}
      </span>
      <IconButton
        icon="chevronRight"
        size="sm"
        tip={false}
        label={t('throw.tiltRightButton')}
        disabled={tilt >= 1}
        onClick={() => c.tiltPlane(0.25)}
      />
      {!touch && <span className="tilt__hint">{t('throw.tiltWheel')}</span>}
    </span>
  );
}

/** While something is picked: what the next click does (and the wing tilt for planes). */
export function AimHint(): ReactNode {
  const t = useT();
  const aim = useHud((s) => s.aim);
  const touch = useHud((s) => s.touch);
  if (!aim) return null;
  const icon = THROW_ICONS.find((i) => i.kind === aim)?.emoji ?? '';
  return (
    <div className="aim-hint surface enter-down" role="status">
      <span className="aim-hint__row">
        <span className="aim-hint__icon" aria-hidden="true">
          {icon}
        </span>
        <span>{t(touch ? 'throw.hintTouch' : 'throw.hint', { item: t(`throw.${aim}`) })}</span>
        {!touch && (
          <span className="aim-hint__cancel">
            <Kbd>Esc</Kbd>
            {t('throw.cancel')}
          </span>
        )}
      </span>
      {aim === 'plane' && <PlaneTilt />}
    </div>
  );
}

/** Keys starting with `keys.` are mouse words (translated); the rest are key names. */
const HELP: readonly {
  group: string;
  rows: readonly { keys: readonly string[]; label: string }[];
}[] = [
  {
    group: 'help.group.move',
    rows: [
      { keys: ['W', 'A', 'S', 'D'], label: 'help.move' },
      { keys: ['Shift'], label: 'help.sprint' },
      { keys: ['Space'], label: 'help.jump' },
      { keys: ['E'], label: 'help.interact' },
      { keys: ['keys.click'], label: 'help.click' },
    ],
  },
  {
    group: 'help.group.camera',
    rows: [
      { keys: ['keys.drag'], label: 'help.orbit' },
      { keys: ['Shift', 'keys.drag'], label: 'help.pan' },
      { keys: ['keys.wheel'], label: 'help.zoom' },
      { keys: ['C'], label: 'help.camera' },
      { keys: ['R'], label: 'help.recenter' },
      { keys: ['F'], label: 'help.focus' },
      { keys: ['T'], label: 'help.theater' },
    ],
  },
  {
    group: 'help.group.play',
    rows: [
      { keys: ['1', '…', '6'], label: 'help.throwPick' },
      { keys: ['G'], label: 'help.throw' },
      { keys: ['keys.wheel'], label: 'help.tilt' },
      { keys: ['X'], label: 'help.useItem' },
      { keys: ['Q'], label: 'help.emotes' },
      { keys: ['H'], label: 'help.hand' },
    ],
  },
  {
    group: 'help.group.talk',
    rows: [
      { keys: ['M'], label: 'help.mute' },
      { keys: ['V'], label: 'help.pushToTalk' },
      { keys: ['N'], label: 'help.deafen' },
      { keys: ['Enter'], label: 'help.chat' },
      { keys: ['Esc'], label: 'help.back' },
    ],
  },
];

export function HelpPanel(): ReactNode {
  const t = useT();
  const c = useCommands();
  const open = useHud((s) => s.panel === 'help');
  if (!open) return null;
  return (
    <Sheet title={t('help.title')} onClose={() => c.setPanel(null)} className="sheet--help">
      <p className="help__intro">{t('help.intro')}</p>
      {HELP.map((g) => (
        <section key={g.group} className="help__group">
          <h3 className="menu-label">{t(g.group)}</h3>
          <dl className="help__list">
            {g.rows.map((row) => (
              <div key={row.label} className="help__row">
                <dt>{t(row.label)}</dt>
                <dd>
                  {row.keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {k.startsWith('keys.') ? t(k) : k}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Sheet>
  );
}
