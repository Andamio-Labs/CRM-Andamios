import { describe, expect, it } from 'vitest';
import { matchQuickReplies, renderQuickReply, templateVariableCount } from './quick-replies';

const replies = [
  { id: '1', shortcut: 'saludo', body: 'Hola {{contact.name}}, soy {{user.name}}.' },
  { id: '2', shortcut: 'horario', body: 'Atendemos de 8 a 6.' },
  { id: '3', shortcut: 'saldo', body: 'Tu saldo es…' },
];

/** E04-S08 — Respuestas rápidas con atajo "/" y variables del contacto. */
describe('matchQuickReplies', () => {
  it('sugiere solo cuando el texto empieza con /', () => {
    expect(matchQuickReplies('hola', replies)).toEqual([]);
    expect(matchQuickReplies('/', replies).map((r) => r.shortcut)).toEqual(['saludo', 'horario', 'saldo']);
  });
  it('filtra por prefijo del atajo, sin importar mayúsculas', () => {
    expect(matchQuickReplies('/SAL', replies).map((r) => r.shortcut)).toEqual(['saludo', 'saldo']);
    expect(matchQuickReplies('/zzz', replies)).toEqual([]);
  });
  it('deja de sugerir cuando hay espacio (ya es un mensaje)', () => {
    expect(matchQuickReplies('/saludo y algo más', replies)).toEqual([]);
  });
});

describe('renderQuickReply', () => {
  it('completa variables del contacto y del usuario', () => {
    expect(renderQuickReply(replies[0]!.body, { contact: { name: 'Ana Gómez', phone: '+57300' }, user: { name: 'Luis' } })).toBe('Hola Ana Gómez, soy Luis.');
  });
  it('deja visible una variable desconocida para que se note', () => {
    expect(renderQuickReply('Hola {{contact.apellido}}', { contact: { name: 'Ana', phone: null }, user: { name: 'L' } })).toBe('Hola {{contact.apellido}}');
  });
});

describe('templateVariableCount', () => {
  it('cuenta hasta la variable más alta', () => {
    expect(templateVariableCount('Hola {{1}}, cita el {{2}}')).toBe(2);
    expect(templateVariableCount('Sin variables')).toBe(0);
  });
});
