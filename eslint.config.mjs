import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
  {
    files: ['packages/domain/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                '@nestjs/*',
                'fastify',
                '@fastify/*',
                'http',
                'node:http',
                'https',
                'node:https',
                '@pap/db',
                '@pap/db/*',
                '**/packages/db',
                '**/packages/db/**',
                'drizzle-orm',
                'drizzle-orm/*',
                '@modelcontextprotocol/*',
              ],
              message:
                'Domena pozostaje niezależna od frameworków, HTTP, bazy danych, ORM i transportu MCP.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@pap/db',
                '@pap/db/*',
                '**/packages/db',
                '**/packages/db/**',
                'drizzle-orm',
                'drizzle-orm/*',
                'pg',
                'pg/*',
              ],
              message: 'Web korzysta z API i nie importuje bazy ani adapterów ORM.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/mcp/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@pap/db',
                '@pap/db/*',
                '**/packages/db',
                '**/packages/db/**',
                'drizzle-orm',
                'drizzle-orm/*',
              ],
              message: 'Adapter MCP korzysta z API/use-case i nie importuje bazy ani ORM.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/*.config.mjs',
    'next-env.d.ts',
  ]),
]);
