import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  configureRuntimePrivileges,
  connectDatabase,
  provisionDatabaseContextKey,
} from '@pap/db';
import { AppModule } from '../../src/app.module.js';
import { runBootstrapOwnerCli } from '../../src/cli/bootstrap-owner.js';
import { createApiRuntimeServices } from '../../src/runtime/workspace-runtime.js';
import { startIsolatedOidcIdp, type IsolatedOidcIdpHandle } from './isolated-oidc-idp.js';

const E2E_IDP_PORT = Number(process.env['PAP_E2E_OIDC_IDP_PORT'] ?? '42608');
const E2E_API_PORT_A = Number(process.env['PAP_E2E_API_PORT_A'] ?? '41608');
const E2E_API_PORT_B = Number(process.env['PAP_E2E_API_PORT_B'] ?? '41609');
const E2E_WEB_CALLBACK_URI =
  process.env['PAP_E2E_WEB_CALLBACK_URI'] ?? 'http://localhost:31608/api/session/oidc/callback';
const E2E_WEB_SESSION_SECRET =
  process.env['PAP_WEB_SESSION_SECRET'] ?? 'pap-e2e-oidc-shared-bff-session-secret-key-min-32b!!';

interface DrizzleJournalFile {
  readonly entries: readonly {
    readonly idx: number;
    readonly tag: string;
  }[];
}

async function applySqlMigrationsToSchema(
  ownerClient: ReturnType<typeof connectDatabase>['client'],
): Promise<void> {
  const drizzleDir = fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url));
  const journalRaw = readFileSync(`${drizzleDir}/meta/_journal.json`, 'utf8');
  const journal = JSON.parse(journalRaw) as DrizzleJournalFile;
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of ordered) {
    const sqlText = readFileSync(`${drizzleDir}/${entry.tag}.sql`, 'utf8');
    const statements = sqlText
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    await ownerClient.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
      }
    });
  }
}

