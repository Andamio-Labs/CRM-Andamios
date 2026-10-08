import { describe, expect, it } from 'vitest';
import { aiPauseState, formatUsd, OUTCOMES } from './ai-format';

describe('formatUsd (E05-S08)', () => {
  it('muestra centavos de dólar con 4 decimales cuando el costo es muy chico', () => {
    expect(formatUsd(748)).toMatch(/0,0007/);
    expect(formatUsd(0)).toMatch(/0,00/);
  });
  it('y con 2 decimales desde un centavo', () => {
    expect(formatUsd(1_500_000)).toMatch(/1,50/);
  });
});

describe('aiPauseState (E05-S05)', () => {
  const now = new Date('2026-10-08T12:00:00Z');

  it('sin pausa o con la pausa vencida, la IA está activa', () => {
    expect(aiPauseState({ aiPausedUntil: null, aiPauseReason: null }, now)).toEqual({ paused: false });
    expect(aiPauseState({ aiPausedUntil: '2026-10-08T11:00:00Z', aiPauseReason: 'human_reply' }, now)).toEqual({ paused: false });
  });

  it('una persona respondió: pausa con vencimiento', () => {
    expect(aiPauseState({ aiPausedUntil: '2026-10-09T12:00:00Z', aiPauseReason: 'human_reply' }, now))
      .toEqual({ paused: true, reason: 'human_reply', until: new Date('2026-10-09T12:00:00Z') });
  });

  it('traspaso, freno de seguridad o pausa manual: hasta reanudar (fecha centinela 9999)', () => {
    for (const reason of ['handoff', 'guardrail', 'manual'] as const) {
      expect(aiPauseState({ aiPausedUntil: '9999-12-31T00:00:00.000Z', aiPauseReason: reason }, now)).toEqual({ paused: true, reason, until: null });
    }
  });
});

describe('OUTCOMES', () => {
  it('cada resultado del registro tiene etiqueta y tono', () => {
    expect(Object.keys(OUTCOMES).sort()).toEqual(['blocked', 'error', 'handoff', 'quota', 'replied']);
  });
});
