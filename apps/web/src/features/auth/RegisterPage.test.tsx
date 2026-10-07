import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegisterForm } from './RegisterPage';

describe('RegisterForm (E01-S01)', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function fill(overrides: Partial<Record<'company' | 'name' | 'email' | 'password', string>> = {}, acceptLegal = true) {
    const user = userEvent.setup();
    const v = { company: 'Clínica Sonrisas', name: 'Ana Gómez', email: 'ana@clinica.co', password: 'Colombia2026!', ...overrides };
    await user.type(screen.getByLabelText('Nombre de la empresa'), v.company);
    await user.type(screen.getByLabelText('Tu nombre'), v.name);
    await user.type(screen.getByLabelText('Correo'), v.email);
    await user.type(screen.getByLabelText('Contraseña'), v.password);
    if (acceptLegal) await user.click(screen.getByRole('checkbox', { name: /acepto los términos/i }));
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  }

  it('envía el registro y pide revisar el correo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'ok' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm />);

    await fill();

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/registrations', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      companyName: 'Clínica Sonrisas', name: 'Ana Gómez', email: 'ana@clinica.co', password: 'Colombia2026!', acceptLegal: true,
    });
    expect(await screen.findByText(/revisa tu correo/i)).toBeInTheDocument();
  });

  it('no envía si la contraseña es corta', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm />);

    await fill({ password: 'corta' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/al menos 10 caracteres/i)).toBeInTheDocument();
  });

  it('no envía sin aceptar términos y privacidad (E13-S01)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm />);

    await fill({}, false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/debes aceptar/i)).toBeInTheDocument();
  });

  it('muestra un error entendible si el servidor falla', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    render(<RegisterForm />);

    await fill();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos crear tu cuenta/i);
  });
});