async function main(): Promise<void> {
  let idp: IsolatedOidcIdpHandle | undefined;
  let appA: NestFastifyApplication | undefined;
  let appB: NestFastifyApplication | undefined;
  let ownerDb: ReturnType<typeof connectDatabase> | undefined;
  let dataSchema = '';
  let shuttingDown = false;

  const cleanup = async (exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await appB?.close().catch(() => undefined);
    await appA?.close().catch(() => undefined);
    await idp?.close().catch(() => undefined);
    if (ownerDb) {
      if (dataSchema) {
        await ownerDb.client`DROP SCHEMA IF EXISTS ${ownerDb.client(dataSchema)} CASCADE`.catch(
          () => undefined,
        );
      }
      await ownerDb.close().catch(() => undefined);
    }
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => {
    void cleanup(0);
  });
  process.on('SIGINT', () => {
    void cleanup(0);
  });

  try {
    idp = await startIsolatedOidcIdp({
      port: E2E_IDP_PORT,
      interactiveConsentInBrowser: true,
      clientId: 'pap-web',
      resourceAudience: 'pap-api',
      allowedRedirectUris: [E2E_WEB_CALLBACK_URI],
    });

    idp.registerUser({
      subject: 'e2e-anna-owner-sub',
      email: 'anna.wlascicielka@syntetyczny.example',
      emailVerified: true,
      displayName: 'Anna Właścicielka',
    });
    idp.registerUser({
      subject: 'e2e-ewa-ksiegowa-sub',
      email: 'ewa.ksiegowa@syntetyczny.example',
      emailVerified: true,
      displayName: 'Ewa Księgowa',
    });
    idp.registerUser({
      subject: 'e2e-marek-obcy-sub',
      email: 'marek.obcy@syntetyczny.example',
      emailVerified: true,
      displayName: 'Marek Niezaproszony',
    });

    const hasPostgres = Boolean(
      process.env['DATABASE_URL'] && process.env['PAP_EPHEMERAL_RUNTIME_DATABASE_URL'],
    );
    if (process.env['PAP_REQUIRE_POSTGRES_E2E'] === 'true' && !hasPostgres) {
      throw new Error(
        'Wymagano PAP_REQUIRE_POSTGRES_E2E=true, lecz brak DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
      );
    }

    const baseApiEnv: Record<string, string> = {
      NODE_ENV: 'test',
      PAP_RUNTIME_MODE: 'STAGING_PRIVATE',
      PAP_SANDBOX_AUTH_ENABLED: 'false',
      PAP_SEED_SYNTHETIC_DEMO: 'false',
      PAP_OIDC_ENV: 'test',
      PAP_OIDC_ISSUER: idp.issuer,
      PAP_OIDC_JWKS_URI: idp.jwksUri,
      PAP_OIDC_AUDIENCE: idp.resourceAudience,
      PAP_OIDC_ALLOWED_CLIENT_IDS: idp.clientId,
      PAP_WEB_SESSION_SECRET: E2E_WEB_SESSION_SECRET,
    };

    let tenantId = '';
    let ownerUserId = '';

    if (hasPostgres) {
      const runtimeUrl = process.env['PAP_EPHEMERAL_RUNTIME_DATABASE_URL']!.trim();
      const keyId = 'pap-e2e-oidc-ctx';
      const keyHex = randomBytes(32).toString('hex');
      dataSchema = `pap_test_${randomUUID().replaceAll('-', '')}`;

      ownerDb = connectDatabase(process.env, dataSchema, { roleScope: 'migrator' });
      await ownerDb.client`CREATE SCHEMA ${ownerDb.client(dataSchema)}`;
      await applySqlMigrationsToSchema(ownerDb.client);

      const runtimeUser = new URL(runtimeUrl).username;
      await configureRuntimePrivileges(ownerDb.client, dataSchema, runtimeUser);
      await provisionDatabaseContextKey(ownerDb.client, {
        keyId,
        secretHex: keyHex,
        runtimeRole: runtimeUser,
      });

      baseApiEnv['PAP_DATABASE_ENV'] = 'test';
      baseApiEnv['DATABASE_URL'] = runtimeUrl;
      baseApiEnv['PAP_DB_SCHEMA'] = dataSchema;
      baseApiEnv['PAP_DB_CONTEXT_KEY_ID'] = keyId;
      baseApiEnv['PAP_DB_CONTEXT_KEY_HEX'] = keyHex;
      baseApiEnv['PAP_ENFORCE_RUNTIME_DB_SECURITY'] = 'true';

      const cliOut: string[] = [];
      const cliErr: string[] = [];
      const rc = await runBootstrapOwnerCli(
        [
          '--issuer',
          idp.issuer,
          '--subject',
          'e2e-anna-owner-sub',
          '--display-name',
          'Anna Właścicielka',
          '--email',
          'anna.wlascicielka@syntetyczny.example',
          '--tenant-name',
          'Kancelaria Właścicielska E2E',
          '--reason',
          'Jednorazowy bootstrap właściciela dla testu E2E pojedynczego logowania OIDC',
        ],
        baseApiEnv,
        {
          stdout: (l) => cliOut.push(l),
          stderr: (l) => cliErr.push(l),
        },
      );
      if (rc !== 0 || cliOut.length === 0) {
        throw new Error(`Bootstrap CLI zwrócił kod ${String(rc)}: ${cliErr.join(' ')}`);
      }
      const receipt = JSON.parse(cliOut[0]!) as { tenantId: string; userId: string };
      tenantId = receipt.tenantId;
      ownerUserId = receipt.userId;

      appA = await NestFactory.create<NestFastifyApplication>(
        AppModule.register(baseApiEnv),
        new FastifyAdapter({ logger: false }),
        { logger: false },
      );
      await appA.listen(E2E_API_PORT_A, '127.0.0.1');

      appB = await NestFactory.create<NestFastifyApplication>(
        AppModule.register(baseApiEnv),
        new FastifyAdapter({ logger: false }),
        { logger: false },
      );
      await appB.listen(E2E_API_PORT_B, '127.0.0.1');
    } else {
      const sharedServices = createApiRuntimeServices(baseApiEnv);
      const receipt = await sharedServices.ownerBootstrap.bootstrapInitialOwner({
        issuer: idp.issuer,
        subject: 'e2e-anna-owner-sub',
        displayName: 'Anna Właścicielka',
        email: 'anna.wlascicielka@syntetyczny.example',
        tenantName: 'Kancelaria Właścicielska E2E',
        reason: 'Jednorazowy bootstrap właściciela dla lokalnego testu E2E',
      });
      tenantId = receipt.tenantId;
      ownerUserId = receipt.userId;

      appA = await NestFactory.create<NestFastifyApplication>(
        AppModule.register(baseApiEnv, sharedServices),
        new FastifyAdapter({ logger: false }),
        { logger: false },
      );
      await appA.listen(E2E_API_PORT_A, '127.0.0.1');
    }

    process.stdout.write(
      `E2E_OIDC_STACK_READY ${JSON.stringify({
        mode: hasPostgres ? 'postgres' : 'memory',
        idpIssuer: idp.issuer,
        apiBaseUrlA: `http://127.0.0.1:${String(E2E_API_PORT_A)}`,
        apiBaseUrlB: hasPostgres ? `http://127.0.0.1:${String(E2E_API_PORT_B)}` : null,
        tenantId,
        ownerUserId,
      })}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `E2E_OIDC_STACK_ERROR ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    await cleanup(1);
  }
}

void main();
