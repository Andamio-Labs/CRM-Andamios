import { Inject, Module } from '@nestjs/common';
import type { JobHandler } from '../../shared/queue/bull-queue.js';
import { JOB_HANDLERS } from '../../shared/queue/queue.module.js';
import { BillingModule } from '../billing/plan.service.js';
import { DataTransferService, type ImportJob } from './application/data-transfer.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { CompaniesService } from './application/companies.service.js';
import { ConsentsService } from './application/consents.service.js';
import { ContactsService } from './application/contacts.service.js';
import { CustomFieldsService } from './application/custom-fields.service.js';
import { TimelineService } from './application/timeline.service.js';
import { SearchService, ViewsService } from './application/views-search.service.js';
import { CompaniesController, ContactsController, CustomFieldsController, DataTransferController, SearchController, ViewsController } from './contacts.controllers.js';

/** E02 — Contactos y organizaciones. */
@Module({
  imports: [IdentityModule, TenancyModule, BillingModule],
  controllers: [ContactsController, CompaniesController, CustomFieldsController, ViewsController, SearchController, DataTransferController],
  providers: [ContactsService, CompaniesService, CustomFieldsService, ViewsService, SearchService, TimelineService, DataTransferService, ConsentsService],
  exports: [ContactsService, CustomFieldsService],
})
export class ContactsModule {
  constructor(@Inject(JOB_HANDLERS) handlers: Record<string, JobHandler>, transfer: DataTransferService) {
    handlers['contacts.import'] = (data: ImportJob) => transfer.process(data);
  }
}
