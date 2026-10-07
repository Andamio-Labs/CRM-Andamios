import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
let users = 0;

/**
 * Un solo WebSocket por pestaña, compartido por todas las pantallas. Si el servidor corta la
 * conexión (cambió un permiso, auditoría #1/#2), reconecta para re-autorizarse.
 */
function acquire(): Socket {
  if (!socket) {
    socket = io('/realtime', { path: '/api/socket.io', withCredentials: true, transports: ['websocket'] });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') setTimeout(() => socket?.connect(), 500);
    });
  }
  users++;
  return socket;
}

function release() {
  users--;
  if (users === 0) {
    socket?.disconnect();
    socket = null;
  }
}

/** Escucha eventos en tiempo real; el handler puede cambiar entre renders sin re-suscribir. */
export function useRealtime(events: string[], handler: (payload: Record<string, unknown>) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  const key = events.join('|');

  useEffect(() => {
    const s = acquire();
    const listener = (payload: Record<string, unknown>) => latest.current(payload);
    for (const e of key.split('|')) s.on(e, listener);
    return () => {
      for (const e of key.split('|')) s.off(e, listener);
      release();
    };
  }, [key]);
}
