import { useRef, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { PersonUi } from '../store.ts';
import { Icon, type IconName } from './icons.tsx';
import { Avatar, IconButton, Segmented, useDismiss } from './ui.tsx';

const SCENES = ['meeting', 'presentation', 'relax', 'party'] as const;
const VIEWS = ['follow', 'overview', 'free'] as const;
const FACES = 3;

/** Who is here: a few faces and the head count; opens the people panel. */
function Facepile({ people, active }: { people: readonly PersonUi[]; active: boolean }): ReactNode {
  const t = useT();
  const c = useCommands();
  return (
    <span className="tip-host tip-host--bottom">
      <button
        type="button"
        className={`facepile ${active ? 'is-active' : ''}`}
        aria-label={t('people.title')}
        aria-pressed={active}
        onClick={() => c.setPanel(active ? null : 'people')}
      >
        <span className="facepile__faces">
          {people.slice(0, FACES).map((p) => (
            <Avatar key={p.id} name={p.name} color={p.color} size={24} speaking={p.speaking} />
          ))}
        </span>
        <span className="facepile__count">{people.length}</span>
      </button>
      <span className="tip" aria-hidden="true">
        {t('people.title')}
      </span>
    </span>
  );
}

function MenuItem(props: {
  icon: IconName;
  label: string;
  onClick: () => void;
  kbd?: string;
  checked?: boolean;
}): ReactNode {
  const { icon, label, onClick, kbd, checked } = props;
  return (
    <button type="button" className="menu-item" onClick={onClick} aria-pressed={checked}>
      <Icon name={icon} size={18} />
      <span className="menu-item__label">{label}</span>
      {checked !== undefined && (
        <span className={`menu-item__check ${checked ? 'is-on' : ''}`} aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      )}
      {kbd && <kbd className="kbd">{kbd}</kbd>}
    </button>
  );
}

/** The More menu: room lights, camera views, your look, shortcuts and stats. */
function MoreMenu(): ReactNode {
  const t = useT();
  const c = useCommands();
  const scene = useHud((s) => s.lightScene);
  const mode = useHud((s) => s.cameraMode);
  const debugOpen = useHud((s) => s.debugOpen);
  const view = mode === 'overview' || mode === 'free' ? mode : 'follow';
  const isScene = (id: string): id is (typeof SCENES)[number] =>
    (SCENES as readonly string[]).includes(id);
  return (
    <div
      className="popover popover--more surface enter-pop"
      id="pop-more"
      role="dialog"
      aria-label={t('more.title')}
    >
      <section className="menu-section">
        <h3 className="menu-label">{t('lights.title')}</h3>
        <Segmented
          label={t('lights.title')}
          value={isScene(scene) ? scene : 'meeting'}
          options={SCENES.map((id) => ({ id, label: t(`lights.${id}`) }))}
          onChange={(id) => c.setLightScene(id)}
          small
        />
      </section>
      <section className="menu-section">
        <h3 className="menu-label">
          {t('more.camera')}
          <kbd className="kbd">C</kbd>
        </h3>
        <Segmented
          label={t('more.camera')}
          value={view}
          options={VIEWS.map((id) => ({
            id,
            label: t(`camera.${id}Short`),
            title: t(`camera.${id}`),
          }))}
          onChange={(id) => c.setCameraMode(id)}
          small
        />
      </section>
      <div className="menu-sep" />
      <MenuItem
        icon="shirt"
        label={t('dock.avatar')}
        onClick={() => {
          c.setPopover(null);
          c.setAvatarOpen(true);
        }}
      />
      <MenuItem icon="keyboard" label={t('help.title')} onClick={() => c.setPanel('help')} />
      <MenuItem
        icon="activity"
        label={t('hud.debug')}
        kbd="F3"
        checked={debugOpen}
        onClick={() => c.setDebugOpen(!debugOpen)}
      />
    </div>
  );
}

/** Top-right: people, the More menu and settings. */
export function TopRight(): ReactNode {
  const t = useT();
  const c = useCommands();
  const people = useHud((s) => s.people);
  const panel = useHud((s) => s.panel);
  const popover = useHud((s) => s.popover);
  const ref = useRef<HTMLDivElement | null>(null);
  const moreOpen = popover === 'more';
  useDismiss(moreOpen, ref, () => c.setPopover(null));
  return (
    <div className="island island--tools surface" ref={ref}>
      <Facepile people={people} active={panel === 'people'} />
      <span className="island__sep" aria-hidden="true" />
      <IconButton
        icon="more"
        label={t('more.title')}
        expanded={moreOpen}
        controls="pop-more"
        tone={moreOpen ? 'on' : null}
        tip="bottom"
        onClick={() => c.setPopover(moreOpen ? null : 'more')}
      />
      <IconButton
        icon="settings"
        label={t('hud.settings')}
        tip="bottom-end"
        onClick={() => {
          c.setPopover(null);
          c.setSettingsOpen(true);
        }}
      />
      {moreOpen && <MoreMenu />}
    </div>
  );
}
