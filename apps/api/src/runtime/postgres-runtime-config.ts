import { createHash } from 'node:crypto';
import type { AccessManagementStore } from '@pap/application';
import {
  DatabaseConfigError,
  PostgresContextSigner,
  PostgresSecurityAudit,
  PostgresTenantAuthorizationDataSource,
  PostgresTransactionalUnitOfWork,
  PostgresUserIdentityResolver,
  assertRuntimeDatabaseSecurity,
  connectDatabase,
  createPostgresAccountingScope,
  createPostgresSecurityServices,
  loadDatabaseContextSigner,
  type DatabaseEnvironment,
  type PostgresAccountingScope,
  type PostgresSecurityServices,
} from '@pap/db';

export const DEFAULT_CONTEXT_KEY_ID = 'pap-api-runtime-context' as const;
const VALID_KEY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
const HEX_64_PATTERN = /^[0-9a-fA-F]{64}$/;

export interface DatabaseContextKeyMaterial {
  readonly keyId: string;
  readonly keyHex: string;
}

export function hasConfiguredDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return Boolean(env.DATABASE_URL && env.DATABASE_URL.trim().length > 0);
}

export function resolveDatabaseEnvName(
  env: Readonly<Record<string, string | undefined>>,
): DatabaseEnvironment {
  const explicit = env.PAP_DATABASE_ENV?.trim();
  if (explicit && explicit.length > 0) {
    if (explicit !== 'local' && explicit !== 'test' && explicit !== 'staging') {
      throw new DatabaseConfigError(
        `Nieobsługiwana wartość PAP_DATABASE_ENV (${explicit}); oczekiwano local, test lub staging.`,
      );
    }
    return explicit;
  }

  const rawUrl = env.DATABASE_URL?.trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const dbName = parsed.pathname.replace(/^\//, '');
      if (dbName === 'pap_local') return 'local';
      if (dbName === 'pap_test') return 'test';
      if (dbName === 'pap_staging') return 'staging';
    } catch {
      // Błąd składni URL zostanie odrzucony przez connectDatabase z komunikatem po polsku.
    }
  }

  throw new DatabaseConfigError(
    'Brak zmiennej PAP_DATABASE_ENV (local | test | staging) dla skonfigurowanego DATABASE_URL.',
  );
}

export function resolveDatabaseDataSchema(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const explicit = env.PAP_DB_SCHEMA?.trim();
  return explicit && explicit.length > 0 ? explicit : 'public';
}

export function resolveDatabaseContextKeyMaterial(
  envOrSecret: string | Readonly<Record<string, string | undefined>>,
): DatabaseContextKeyMaterial {
  if (typeof envOrSecret === 'string') {
    return resolveDatabaseContextKeyMaterial({ PAP_DB_CONTEXT_SECRET: envOrSecret });
  }

  const explicitKeyHex = envOrSecret.PAP_DB_CONTEXT_KEY_HEX?.trim();
  if (explicitKeyHex && explicitKeyHex.length > 0) {
    const keyId = envOrSecret.PAP_DB_CONTEXT_KEY_ID?.trim() || DEFAULT_CONTEXT_KEY_ID;
    // Walidacja przez kanoniczny loader @pap/db (rzuca DatabaseConfigError przy złym formacie).
    loadDatabaseContextSigner({
      PAP_DB_CONTEXT_KEY_ID: keyId,
      PAP_DB_CONTEXT_KEY_HEX: explicitKeyHex.toLowerCase(),
    });
    return Object.freeze({
      keyId,
      keyHex: explicitKeyHex.toLowerCase(),
    });
  }

  const rawSecret = envOrSecret.PAP_DB_CONTEXT_SECRET?.trim();
  if (rawSecret && rawSecret.length > 0) {
    const colonIdx = rawSecret.indexOf(':');
    if (colonIdx > 0) {
      const candidateKeyId = rawSecret.slice(0, colonIdx).trim();
      const candidateHex = rawSecret.slice(colonIdx + 1).trim();
      if (VALID_KEY_ID_PATTERN.test(candidateKeyId) && HEX_64_PATTERN.test(candidateHex)) {
        return Object.freeze({
          keyId: candidateKeyId,
          keyHex: candidateHex.toLowerCase(),
        });
      }
    }

    const fallbackKeyId = envOrSecret.PAP_DB_CONTEXT_KEY_ID?.trim() || DEFAULT_CONTEXT_KEY_ID;
    if (!VALID_KEY_ID_PATTERN.test(fallbackKeyId)) {
      throw new DatabaseConfigError(
        'Niepoprawny identyfikator klucza podpisu kontekstu DB (PAP_DB_CONTEXT_KEY_ID).',
      );
    }

    if (HEX_64_PATTERN.test(rawSecret)) {
      return Object.freeze({
        keyId: fallbackKeyId,
        keyHex: rawSecret.toLowerCase(),
      });
    }

    if (envOrSecret.PAP_DATABASE_ENV?.trim() !== 'test') {
      throw new DatabaseConfigError(
        'Poza środowiskiem PAP_DATABASE_ENV=test sekret podpisu kontekstu DB (PAP_DB_CONTEXT_SECRET lub PAP_DB_CONTEXT_KEY_HEX) musi być pełnym 256-bitowym kluczem szesnastkowym (64 znaki hex lub <keyId>:<64-hex>).',
      );
    }

    if (rawSecret.length < 16) {
      throw new DatabaseConfigError(
        'Sekret PAP_DB_CONTEXT_SECRET w środowisku testowym musi mieć co najmniej 16 znaków (lub 64 znaki szesnastkowe).',
      );
    }

    const derivedHex = createHash('sha256').update(rawSecret, 'utf8').digest('hex');
    return Object.freeze({
      keyId: fallbackKeyId,
      keyHex: derivedHex,
    });
  }

  // Brak zarówno PAP_DB_CONTEXT_KEY_HEX, jak i PAP_DB_CONTEXT_SECRET — delegujemy błąd fail-closed.
  loadDatabaseContextSigner(envOrSecret);
  throw new DatabaseConfigError(
    'Brak sekretu podpisu kontekstu DB (PAP_DB_CONTEXT_SECRET lub PAP_DB_CONTEXT_KEY_ID + PAP_DB_CONTEXT_KEY_HEX).',
  );
}

