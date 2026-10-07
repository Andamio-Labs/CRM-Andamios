import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Esquema de NEGOCIO para consultas con Drizzle. La fuente de verdad del DDL son
 * los .sql de /migrations; esto solo describe las tablas para tener tipos.
 * Toda tabla con tenantId está protegida por RLS: consultala siempre con withTenant().
 */

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type BusinessHours = Record<DayKey, { from: string; to: string }[]>;

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: text('tenant_id').primaryKey(),
  timezone: text('timezone').notNull().default('America/Bogota'),
  currency: char('currency', { length: 3 }).notNull().default('COP'),
  locale: text('locale').notNull().default('es-CO'),
  businessHours: jsonb('business_hours').$type<BusinessHours>().notNull(),
  /** E01-S04: el vendedor solo ve lo asignado a él. */
  sellersSeeOnlyAssigned: boolean('sellers_see_only_assigned').notNull().default(false),
  /** E04-S10 */
  outOfHoursEnabled: boolean('out_of_hours_enabled').notNull().default(false),
  outOfHoursMessage: text('out_of_hours_message').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** E13-S05 — Solo texto cifrado. Usar siempre TenantSecrets, nunca leer esta tabla directo. */
export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.name] })],
);

export const subscriptions = pgTable('subscriptions', {
  tenantId: text('tenant_id').primaryKey(),
  plan: text('plan').notNull().default('trial'),
  status: text('status', { enum: ['trialing', 'active', 'past_due', 'read_only', 'canceled'] }).notNull(),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Sprint 2: E02 contactos ──────────────────────────────────────────────

export type CustomFieldValues = Record<string, string | number | string[] | null>;
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  tags: text('tags').array().notNull().default([]),
  notes: text('notes'),
  customFields: jsonb('custom_fields').$type<CustomFieldValues>().notNull().default({}),
  ownerId: text('owner_id'),
  createdBy: text('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  search: text('search'),
  /** E04-S09 */
  whatsappOptInAt: ts('whatsapp_opt_in_at'),
  whatsappOptInSource: text('whatsapp_opt_in_source'),
  whatsappOptOutAt: ts('whatsapp_opt_out_at'),
  /** X-07 / E09-S01 */
  source: text('source'),
  campaign: text('campaign'),
  priority: text('priority').$type<'critical' | 'high' | 'medium' | 'low'>(),
  kind: text('kind').$type<'person' | 'company'>().notNull().default('person'),
});

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  domain: text('domain'),
  ownerId: text('owner_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  search: text('search'),
});

export const contactCompanies = pgTable(
  'contact_companies',
  {
    tenantId: text('tenant_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    companyId: uuid('company_id').notNull(),
    jobTitle: text('job_title'),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.companyId] })],
);

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'currency';
export type CustomFieldEntity = 'contact' | 'deal';

export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  entity: text('entity').$type<CustomFieldEntity>().notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: text('type').$type<CustomFieldType>().notNull(),
  options: text('options').array().notNull().default([]),
  position: integer('position').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const savedViews = pgTable('saved_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  entity: text('entity').$type<CustomFieldEntity>().notNull(),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull(),
  ownerId: text('owner_id').notNull(),
  shared: boolean('shared').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── Sprint 2: E03 embudos y negocios ─────────────────────────────────────

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const stages = pgTable('stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#94a3b8'),
  position: integer('position').notNull().default(0),
});

export const closeReasons = pgTable('close_reasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  outcome: text('outcome').$type<'won' | 'lost'>().notNull(),
  label: text('label').notNull(),
  active: boolean('active').notNull().default(true),
});

export type DealStatus = 'open' | 'won' | 'lost';

