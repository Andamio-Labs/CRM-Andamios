import { Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuditView, NoAudit } from '../../shared/http/audit.js';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodBody, ZodQuery } from '../../shared/http/zod-validation.pipe.js';
import { type AuthContext, CurrentAuth, PermissionGuard, RequirePermission, SessionGuard } from '../identity/infrastructure/http/session.guard.js';
import { CompaniesService, companySchema, linkSchema } from './application/companies.service.js';
import { ConsentsService, recordConsentSchema } from './application/consents.service.js';
import { ContactsService, createContactRequestSchema, listContactsSchema, updateContactSchema } from './application/contacts.service.js';
import { createFieldSchema, CustomFieldsService, entitySchema, updateFieldSchema } from './application/custom-fields.service.js';
import { DataTransferService, exportEntitySchema, startImportSchema } from './application/data-transfer.service.js';
import { consentSchema, TimelineService, timelineQuerySchema } from './application/timeline.service.js';
import { createViewSchema, SearchService, searchSchema, ViewsService } from './application/views-search.service.js';

const entityQuery = entitySchema.default('contact');
const mergeSchema = z.object({ duplicateId: z.uuid() }).strict();

@Controller('v1/contacts')
@UseGuards(SessionGuard, PermissionGuard)
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly timelineService: TimelineService,
    private readonly consents: ConsentsService,
  ) {}

  @Get() @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext, @ZodQuery(listContactsSchema) query: z.infer<typeof listContactsSchema>) {
    return this.contacts.list(auth, query);
  }

  @Get('stats') @RequirePermission('records:read')
  stats(@CurrentAuth() auth: AuthContext) {
    return this.contacts.stats(auth);
  }

  @Get(':id') @AuditView() @RequirePermission('records:read')
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.contacts.get(auth, id);
  }

  @Post() @RequirePermission('records:write')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createContactRequestSchema) body: z.infer<typeof createContactRequestSchema>) {
    return this.contacts.create(auth, body);
  }

  @Post(':id/merge') @HttpCode(HttpStatus.OK) @NoAudit() @RequirePermission('records:delete')
  merge(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(mergeSchema) body: z.infer<typeof mergeSchema>) {
    return this.contacts.merge(auth, id, body.duplicateId);
  }

  @Patch(':id') @RequirePermission('records:write')
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateContactSchema) body: z.infer<typeof updateContactSchema>) {
    return this.contacts.update(auth, id, body);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:delete')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.contacts.remove(auth, id);
  }

  @Get(':id/timeline') @AuditView() @RequirePermission('records:read')
  timeline(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodQuery(timelineQuerySchema) query: z.infer<typeof timelineQuerySchema>) {
    return this.timelineService.timeline(auth, id, query);
  }

  @Patch(':id/consent') @RequirePermission('records:write')
  consent(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(consentSchema) body: z.infer<typeof consentSchema>) {
    return this.timelineService.consent(auth, id, body);
  }

  @Get(':id/consents') @AuditView() @RequirePermission('records:read')
  listConsents(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.consents.list(auth, id);
  }

  @Post(':id/consents') @RequirePermission('records:write')
  recordConsent(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(recordConsentSchema) body: z.infer<typeof recordConsentSchema>) {
    return this.consents.record(auth, id, body);
  }
}

@Controller('v1/companies')
@UseGuards(SessionGuard, PermissionGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get() @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext) {
    return this.companies.list(auth);
  }

  @Get(':id') @AuditView() @RequirePermission('records:read')
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.companies.get(auth, id);
  }

  @Post() @RequirePermission('records:write')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(companySchema) body: z.infer<typeof companySchema>) {
    return this.companies.create(auth, body);
  }

  @Patch(':id') @RequirePermission('records:write')
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(companySchema.partial()) body: Partial<z.infer<typeof companySchema>>) {
    return this.companies.update(auth, id, body);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:delete')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.companies.remove(auth, id);
  }

  @Put(':id/contacts/:contactId') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:write')
  link(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Param('contactId') contactId: string, @ZodBody(linkSchema) body: z.infer<typeof linkSchema>) {
    return this.companies.link(auth, id, contactId, body);
  }

  @Delete(':id/contacts/:contactId') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:write')
  unlink(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Param('contactId') contactId: string) {
    return this.companies.unlink(auth, id, contactId);
  }
}

@Controller('v1/custom-fields')
@UseGuards(SessionGuard, PermissionGuard)
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get() @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext, @Query('entity') entity?: string) {
    return this.fields.list(auth, entityQuery.parse(entity));
  }

  @Post() @RequirePermission('fields:manage')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createFieldSchema) body: z.infer<typeof createFieldSchema>) {
    return this.fields.create(auth, body);
  }

  @Patch(':id') @RequirePermission('fields:manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(updateFieldSchema) body: z.infer<typeof updateFieldSchema>) {
    return this.fields.update(auth, id, body);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('fields:manage')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.fields.remove(auth, id);
  }
}

@Controller('v1/views')
@UseGuards(SessionGuard, PermissionGuard)
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get() @RequirePermission('records:read')
  list(@CurrentAuth() auth: AuthContext, @Query('entity') entity?: string) {
    return this.views.list(auth, entityQuery.parse(entity));
  }

  @Post() @RequirePermission('records:read')
  create(@CurrentAuth() auth: AuthContext, @ZodBody(createViewSchema) body: z.infer<typeof createViewSchema>) {
    return this.views.create(auth, body);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission('records:read')
  remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.views.remove(auth, id);
  }
}

@Controller('v1/search')
@UseGuards(SessionGuard, PermissionGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get() @RequirePermission('records:read')
  search(@CurrentAuth() auth: AuthContext, @ZodQuery(searchSchema) { q }: z.infer<typeof searchSchema>) {
    return this.searchService.search(auth, q);
  }
}

@Controller('v1')
@UseGuards(SessionGuard, PermissionGuard)
export class DataTransferController {
  constructor(private readonly transfer: DataTransferService) {}

  @Post('imports') @RequirePermission('data:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(@CurrentAuth() auth: AuthContext, @UploadedFile() file?: { originalname: string; mimetype: string; buffer: Buffer }) {
    return this.transfer.upload(auth, file);
  }

  @Post('imports/:id/start') @HttpCode(HttpStatus.OK) @RequirePermission('data:import')
  start(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ZodBody(startImportSchema) body: z.infer<typeof startImportSchema>) {
    return this.transfer.start(auth, id, body);
  }

  @Get('imports/:id') @RequirePermission('data:import')
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.transfer.get(auth, id);
  }

  @Get('exports/:file') @RequirePermission('data:export')
  async export(@CurrentAuth() auth: AuthContext, @Param('file') file: string, @Req() req: Request, @Res() res: Response) {
    const entity = exportEntitySchema.safeParse(file.replace(/\.csv$/, ''));
    if (!entity.success || !file.endsWith('.csv')) throw new NotFoundException();
    const csv = await this.transfer.export(auth, entity.data, req.ip);
    const date = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${entity.data}-${date}.csv"` });
    res.send(`\uFEFF${csv}`); // BOM: Excel abre bien las tildes
  }
}