export function createContextPayloadSigner(
  envOrSecret: string | Readonly<Record<string, string | undefined>>,
): PostgresContextSigner {
  const material = resolveDatabaseContextKeyMaterial(envOrSecret);
  return new PostgresContextSigner(material);
}

export interface ConnectedPostgresRuntime {
  readonly databaseEnv: DatabaseEnvironment;
  readonly dataSchema: string;
  readonly connection: ReturnType<typeof connectDatabase>;
  readonly signer: PostgresContextSigner;
  readonly keyMaterial: DatabaseContextKeyMaterial;
  readonly securityServices: PostgresSecurityServices<PostgresAccountingScope>;
  readonly accessManagementStore: AccessManagementStore;
  close(): Promise<void>;
}

export async function connectPostgresRuntime(
  env: Readonly<Record<string, string | undefined>>,
): Promise<ConnectedPostgresRuntime> {
  const databaseEnv = resolveDatabaseEnvName(env);
  const enforceSecurity = env.PAP_ENFORCE_RUNTIME_DB_SECURITY !== 'false';
  if (!enforceSecurity && databaseEnv !== 'test') {
    throw new DatabaseConfigError(
      'Wyłączenie kontroli bezpieczeństwa roli runtime (PAP_ENFORCE_RUNTIME_DB_SECURITY=false) jest dozwolone wyłącznie w środowisku PAP_DATABASE_ENV=test.',
    );
  }
  const dataSchema = resolveDatabaseDataSchema(env);
  const keyMaterial = resolveDatabaseContextKeyMaterial(env);
  const signer = new PostgresContextSigner(keyMaterial);

  const connection = connectDatabase(
    {
      ...env,
      PAP_DATABASE_ENV: databaseEnv,
    },
    dataSchema,
    { roleScope: 'runtime' },
  );

  try {
    let securityServices: PostgresSecurityServices<PostgresAccountingScope>;

    if (enforceSecurity) {
      await assertRuntimeDatabaseSecurity(connection.db);
      securityServices = await createPostgresSecurityServices(
        connection.db,
        signer,
        createPostgresAccountingScope,
      );
    } else {
      const unitOfWork = new PostgresTransactionalUnitOfWork(
        connection.db,
        signer,
        createPostgresAccountingScope,
      );
      securityServices = Object.freeze({
        unitOfWork,
        accessManagementStore: unitOfWork.createAccessManagementStore(),
        identityResolver: new PostgresUserIdentityResolver(connection.db, signer),
        authorizationDataSource: new PostgresTenantAuthorizationDataSource(connection.db, signer),
        securityAudit: new PostgresSecurityAudit(connection.db, signer),
      });
    }

    const accessManagementStore = securityServices.accessManagementStore;
    let closePromise: Promise<void> | null = null;

    return Object.freeze({
      databaseEnv,
      dataSchema,
      connection,
      signer,
      keyMaterial,
      securityServices,
      accessManagementStore,
      close(): Promise<void> {
        closePromise ??= connection.client.end({ timeout: 5 }).then(() => undefined);
        return closePromise;
      },
    });
  } catch (error) {
    await connection.client.end({ timeout: 2 }).catch(() => undefined);
    throw error;
  }
}
