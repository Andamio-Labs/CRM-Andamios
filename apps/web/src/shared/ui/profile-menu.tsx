import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import {
  DURATIONS,
  PRESENCE,
  PRESENCE_ORDER,
  PresenceDot,
  type PresenceDuration,
  type PresenceStatus,
  useSetPresence,
  useTeamPresence,
} from '../../features/team/presence';
import { authClient } from '../auth-client';
import { useRegion } from '../i18n/use-region';
import { Segmented } from './section';

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** E01-S09 — Avatar con tu estado (en línea, en visita, no molestar, desconectado) y cuánto dura. */
export function ProfileMenu({ onSignOut }: { onSignOut: () => void }) {
  const session = authClient.useSession();
  const { time } = useRegion();
  const team = useTeamPresence();
  const setPresence = useSetPresence();
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<PresenceDuration>('until_changed');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const user = session.data?.user;
  const me = team.data?.find((p) => p.userId === user?.id);
  const status: PresenceStatus = me?.status ?? 'online';

  const choose = (next: PresenceStatus, nextDuration = duration) => setPresence.mutate({ status: next, duration: nextDuration });
  function pickDuration(next: PresenceDuration) {
    setDuration(next);
    // Cambiar la duración con un estado ya elegido lo vuelve a aplicar con el tiempo nuevo.
    if (status !== 'online') choose(status, next);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Tu perfil. Estado: ${PRESENCE[status].label}`}
        className="relative grid min-h-10 min-w-10 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey"
      >
        <span className="grid size-8 place-items-center rounded-full bg-honey text-[11px] font-bold text-ink">{initials(user?.name || user?.email || '?')}</span>
        <PresenceDot status={status} className="absolute bottom-1 right-1 size-2.5 ring-2 ring-surface" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line bg-surface text-left shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>

          <div className="p-2">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Tu estado</p>
            <ul className="flex flex-col gap-0.5">
              {PRESENCE_ORDER.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    aria-pressed={status === key}
                    disabled={setPresence.isPending}
                    onClick={() => choose(key)}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition disabled:opacity-60 ${status === key ? 'bg-honey-soft' : 'hover:bg-canvas'}`}
                  >
                    <PresenceDot status={key} className="mt-1 size-2.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-ink">
                        {PRESENCE[key].label}
                        {status === key && me?.until && <span className="font-normal text-muted"> · hasta las {time(me.until)}</span>}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted">{PRESENCE[key].hint}</span>
                    </span>
                    {status === key && <span aria-hidden className="text-xs text-ink">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-line px-4 py-3">
            <p className="mb-2 text-[11px] text-muted">Duración de En visita, No molestar y Desconectado</p>
            <Segmented label="Duración del estado" options={DURATIONS} value={duration} onChange={pickDuration} />
            <p className="mt-2 text-[11px] leading-snug text-muted">Al terminar el tiempo vuelves a En línea. Si cierras sesión, el equipo te ve Desconectado.</p>
            {setPresence.isError && <p role="alert" className="mt-2 text-[11px] text-danger">No pudimos cambiar tu estado. Inténtalo de nuevo.</p>}
          </div>

          <div className="border-t border-line p-1">
            <Link to="/settings" onClick={() => setOpen(false)} className="flex min-h-10 items-center rounded-lg px-3 text-xs text-ink hover:bg-canvas">
              Configuración y mis avisos
            </Link>
            <button type="button" onClick={onSignOut} className="flex min-h-10 w-full items-center rounded-lg px-3 text-xs text-muted hover:bg-canvas hover:text-danger">
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