export const deals = pgTable('deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  stageId: uuid('stage_id').notNull(),
  title: text('title').notNull(),
  value: numeric('value', { precision: 16, scale: 2 }).notNull().default('0'),
  currency: char('currency', { length: 3 }).notNull(),
  probability: integer('probability'),
  expectedCloseDate: date('expected_close_date'),
  ownerId: text('owner_id'),
  source: text('source'),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  status: text('status').$type<DealStatus>().notNull().default('open'),
  closeReasonId: uuid('close_reason_id'),
  closeNote: text('close_note'),
  closedAt: ts('closed_at'),
  position: doublePrecision('position').notNull().default(0),
  customFields: jsonb('custom_fields').$type<CustomFieldValues>().notNull().default({}),
  description: text('description'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const dealEvents = pgTable('deal_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: text('tenant_id').notNull(),
  dealId: uuid('deal_id').notNull(),
  type: text('type').notNull(),
  data: jsonb('data').notNull().default({}),
  actorId: text('actor_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── Sprint 3: E04 WhatsApp ───────────────────────────────────────────────

export const whatsappChannels = pgTable('whatsapp_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  wabaId: text('waba_id').notNull(),
  phoneNumberId: text('phone_number_id').notNull(),
  displayPhone: text('display_phone'),
  verifiedName: text('verified_name'),
  nameStatus: text('name_status'),
  qualityRating: text('quality_rating'),
  messagingLimit: text('messaging_limit'),
  status: text('status').$type<'connected' | 'disconnected' | 'error'>().notNull().default('connected'),
  connectedBy: text('connected_by'),
  connectedAt: ts('connected_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  assignedTo: text('assigned_to'),
  status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
  lastInboundAt: ts('last_inbound_at'),
  lastMessageAt: ts('last_message_at').notNull().defaultNow(),
  unreadCount: integer('unread_count').notNull().default(0),
  autoReplyAt: ts('auto_reply_at'),
  noReplyAlertedAt: ts('no_reply_alerted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  direction: text('direction').$type<'in' | 'out' | 'note'>().notNull(),
  waMessageId: text('wa_message_id'),
  type: text('type').notNull(),
  body: text('body'),
  media: jsonb('media'),
  status: text('status').$type<'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'internal'>().notNull(),
  error: jsonb('error'),
  sentBy: text('sent_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  statusUpdatedAt: ts('status_updated_at').notNull().defaultNow(),
});

// ── Sprint 4 ─────────────────────────────────────────────────────────────

export const whatsappTemplates = pgTable('whatsapp_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  wabaId: text('waba_id').notNull(),
  metaTemplateId: text('meta_template_id'),
  name: text('name').notNull(),
  language: text('language').notNull(),
  category: text('category').$type<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>().notNull(),
  body: text('body').notNull(),
  examples: text('examples').array().notNull().default([]),
  status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED'>().notNull().default('PENDING'),
  rejectionReason: text('rejection_reason'),
  createdBy: text('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const quickReplies = pgTable('quick_replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  shortcut: text('shortcut').notNull(),
  body: text('body').notNull(),
  createdBy: text('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── Sprint 5 ─────────────────────────────────────────────────────────────

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  dealId: uuid('deal_id'),
  contactId: uuid('contact_id'),
  assigneeId: text('assignee_id'),
  dueAt: ts('due_at'),
  remindBeforeMinutes: integer('remind_before_minutes'),
  remindedAt: ts('reminded_at'),
  status: text('status').$type<'open' | 'done'>().notNull().default('open'),
  completedAt: ts('completed_at'),
  createdBy: text('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: text('tenant_id').notNull(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  data: jsonb('data').notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  createdBy: text('created_by'),
  fileKey: text('file_key').notNull(),
  headers: text('headers').array().notNull(),
  mapping: jsonb('mapping').$type<Record<string, string>>(),
  status: text('status').$type<'uploaded' | 'processing' | 'done' | 'failed'>().notNull().default('uploaded'),
  totalRows: integer('total_rows').notNull().default(0),
  imported: integer('imported').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  reportKey: text('report_key'),
  createdAt: ts('created_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
});

export const waLinks = pgTable('wa_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  code: text('code').notNull(),
  phone: text('phone').notNull(),
  message: text('message').notNull(),
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  clicks: integer('clicks').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type AutomationRule = 'new_lead' | 'no_reply' | 'stage_template' | 'won_notify';

export const automationRules = pgTable(
  'automation_rules',
  {
    tenantId: text('tenant_id').notNull(),
    rule: text('rule').$type<AutomationRule>().notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.rule] })],
);

export const automationRuns = pgTable('automation_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: text('tenant_id').notNull(),
  rule: text('rule').notNull(),
  entityId: text('entity_id'),
  status: text('status').$type<'ok' | 'skipped' | 'error'>().notNull(),
  detail: text('detail'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tenantUsage = pgTable('tenant_usage', {
  tenantId: text('tenant_id').primaryKey(),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
});

/** Tabla de Better Auth: solo lectura de id y nombre para mostrar responsables. La gestiona identity. */
export const user = pgTable('user', { id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull() });
