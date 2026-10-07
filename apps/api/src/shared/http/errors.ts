import { HttpStatus } from '@nestjs/common';
import { AppError } from './app-error.js';

export const badRequest = (message: string) => new AppError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message);

/** Código de error de Postgres, venga directo de pg o envuelto por Drizzle. */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

export const isUniqueViolation = (error: unknown) => pgErrorCode(error) === '23505';
export const isForeignKeyViolation = (error: unknown) => pgErrorCode(error) === '23503';
