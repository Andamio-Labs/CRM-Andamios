export interface LlmPrices {
  /** USD por millón de tokens de entrada. */
  inputPerMTok: number;
  /** USD por millón de tokens de salida. */
  outputPerMTok: number;
}

/** E05-S08 — Costo en millonésimas de dólar: USD por millón de tokens = micro-USD por token. */
export function costMicros(inputTokens: number, outputTokens: number, prices: LlmPrices): number {
  return Math.round(inputTokens * prices.inputPerMTok + outputTokens * prices.outputPerMTok);
}
