import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptInvitation } from './AcceptInvitationPage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const pending = { organizationName: 'Clínica Norte', email: 'ana@clinica.co', role: 'member', status: 'pending', accountExists: false };

describe('AcceptInvitation (E01-S03)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('persona nueva: muestra la empresa, crea su clave y se une', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(pending)).mockResolvedValueOnce(json({ message: 'ok' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const onJoined = vi.fn();
    render(<AcceptInvitation invitationId="inv123" onJoined={onJoined} onLoginRequired={vi.fn()} />);

    expect(await screen.findByText(/Clínica Norte/)).toBeInTheDocument();
    expect(screen.getByText(/vendedor/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Tu nombre'), 'Ana Gómez');
    await user.type(screen.getByLabelText('Crea una contraseña'), 'Colombia2026!');
    await user.click(screen.getByRole('checkbox', { name: /acepto los términos/i }));
    await user.click(screen.getByRole('button', { name: 'Unirme al equipo' }));

    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/invitations/inv123/accept', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ name: 'Ana Gómez', password: 'Colombia2026!', acceptLegal: true });
    // Con la clave recién creada entra directo, sin volver a escribirla.
    expect(onJoined).toHaveBeenCalledWith({ email: 'ana@clinica.co', password: 'Colombia2026!' });
  });

  it('valida la contraseña antes de enviar', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(pending));
    vi.stubGlobal('fetch', fetchMock);
    render(<AcceptInvitation invitationId="inv123" onJoined={vi.fn()} onLoginRequired={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Tu nombre'), 'Ana');
    await user.type(screen.getByLabelText('Crea una contraseña'), 'corta');
    await user.click(screen.getByRole('checkbox', { name: /acepto los términos/i }));
    await user.click(screen.getByRole('button', { name: 'Unirme al equipo' }));

    expect(screen.getByText(/al menos 10 caracteres/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('con la sesión de otra persona abierta, avisa con qué cuenta va a entrar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(pending)));
    render(<AcceptInvitation invitationId="inv123" signedInAs="duena@clinica.co" onJoined={vi.fn()} onLoginRequired={vi.fn()} />);
    expect(await screen.findByText(/duena@clinica.co/)).toBeInTheDocument();
    expect(screen.getByText(/entrarás con tu cuenta nueva/i)).toBeInTheDocument();
  });

  it('si la API rechaza, muestra su motivo en vez de un error genérico', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(pending))
      .mockResolvedValueOnce(json({ code: 'LOGIN_REQUIRED', message: 'Ya tienes una cuenta: inicia sesión para aceptar.' }, 409));
    vi.stubGlobal('fetch', fetchMock);
    const onJoined = vi.fn();
    render(<AcceptInvitation invitationId="inv123" onJoined={onJoined} onLoginRequired={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Tu nombre'), 'Ana Gómez');
    await user.type(screen.getByLabelText('Crea una contraseña'), 'Colombia2026!');
    await user.click(screen.getByRole('checkbox', { name: /acepto los términos/i }));
    await user.click(screen.getByRole('button', { name: 'Unirme al equipo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya tienes una cuenta: inicia sesión para aceptar.');
    expect(onJoined).not.toHaveBeenCalled();
  });

  it('si ya tiene cuenta, le pide iniciar sesión', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...pending, accountExists: true })));
    const onLoginRequired = vi.fn();
    render(<AcceptInvitation invitationId="inv123" onJoined={vi.fn()} onLoginRequired={onLoginRequired} />);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Iniciar sesión para aceptar' }));
    expect(onLoginRequired).toHaveBeenCalled();
    expect(screen.queryByLabelText('Crea una contraseña')).not.toBeInTheDocument();
  });

  it.each([
    ['expired', /venció/i],
    ['accepted', /ya fue usada/i],
    ['canceled', /fue cancelada/i],
  ])('invitación %s: explica por qué no se puede usar', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...pending, status })));
    render(<AcceptInvitation invitationId="inv123" onJoined={vi.fn()} onLoginRequired={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('enlace inexistente', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 404)));
    render(<AcceptInvitation invitationId="nope" onJoined={vi.fn()} onLoginRequired={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no existe/i);
  });
});
