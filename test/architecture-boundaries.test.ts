import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function lintImport(relativeFilePath: string, importSource: string) {
  const code = `import { dependency } from '${importSource}';\nexport const usage = dependency;\n`;
  const [result] = await eslint.lintText(code, {
    filePath: resolve(repoRoot, relativeFilePath),
  });

  if (!result) {
    throw new Error(`Brak wyniku ESLint dla pliku ${relativeFilePath}`);
  }

  return result;
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

  it.each([
    { filePath: 'packages/domain/src/boundary-check.ts', importSource: '@pap/contracts' },
    { filePath: 'packages/domain/src/boundary-check.ts', importSource: './identifiers.js' },
    { filePath: 'packages/domain/src/boundary-check.ts', importSource: './db.js' },
    { filePath: 'packages/application/src/boundary-check.ts', importSource: '@pap/contracts' },
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
});
