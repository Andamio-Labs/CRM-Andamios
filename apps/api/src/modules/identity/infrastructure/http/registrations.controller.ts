import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ZodBody } from '../../../../shared/http/zod-validation.pipe.js';
import { RegisterCompany, type RegisterCompanyInput, registerCompanySchema } from '../../application/register-company.js';

@Controller('v1/registrations')
export class RegistrationsController {
  constructor(private readonly registerCompany: RegisterCompany) {}

  /** 202 siempre que los datos sean válidos: no revela si el correo ya existía. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@ZodBody(registerCompanySchema) input: RegisterCompanyInput, @Req() req: Request) {
    await this.registerCompany.execute(input, { ip: req.ip, userAgent: req.headers['user-agent'] });
    return { message: 'Te enviamos un correo para confirmar tu cuenta.' };
  }
}
