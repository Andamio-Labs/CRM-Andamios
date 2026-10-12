import { api } from './api';

/** Estado del push en ESTE navegador. Cada dispositivo se activa por separado. */
export type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function pushState(publicKey: string | null): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!publicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && (await currentSubscription()) ? 'on' : 'off';
}

function keyBytes(base64url: string) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Pide permiso, suscribe el navegador y registra la suscripción en la API. */
export async function enablePush(publicKey: string): Promise<PushState> {
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off';
  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const { endpoint, keys } = subscription.toJSON();
  await api('/api/v1/notifications/push/subscriptions', { method: 'POST', body: JSON.stringify({ endpoint, keys }) });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (subscription) {
    await api('/api/v1/notifications/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) });
    await subscription.unsubscribe();
  }
  return 'off';
}
