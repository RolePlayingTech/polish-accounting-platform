import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { AccessManagementCommand } from '@pap/application';
import type { PostgresTransaction } from './transaction-primitives.js';

/** Asercja zaufanego serwera. Nigdy DTO klienta ani token OIDC. */
export interface DatabaseSecurityContext {
  readonly purpose:
    'actor' | 'facts' | 'company' | 'access' | 'identity' | 'audit' | 'access_event';
  readonly auditEvent?: Readonly<Record<string, unknown>>;
  readonly accessEvent?: Readonly<Record<string, unknown>>;
  readonly actorUserId?: string;
  readonly tenantId?: string;
  readonly legalEntityId?: string;
  readonly action?: 'read' | 'write';
  readonly targetUserId?: string;
  readonly command?: AccessManagementCommand;
  readonly decisionAt?: string;
  readonly operationId?: string;
  readonly issuer?: string;
  readonly subject?: string;
}

/** Klucz poza rolą SQL runtime; podział zaufania chroni przed samym arbitrary SQL. */
export class PostgresContextSigner {
  readonly #key: Buffer;
  readonly #keyId: string;

  constructor(config: { readonly keyId: string; readonly keyHex: string }) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(config.keyId) || !/^[a-f0-9]{64}$/i.test(config.keyHex)) {
      throw new Error('Niepoprawna konfiguracja podpisu kontekstu DB.');
    }
    this.#keyId = config.keyId;
    this.#key = Buffer.from(config.keyHex, 'hex');
  }

  async apply(tx: PostgresTransaction, context: DatabaseSecurityContext): Promise<void> {
    const [binding] = await tx.execute<{
      xid: string;
      pid: number;
      database: string;
      role: string;
      expires: string;
    }>(sql`SELECT pg_current_xact_id()::text AS xid, pg_backend_pid() AS pid,
      current_database() AS database, session_user::text AS role,
      (extract(epoch FROM clock_timestamp()) * 1000 + 30000)::bigint::text AS expires`);
    if (!binding) throw new Error('Brak powiązania kontekstu z transakcją.');
    const payload = JSON.stringify({
      version: 1,
      key_id: this.#keyId,
      ...binding,
      purpose: context.purpose,
      actor_user_id: context.actorUserId,
      tenant_id: context.tenantId,
      legal_entity_id: context.legalEntityId,
      action: context.action,
      target_user_id: context.targetUserId,
      command: context.command,
      decision_at: context.decisionAt,
      operation_id: context.operationId,
      issuer: context.issuer,
      subject: context.subject,
      audit_event: context.auditEvent,
      access_event: context.accessEvent,
    });
    const signature = createHmac('sha256', this.#key).update(payload, 'utf8').digest('hex');
    await tx.execute(sql`SELECT set_config('pap.context', ${payload}, true),
      set_config('pap.context_signature', ${signature}, true)`);
  }
}

export function loadDatabaseContextSigner(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PostgresContextSigner {
  return new PostgresContextSigner({
    keyId: env.PAP_DB_CONTEXT_KEY_ID ?? '',
    keyHex: env.PAP_DB_CONTEXT_KEY_HEX ?? '',
  });
}
