import { HttpException, HttpStatus } from '@nestjs/common';

/** Error de negocio con código estable para el front (el mensaje es para humanos, el code para máquinas). */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ code, message }, status);
  }
}
