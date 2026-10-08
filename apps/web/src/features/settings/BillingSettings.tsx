import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import { useRegion } from '../../shared/i18n/use-region';
import { Alert, Button, Field } from '../../shared/ui/form';

interface Plan { id: string; name: string; priceCop: number; maxUsers: number; maxChannels: number; aiRepliesPerMonth: number; storageBytes: number }
interface Payment { id: string; plan: string; amountInCents: number; status: 'pending' | 'approved' | 'declined'; failureReason: string | null; createdAt: string }
interface Account {
  plan: string;
  status: 'trialing' | 'active' | 'past_due' | 'read_only' | 'canceled';
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  nextRetryAt: string | null;
  card: { brand: string; lastFour: string } | null;
  plans: Plan[];
  payments: Payment[];
}
interface Checkout { publicKey: string; wompiUrl: string; simulated: boolean; acceptanceToken: string; termsUrl: string; personalDataAuthToken: string; personalDataUrl: string }

const STATUS = {
  trialing: 'Prueba gratuita',
  active: 'Activa',
  past_due: 'Pago pendiente',
  read_only: 'Solo lectura',
  canceled: 'Cancelada',
} as const;
const PAYMENT_STATUS = { pending: 'En proceso', approved: 'Aprobado', declined: 'Rechazado' } as const;
const cop = (value: number) => `$${value.toLocaleString('es-CO')}`;

