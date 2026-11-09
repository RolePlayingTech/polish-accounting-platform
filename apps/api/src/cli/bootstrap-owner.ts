import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OwnerBootstrapError } from '../runtime/owner-bootstrap-runtime.js';
import { createApiRuntimeServicesAsync } from '../runtime/workspace-runtime.js';

export interface BootstrapOwnerCliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const FLAG_TO_FIELD: Readonly<Record<string, string>> = {
  '--issuer': 'issuer',
  '--subject': 'subject',
  '--display-name': 'displayName',
  '--email': 'email',
  '--tenant-name': 'tenantName',
  '--tenant-id': 'tenantId',
  '--user-id': 'userId',
  '--operation-id': 'operationId',
  '--reason': 'reason',
};

export function parseBootstrapOwnerCliArgs(argv: readonly string[]): Record<string, unknown> {
  let payload: Record<string, unknown> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

    if (arg === '--json-file') {
      const filePath = argv[i + 1];
      if (!filePath || filePath.startsWith('--')) {
        throw new OwnerBootstrapError(
          400,
          'invalid_bootstrap_request',
          'Flaga --json-file wymaga ścieżki do pliku JSON.',
        );
      }
      i += 1;
      let parsedFile: unknown;
      try {
        parsedFile = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch {
        throw new OwnerBootstrapError(
          400,
          'invalid_bootstrap_request',
          'Nie udało się odczytać lub sparsować pliku JSON przekazanego w --json-file.',
        );
      }
      if (typeof parsedFile !== 'object' || parsedFile === null || Array.isArray(parsedFile)) {
        throw new OwnerBootstrapError(
          400,
          'invalid_bootstrap_request',
          'Plik --json-file musi zawierać obiekt JSON żądania bootstrapu właściciela.',
        );
      }
      payload = { ...(parsedFile as Record<string, unknown>), ...payload };
      continue;
    }

    if (arg === '--initial-company-json') {
      const rawCompany = argv[i + 1];
      if (!rawCompany) {
        throw new OwnerBootstrapError(
          400,
          'invalid_bootstrap_request',
          'Flaga --initial-company-json wymaga poprawnego obiektu JSON.',
        );
      }
      i += 1;
      try {
        payload['initialCompany'] = JSON.parse(rawCompany);
      } catch {
        throw new OwnerBootstrapError(
          400,
          'invalid_bootstrap_request',
          'Niepoprawny format JSON w argumencie --initial-company-json.',
        );
      }
      continue;
    }

    const mappedField = FLAG_TO_FIELD[arg];
    if (mappedField) {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        throw new OwnerBootstrapError(
          400,
          'invalid_bootstrap_request',
          `Brak wartości dla wymaganego argumentu CLI ${arg}.`,
        );
      }
      i += 1;
      payload[mappedField] = val;
      continue;
    }

    throw new OwnerBootstrapError(
      400,
      'invalid_bootstrap_request',
      `Nieznany argument CLI: ${arg}.`,
    );
  }

  return payload;
}

export async function runBootstrapOwnerCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
  io: BootstrapOwnerCliIo = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  },
): Promise<number> {
  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = parseBootstrapOwnerCliArgs(argv);
  } catch (err) {
    if (err instanceof OwnerBootstrapError) {
      io.stderr(
        JSON.stringify({
          ok: false,
          statusCode: err.statusCode,
          reasonCode: err.reasonCode,
          message: err.message,
        }),
      );
      return 2;
    }
    io.stderr(
      JSON.stringify({
        ok: false,
        statusCode: 500,
        reasonCode: 'bootstrap_cli_failed',
        message: 'Błąd parsowania parametrów CLI jednorazowego bootstrapu właściciela.',
      }),
    );
    return 1;
  }

  const effectiveEnv: Readonly<Record<string, string | undefined>> = {
    ...env,
    PAP_SEED_SYNTHETIC_DEMO: env['PAP_SEED_SYNTHETIC_DEMO'] ?? 'false',
  };

  let runtime: Awaited<ReturnType<typeof createApiRuntimeServicesAsync>> | undefined;
  try {
    runtime = await createApiRuntimeServicesAsync(effectiveEnv);
    const receipt = await runtime.ownerBootstrap.bootstrapInitialOwner(parsedPayload);
    io.stdout(JSON.stringify(receipt));
    return 0;
  } catch (err) {
    if (err instanceof OwnerBootstrapError) {
      io.stderr(
        JSON.stringify({
          ok: false,
          statusCode: err.statusCode,
          reasonCode: err.reasonCode,
          message: err.message,
        }),
      );
      return err.statusCode === 409 ? 3 : 2;
    }
    io.stderr(
      JSON.stringify({
        ok: false,
        statusCode: 503,
        reasonCode: 'bootstrap_store_unavailable',
        message:
          'Nie udało się wykonać jednorazowego bootstrapu właściciela (sprawdź połączenie z bazą danych i konfigurację klucza kontekstu).',
      }),
    );
    return 1;
  } finally {
    if (runtime?.close) {
      await runtime.close().catch(() => undefined);
    }
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runBootstrapOwnerCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
