import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useCommands, useHud, useT } from '../context.tsx';
import type { PersonUi } from '../store.ts';
import { Icon } from './icons.tsx';
import { HostSettings, PersonHostActions } from './Room.tsx';
import { Avatar, Sheet, VoiceBars } from './ui.tsx';
import { PersonMic, PersonVolume } from './Voice.tsx';

/** Text chat history (people and bots) with a composer; `compact` floats over Theater Mode. */
export function ChatPanel({ compact = false }: { compact?: boolean }): ReactNode {
  const t = useT();
  const c = useCommands();
  const open = useHud((s) => s.panel === 'chat');
  const messages = useHud((s) => s.chat);
  const focusTick = useHud((s) => s.chatFocus);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    if (open && focusTick > 0) input.current?.focus();
  }, [open, focusTick]);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);
  if (!open) return null;
  const send = (e: FormEvent): void => {
    e.preventDefault();
    const value = text.trim();
    if (value) c.sendChat(value);
    setText('');
  };
  const composer = (
    <form className="composer" onSubmit={send}>
      <input
        ref={input}
        className="composer__input"
        value={text}
        maxLength={280}
        placeholder={t('chat.placeholder')}
        aria-label={t('chat.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => c.setTyping(true)}
        onBlur={() => c.setTyping(false)}
      />
      <button
        type="submit"
        className="ibtn ibtn--sm is-on composer__send"
        aria-label={t('chat.send')}
        disabled={text.trim().length === 0}
      >
        <Icon name="send" size={18} />
      </button>
    </form>
  );
  return (
    <Sheet
      title={t('chat.title')}
      onClose={() => c.setPanel(null)}
      className={`sheet--chat ${compact ? 'sheet--compact' : ''}`}
      footer={composer}
    >
      <ol className="chat" ref={list} aria-live="polite">
        {messages.length === 0 && <li className="chat__empty">{t('chat.empty')}</li>}
        {messages.map((m, i) => {
          if (m.kind === 'system') {
            return (
              <li key={m.id} className="chat__system">
                {m.text}
              </li>
            );
          }
          const prev = messages[i - 1];
          const cont = prev?.kind === 'chat' && prev.playerId === m.playerId;
          return (
            <li key={m.id} className={`chat__msg ${cont ? 'chat__msg--cont' : ''}`}>
              {cont ? (
                <span className="chat__gutter" aria-hidden="true" />
              ) : (
                <Avatar name={m.name} color={m.color} size={26} />
              )}
              <div className="chat__body">
                {!cont && <span className="chat__name">{m.name}</span>}
                <p className="chat__text">{m.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}

const QUICK_THROWS: readonly { kind: string; emoji: string }[] = [
  { kind: 'paper', emoji: '📄' },
  { kind: 'tomato', emoji: '🍅' },
  { kind: 'heart', emoji: '💖' },
];

/** One person: the summary row, and (opened) volume, quick throws and host actions. */
function PersonRow(props: {
  person: PersonUi;
  presenting: boolean;
  open: boolean;
  onToggle: () => void;
}): ReactNode {
  const t = useT();
  const c = useCommands();
  const { person: p, presenting, open, onToggle } = props;
  const online = useHud((s) => s.room !== null);
  const meta = [
    p.isHost ? t('people.host') : null,
    presenting ? t('people.presenting') : null,
    p.isBot ? t('people.bot') : null,
    p.away ? t('people.away') : null,
    t(p.seated ? 'people.seated' : 'people.standing'),
  ].filter((m): m is string => m !== null);
  return (
    <li className={`person ${p.away ? 'is-away' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="person__row" aria-expanded={open} onClick={onToggle}>
        <Avatar name={p.name} color={p.color} size={32} speaking={p.speaking} />
        <span className="person__main">
          <span className="person__name">
            {p.name}
            {p.isLocal && <span className="person__you">{t('people.you')}</span>}
          </span>
          <span className="person__meta">{meta.join(' · ')}</span>
        </span>
        <span className="person__state">
          {p.handOrder !== null && (
            <span className="person__hand" title={t('people.queue')}>
              ✋<span>{p.handOrder}</span>
            </span>
          )}
          {p.points > 0 && (
            <span className="person__points" title={t('people.points', { points: p.points })}>
              🏀 {p.points}
            </span>
          )}
          {p.shield && (
            <span className="person__icon" title={t('people.shield')}>
              <Icon name="shield" size={16} />
            </span>
          )}
          {p.speaking ? <VoiceBars /> : <PersonMic person={p} />}
        </span>
      </button>
      {open && (
        <div className="person__details enter-fade">
          {p.isLocal ? (
            <button type="button" className="btn btn--sm" onClick={() => c.setAvatarOpen(true)}>
              <Icon name="shirt" size={16} />
              {t('dock.avatar')}
            </button>
          ) : (
            <>
              {online && <PersonVolume person={p} />}
              <div className="person__actions">
                {!p.shield &&
                  QUICK_THROWS.map((q) => (
                    <button
                      key={q.kind}
                      type="button"
                      className="person__throw"
                      onClick={() => c.throwAt(p.id, q.kind)}
                      aria-label={t('people.throwAt', { item: t(`throw.${q.kind}`), name: p.name })}
                      title={t('people.throwAt', { item: t(`throw.${q.kind}`), name: p.name })}
                    >
                      {q.emoji}
                    </button>
                  ))}
                <span className="person__host">
                  <PersonHostActions person={p} />
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Everyone in the room (you first, then raised hands), host settings on top for the host. */
export function PeoplePanel(): ReactNode {
  const t = useT();
  const c = useCommands();
  const open = useHud((s) => s.panel === 'people');
  const people = useHud((s) => s.people);
  const presenterId = useHud((s) => s.presenter?.id ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!open) return null;
  return (
    <Sheet
      title={t('people.title')}
      meta={people.length}
      onClose={() => c.setPanel(null)}
      className="sheet--people"
    >
      <HostSettings />
      <ul className="people">
        {people.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            presenting={p.id === presenterId}
            open={openId === p.id}
            onToggle={() => setOpenId((id) => (id === p.id ? null : p.id))}
          />
        ))}
      </ul>
    </Sheet>
  );
}

/** Floating raised-hand queue (visible without opening the people panel). */
export function HandQueue(): ReactNode {
  const t = useT();
  const people = useHud((s) => s.people);
  const panel = useHud((s) => s.panel);
  const queue = people
    .filter((p) => p.handOrder !== null)
    .sort((a, b) => (a.handOrder ?? 0) - (b.handOrder ?? 0));
  if (queue.length === 0 || panel !== null) return null;
  return (
    <div className="hand-queue surface enter-down" role="status" aria-label={t('people.queue')}>
      <span className="hand-queue__title">
        <span aria-hidden="true">✋</span>
        {t('people.queue')}
      </span>
      <ol>
        {queue.slice(0, 4).map((p) => (
          <li key={p.id}>
            <span className="hand-queue__n">{p.handOrder}</span>
            {p.isLocal ? t('people.you') : p.name}
          </li>
        ))}
        {queue.length > 4 && <li className="hand-queue__more">+{queue.length - 4}</li>}
      </ol>
    </div>
  );
}
