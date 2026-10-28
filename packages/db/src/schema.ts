import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Chwile czasu, z precyzją Date (milisekundy); okresy mają postać [od, do).
const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

export const accessManagementEvent = pgTable(
  'access_management_event',
  {
    operationId: uuid('operation_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    kind: text('kind', {
      enum: ['revoke_membership', 'reactivate_membership', 'grant', 'revoke_grant'],
    }).notNull(),
    grantId: uuid('grant_id'),
    occurredAt: instant('occurred_at').notNull(),
    requestKey: text('request_key').notNull(),
    // Wyłącznie jawne pola stanu; bez HTTP, tokenów i dokumentów.
    stateChange: jsonb('state_change')
      .$type<{ before: string; after: string; revokedGrants: number }>()
      .notNull(),
    receipt: jsonb('receipt').$type<import('@pap/application').AccessManagementReceipt>().notNull(),
  },
  (table) => [
    index('access_management_event_target_idx').on(table.tenantId, table.userId, table.occurredAt),
    check(
      'access_management_event_kind_check',
      sql`${table.kind} IN ('revoke_membership', 'reactivate_membership', 'grant', 'revoke_grant')`,
    ),
    check('access_management_event_time_check', sql`isfinite(${table.occurredAt})`),
  ],
);

export const tenant = pgTable(
  'tenant',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [check('tenant_name_not_blank', sql`btrim(${table.name}) <> ''`)],
);

export const legalEntity = pgTable(
  'legal_entity',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    displayName: text('display_name').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('legal_entity_tenant_id_id_unique').on(table.tenantId, table.id),
    check('legal_entity_name_not_blank', sql`btrim(${table.displayName}) <> ''`),
  ],
);

export const tenantMembership = pgTable(
  'tenant_membership',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    // Wewnętrzny UUID; mapowanie zweryfikowanej tożsamości OIDC powstanie w 6D.
    userId: uuid('user_id').notNull(),
    role: text('role', { enum: ['tenant_owner', 'tenant_admin', 'tenant_member'] }).notNull(),
    status: text('status', { enum: ['active', 'revoked'] }).notNull(),
    validFrom: instant('valid_from').notNull(),
    validUntil: instant('valid_until'),
  },
  (table) => [
    primaryKey({ name: 'tenant_membership_pk', columns: [table.tenantId, table.userId] }),
    check(
      'tenant_membership_role_check',
      sql`${table.role} IN ('tenant_owner', 'tenant_admin', 'tenant_member')`,
    ),
    check('tenant_membership_status_check', sql`${table.status} IN ('active', 'revoked')`),
    check(
      'tenant_membership_validity_check',
      sql`isfinite(${table.validFrom}) AND (${table.validUntil} IS NULL OR (isfinite(${table.validUntil}) AND ${table.validUntil} > ${table.validFrom}))`,
    ),
  ],
);

export const entityProfileVersion = pgTable(
  'entity_profile_version',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    // Wyłącznie etykieta techniczna, bez reguł i deklaracji zgodności podatkowej.
    profileCode: text('profile_code').notNull(),
    validFrom: instant('valid_from').notNull(),
    validUntil: instant('valid_until'),
  },
  (table) => [
    foreignKey({
      name: 'entity_profile_version_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('entity_profile_version_code_not_blank', sql`btrim(${table.profileCode}) <> ''`),
    check(
      'entity_profile_version_validity_check',
      sql`isfinite(${table.validFrom}) AND (${table.validUntil} IS NULL OR (isfinite(${table.validUntil}) AND ${table.validUntil} > ${table.validFrom}))`,
    ),
    index('entity_profile_version_lookup_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.validFrom,
    ),
    // EXCLUDE USING gist dla tej firmy i tstzrange(..., '[)') jest w jawnym SQL 0001.
    // Drizzle 0.45 nie odwzorowuje exclusion constraints w snapshotach.
  ],
);

export const companyAccessGrant = pgTable(
  'company_access_grant',
  {
    grantId: uuid('grant_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    action: text('action', { enum: ['read', 'write'] }).notNull(),
    validFrom: instant('valid_from').notNull(),
    validUntil: instant('valid_until'),
    revokedAt: instant('revoked_at'),
  },
  (table) => [
    foreignKey({
      name: 'company_access_grant_membership_fk',
      columns: [table.tenantId, table.userId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.userId],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'company_access_grant_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('company_access_grant_action_check', sql`${table.action} IN ('read', 'write')`),
    check(
      'company_access_grant_validity_check',
      sql`isfinite(${table.validFrom}) AND (${table.validUntil} IS NULL OR (isfinite(${table.validUntil}) AND ${table.validUntil} > ${table.validFrom}))`,
    ),
    // Cofnięcie może poprzedzać początek grantu (odwołanie przyszłego dostępu).
    check(
      'company_access_grant_revoked_at_check',
      sql`${table.revokedAt} IS NULL OR isfinite(${table.revokedAt})`,
    ),
    index('company_access_grant_lookup_idx').on(
      table.tenantId,
      table.userId,
      table.legalEntityId,
      table.action,
    ),
    index('company_access_grant_entity_idx').on(table.tenantId, table.legalEntityId),
  ],
);
