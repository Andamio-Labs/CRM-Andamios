import { BadRequestException, Body, type PipeTransform, Query } from '@nestjs/common';
import type { z } from 'zod';

export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

/** `@ZodBody(schema)` valida y tipa el body con un esquema Zod. */
export const ZodBody = (schema: z.ZodType) => Body(new ZodValidationPipe(schema));

/** `@ZodQuery(schema)` valida y tipa todo el query string. */
export const ZodQuery = (schema: z.ZodType) => Query(new ZodValidationPipe(schema));
