import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function lintCode(relativeFilePath: string, code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: resolve(repoRoot, relativeFilePath),
  });

  if (!result) {
    throw new Error(`Brak wyniku ESLint dla pliku ${relativeFilePath}`);
  }

  return result;
}

async function lintImport(relativeFilePath: string, importSource: string) {
  return lintCode(
    relativeFilePath,
    `import { dependency } from '${importSource}';\nexport const usage = dependency;\n`,
  );
}

describe('architecture dependency boundaries (eslint.config.mjs)', () => {
  beforeAll(async () => {
    await eslint.calculateConfigForFile(resolve(repoRoot, 'packages/domain/src/index.ts'));
  }, 30_000);

  it('blocks @nestjs/common imports in packages/domain', async () => {
    const result = await lintImport('packages/domain/src/boundary-check.ts', '@nestjs/common');

    expect(result.errorCount).toBe(1);
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        severity: 2,
        message: expect.stringContaining(
          'Domena pozostaje niezależna od frameworków, HTTP, bazy danych, ORM i transportu MCP.',
        ),
      }),
    ]);
  });

  it('blocks drizzle-orm imports in packages/domain', async () => {
    const result = await lintImport('packages/domain/src/boundary-check.ts', 'drizzle-orm');

    expect(result.errorCount).toBe(1);
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        severity: 2,
        message: expect.stringContaining(
          'Domena pozostaje niezależna od frameworków, HTTP, bazy danych, ORM i transportu MCP.',
        ),
      }),
    ]);
  });

  it.each([
    '@pap/db',
    '@pap/db/schema',
    '../../db',
    '../../db/src/index.js',
    '../../../packages/db/src/index.js',
    'next',
    'fastify',
    'node:http',
    'postgres',
    'postgres/cjs',
    '@modelcontextprotocol/server',
    'jose',
  ])('blocks %s imports in packages/domain', async (forbiddenSource) => {
    const result = await lintImport('packages/domain/src/boundary-check.ts', forbiddenSource);

    expect(result.errorCount).toBe(1);
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        severity: 2,
      }),
    ]);
  });

  it.each([
    '@nestjs/common',
    'fastify',
    '@pap/db',
    'drizzle-orm',
    'postgres',
    '@modelcontextprotocol/server',
    'jose',
  ])('blocks %s imports in packages/application', async (forbiddenSource) => {
    const result = await lintImport('packages/application/src/boundary-check.ts', forbiddenSource);

    expect(result.errorCount).toBe(1);
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        severity: 2,
        message: expect.stringContaining(
          'Warstwa aplikacji pozostaje niezależna od frameworków HTTP, bazy danych, ORM, bibliotek kryptograficznych OIDC i transportu MCP.',
        ),
      }),
    ]);
  });

  it.each([
    {
      filePath: 'packages/domain/boundary-check.ts',
      importSource: '../db/src/index.js',
    },
    {
      filePath: 'packages/domain/src/model/boundary-check.ts',
      importSource: '../../../db/src/index.js',
    },
  ])(
    'blocks relative packages/db import $importSource from $filePath',
    async ({ filePath, importSource }) => {
      const result = await lintImport(filePath, importSource);

      expect(result.errorCount).toBe(1);
      expect(result.messages).toEqual([
        expect.objectContaining({
          ruleId: 'no-restricted-imports',
          severity: 2,
        }),
      ]);
    },
  );

  it('blocks @pap/db imports in apps/web', async () => {
    const result = await lintImport('apps/web/lib/boundary-check.ts', '@pap/db');

    expect(result.errorCount).toBe(1);
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        severity: 2,
        message: expect.stringContaining(
          'Web korzysta z API i nie importuje bazy ani adapterów ORM.',
        ),
      }),
    ]);
  });

  it.each([
    '@pap/db/schema',
    '../../../packages/db',
    '../../../packages/db/src/index.js',
    'drizzle-orm',
    'pg',
    'postgres',
    'postgres/cjs',
  ])('blocks %s imports in apps/web', async (forbiddenSource) => {
    const result = await lintImport('apps/web/lib/boundary-check.ts', forbiddenSource);

    expect(result.errorCount).toBe(1);
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        severity: 2,
      }),
    ]);
  });

  it('blocks @pap/db imports in apps/mcp', async () => {
    const result = await lintImport('apps/mcp/src/boundary-check.ts', '@pap/db');

    expect(result.errorCount).toBe(1);
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        severity: 2,
        message: expect.stringContaining(
          'Adapter MCP korzysta z API/use-case i nie importuje bazy ani ORM.',
        ),
      }),
    ]);
  });

  it.each([
    '@pap/db/schema',
    '../../../packages/db',
    '../../../packages/db/src/index.js',
    'drizzle-orm',
    'postgres',
    'postgres/cjs',
  ])('blocks %s imports in apps/mcp', async (forbiddenSource) => {
    const result = await lintImport('apps/mcp/src/boundary-check.ts', forbiddenSource);

    expect(result.errorCount).toBe(1);
    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        severity: 2,
      }),
    ]);
  });

  describe('NEG-SEC04-05: blocks context signer and raw transaction adapter imports in apps/api outside composition root', () => {
    it.each([
      'PostgresContextSigner',
      'loadDatabaseContextSigner',
      'PostgresTransactionalUnitOfWork',
      'runManagedTransaction',
      'connectDatabase',
      'createPostgresSecurityServices',
      'provisionDatabaseContextKey',
      'configureRuntimePrivileges',
      'PostgresAccessManagementStore',
      'PostgresSecurityAudit',
      'PostgresCompanyActionScopeDriver',
      'createPostgresCompanyActionScope',
      'createPostgresAccountingScope',
      'PostgresWebSessionStore',
      'PostgresIdentityLifecycleStore',
    ])(
      'blocks direct value and type imports of %s from @pap/db in controllers and guards',
      async (restrictedSymbol) => {
        for (const targetFile of [
          'apps/api/src/company.controller.ts',
          'apps/api/src/auth/company-access.guard.ts',
        ]) {
          const valueResult = await lintCode(
            targetFile,
            `import { ${restrictedSymbol} } from '@pap/db';\nexport const ref = ${restrictedSymbol};\n`,
          );
          expect(valueResult.errorCount).toBe(1);
          expect(valueResult.messages).toEqual([
            expect.objectContaining({
              ruleId: 'no-restricted-imports',
              severity: 2,
              message: expect.stringContaining(
                'Kontrolery, guardy i serwisy HTTP nie mogą bezpośrednio importować signera kontekstu ani adaptera UnitOfWork/transakcji',
              ),
            }),
          ]);

          const typeResult = await lintCode(
            targetFile,
            `import type { ${restrictedSymbol} } from '@pap/db';\nexport type Ref = ${restrictedSymbol};\n`,
          );
          expect(typeResult.errorCount).toBe(1);
          expect(typeResult.messages[0]?.ruleId).toBe('no-restricted-imports');
        }
      },
    );

    it('blocks namespace import * as db from @pap/db and deep @pap/db/* or drizzle-orm/postgres imports in apps/api controllers', async () => {
      const namespaceResult = await lintCode(
        'apps/api/src/company.controller.ts',
        `import * as db from '@pap/db';\nexport const ref = db;\n`,
      );
      expect(namespaceResult.errorCount).toBe(1);
      expect(namespaceResult.messages[0]?.ruleId).toBe('no-restricted-imports');

      for (const deepSource of [
        '@pap/db/transaction-primitives',
        '../../../packages/db/src/transaction-primitives.js',
        'drizzle-orm',
        'postgres',
      ]) {
        const deepResult = await lintImport('apps/api/src/company.controller.ts', deepSource);
        expect(deepResult.errorCount).toBe(1);
        expect(deepResult.messages[0]?.ruleId).toBe('no-restricted-imports');
      }
    });

    it.each([
      'apps/api/src/app.module.ts',
      'apps/api/src/main.ts',
      'apps/api/src/runtime/security-bootstrap.ts',
    ])('allows composition root wiring in %s', async (compositionRootFile) => {
      const result = await lintCode(
        compositionRootFile,
        `import { PostgresTransactionalUnitOfWork, loadDatabaseContextSigner, createPostgresAccountingScope } from '@pap/db';\nexport const wiring = [PostgresTransactionalUnitOfWork, loadDatabaseContextSigner, createPostgresAccountingScope];\n`,
      );
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });
  });

  it.each([
    { filePath: 'packages/domain/src/boundary-check.ts', importSource: '@pap/contracts' },
    { filePath: 'packages/domain/src/boundary-check.ts', importSource: './identifiers.js' },
    { filePath: 'packages/domain/src/boundary-check.ts', importSource: './db.js' },
    { filePath: 'packages/application/src/boundary-check.ts', importSource: '@pap/contracts' },
    { filePath: 'apps/api/src/company.controller.ts', importSource: '@pap/db' },
    { filePath: 'apps/web/lib/boundary-check.ts', importSource: '@pap/contracts' },
    { filePath: 'apps/web/lib/boundary-check.ts', importSource: '@pap/ui' },
    { filePath: 'apps/mcp/src/boundary-check.ts', importSource: '@pap/contracts' },
    { filePath: 'apps/mcp/src/boundary-check.ts', importSource: '@pap/application' },
  ])('allows valid import $importSource in $filePath', async ({ filePath, importSource }) => {
    const result = await lintImport(filePath, importSource);

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.messages).toEqual([]);
  });

  describe('#117: blocks hardcoded demo company codes and switchers in apps/web UI surfaces', () => {
    function collectUiFiles(dirPath: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const full = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (full.endsWith('/apps/web/app/api')) continue;
          results.push(...collectUiFiles(full));
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          results.push(full);
        }
      }
      return results;
    }

    it('forbids demo_jdg_*, demo_spzoo_*, demoCompanyCode, switchToDemo*, and COMPANY_JDG_*/COMPANY_SPZOO_* in apps/web/{app,components} UI', () => {
      const uiFiles = [
        ...collectUiFiles(resolve(repoRoot, 'apps/web/app')),
        ...collectUiFiles(resolve(repoRoot, 'apps/web/components')),
      ];
      expect(uiFiles.length).toBeGreaterThan(20);

      const forbiddenPattern =
        /\b(demo_jdg_kpir_alfa|demo_jdg_ryczalt_beta|demo_spzoo_gamma|demoCompanyCode|switchToDemoSpzoo|switchToDemoRyczalt|switchToDemoKpir|COMPANY_JDG_KPIR_ID|COMPANY_JDG_RYCZALT_ID|COMPANY_SPZOO_ID)\b/;

      const violations: string[] = [];
      for (const filePath of uiFiles) {
        const text = readFileSync(filePath, 'utf8');
        const match = forbiddenPattern.exec(text);
        if (match) {
          violations.push(`${filePath.slice(repoRoot.length + 1)}: found "${match[1]}"`);
        }
      }

      expect(violations).toEqual([]);
    });
  });
});