/** E10-S03 — Suscripción con Wompi. Los datos de la tarjeta van del navegador a Wompi; nunca pasan por nuestro servidor. */
export function BillingSettings() {
  const { date } = useRegion();
  const queryClient = useQueryClient();
  const account = useQuery({ queryKey: ['billing'], queryFn: () => api<Account>('/api/v1/billing'), retry: false });
  const subscribe = useMutation({
    mutationFn: (plan: string) => api<{ status: string }>('/api/v1/billing/subscribe', { method: 'POST', body: JSON.stringify({ plan }) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['billing'] }),
  });

  if (account.isError || !account.data) return null; // solo el propietario gestiona el plan
  const a = account.data;

  return (
    <section className="mt-10" aria-labelledby="billing-title">
      <h2 id="billing-title" className="text-lg font-semibold text-ink">Plan y pagos</h2>
      <div className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm text-ink">
        <p><strong>{a.plans.find((p) => p.id === a.plan)?.name ?? 'Prueba'}</strong> · {STATUS[a.status]}</p>
        {a.status === 'trialing' && a.trialEndsAt && <p className="text-muted">La prueba termina el {date(a.trialEndsAt)}.</p>}
        {a.status === 'active' && a.currentPeriodEnd && <p className="text-muted">Próximo cobro: {date(a.currentPeriodEnd)}.</p>}
        {a.status === 'past_due' && a.nextRetryAt && <p className="text-danger">No pudimos cobrar. Reintentamos el {date(a.nextRetryAt)}; podés cambiar la tarjeta antes.</p>}
        {a.status === 'read_only' && <p className="text-danger">Tu cuenta está en solo lectura. Tus datos siguen intactos: suscribite de nuevo para seguir trabajando.</p>}
        <p className="mt-1 text-muted">{a.card ? `Tarjeta ${a.card.brand} terminada en ${a.card.lastFour}` : 'Sin tarjeta registrada'}</p>
      </div>

      <CardForm hasCard={Boolean(a.card)} onSaved={(data) => queryClient.setQueryData(['billing'], data)} />

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {a.plans.map((plan) => {
          const current = a.status === 'active' && a.plan === plan.id;
          return (
            <li key={plan.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
              <p className="font-semibold text-ink">{plan.name}</p>
              <p className="text-ink"><span className="text-xl font-semibold">{cop(plan.priceCop)}</span> <span className="text-sm text-muted">COP / mes</span></p>
              <p className="text-xs text-muted">{plan.maxUsers} usuarios · {plan.maxChannels} número(s) de WhatsApp · {plan.aiRepliesPerMonth.toLocaleString('es-CO')} respuestas de IA · {Math.round(plan.storageBytes / 1024 ** 3)} GB</p>
              <Button onClick={() => subscribe.mutate(plan.id)} disabled={current || !a.card || a.status === 'active' || a.status === 'past_due'} loading={subscribe.isPending && subscribe.variables === plan.id} className="mt-auto self-start">
                {current ? 'Plan actual' : 'Suscribirme'}
              </Button>
            </li>
          );
        })}
      </ul>
      {!a.card && <p className="mt-2 text-sm text-muted">Agregá una tarjeta para suscribirte.</p>}
      {subscribe.isError && <div className="mt-2"><Alert>{subscribe.error instanceof ApiError ? subscribe.error.message : 'No pudimos iniciar el pago.'}</Alert></div>}
      {subscribe.data?.status === 'pending' && <div className="mt-2"><Alert tone="success">Pago en proceso. Te avisamos apenas Wompi lo confirme.</Alert></div>}

      {a.payments.length > 0 && (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Historial de pagos</caption>
          <thead className="text-xs text-muted"><tr><th scope="col" className="py-2">Fecha</th><th scope="col">Plan</th><th scope="col">Valor</th><th scope="col">Estado</th></tr></thead>
          <tbody className="divide-y divide-line">
            {a.payments.map((p) => (
              <tr key={p.id}>
                <td className="py-2">{date(p.createdAt)}</td>
                <td>{a.plans.find((x) => x.id === p.plan)?.name ?? p.plan}</td>
                <td>{cop(p.amountInCents / 100)}</td>
                <td title={p.failureReason ?? undefined}>{PAYMENT_STATUS[p.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CardForm({ hasCard, onSaved }: { hasCard: boolean; onSaved: (account: Account) => void }) {
  const [open, setOpen] = useState(false);
  const checkout = useQuery({ queryKey: ['billing-checkout'], queryFn: () => api<Checkout>('/api/v1/billing/checkout'), enabled: open, staleTime: 5 * 60_000 });
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const c = checkout.data!;
      const card = await tokenize(c, {
        number: String(form.get('number')).replace(/\s+/g, ''),
        cvc: String(form.get('cvc')),
        exp_month: String(form.get('expMonth')).padStart(2, '0'),
        exp_year: String(form.get('expYear')).slice(-2),
        card_holder: String(form.get('holder')),
      });
      return api<Account>('/api/v1/billing/payment-method', {
        method: 'PUT',
        body: JSON.stringify({ token: card.id, acceptanceToken: c.acceptanceToken, acceptPersonalAuth: c.personalDataAuthToken, brand: card.brand, lastFour: card.last_four }),
      });
    },
    onSuccess: (data) => { onSaved(data); setOpen(false); },
  });

  if (!open) {
    return <button onClick={() => setOpen(true)} className="mt-2 inline-flex min-h-11 items-center text-sm text-ink underline">{hasCard ? 'Cambiar tarjeta' : 'Agregar tarjeta'}</button>;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(new FormData(event.currentTarget));
  }

  const c = checkout.data;
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <Field label="Número de la tarjeta" name="number" inputMode="numeric" autoComplete="cc-number" required pattern="[0-9 ]{13,23}" />
      <Field label="Nombre como aparece en la tarjeta" name="holder" autoComplete="cc-name" required minLength={5} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Mes" name="expMonth" inputMode="numeric" autoComplete="cc-exp-month" required pattern="(0?[1-9]|1[0-2])" placeholder="MM" />
        <Field label="Año" name="expYear" inputMode="numeric" autoComplete="cc-exp-year" required pattern="([0-9]{2}|[0-9]{4})" placeholder="AA" />
        <Field label="CVC" name="cvc" inputMode="numeric" autoComplete="cc-csc" required pattern="[0-9]{3,4}" />
      </div>
      <label className="flex min-h-11 items-start gap-2 text-sm text-ink">
        <input type="checkbox" required className="mt-1" />
        <span>Acepto el <a href={c?.termsUrl} target="_blank" rel="noreferrer" className="underline">reglamento de usuarios de Wompi</a>.</span>
      </label>
      <label className="flex min-h-11 items-start gap-2 text-sm text-ink">
        <input type="checkbox" required className="mt-1" />
        <span>Autorizo el <a href={c?.personalDataUrl} target="_blank" rel="noreferrer" className="underline">tratamiento de mis datos personales</a> por parte de Wompi.</span>
      </label>
      <p className="text-xs text-muted">Los datos de la tarjeta van directo a Wompi; BeeCRM solo guarda la marca y los últimos 4 dígitos.{c?.simulated ? ' (Modo de desarrollo: no se contacta a Wompi.)' : ''}</p>
      {save.isError && <Alert>{save.error instanceof ApiError ? save.error.message : (save.error as Error).message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending} disabled={!c}>Guardar tarjeta</Button>
        <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center px-3 text-sm text-ink underline">Cancelar</button>
      </div>
    </form>
  );
}

interface CardToken { id: string; brand: string; last_four: string }

/** POST /tokens/cards con la llave pública. En desarrollo (WOMPI_API=local) se simula. */
async function tokenize(checkout: Checkout, card: { number: string; cvc: string; exp_month: string; exp_year: string; card_holder: string }): Promise<CardToken> {
  if (checkout.simulated) return { id: `tok_local_${Date.now()}`, brand: card.number.startsWith('5') ? 'MASTERCARD' : 'VISA', last_four: card.number.slice(-4) };
  const res = await fetch(`${checkout.wompiUrl}/tokens/cards`, {
    method: 'POST',
    headers: { authorization: `Bearer ${checkout.publicKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(card),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.data?.id) throw new Error('Wompi no aceptó los datos de la tarjeta. Revisalos e intentá de nuevo.');
  return body.data as CardToken;
}
