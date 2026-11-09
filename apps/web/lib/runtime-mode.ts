import { RuntimeModeSchema, type RuntimeMode } from '@pap/contracts';

export type { RuntimeMode };

export class RuntimeModeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeModeConfigError';
  }
}

/**
 * Rozstrzyga kanoniczny tryb uruchomieniowy `PAP_RUNTIME_MODE` (ADR-011).
 *
 * Zasady fail-closed:
 * - Nieznana wartość `PAP_RUNTIME_MODE` rzuca `RuntimeModeConfigError`.
 * - W `NODE_ENV === 'production'` brak ustawionego `PAP_RUNTIME_MODE` domyślnie przyjmuje `'PRODUCTION'`
 *   (nigdy nie włącza niejawnie `LOCAL_DEV`), a próba ustawienia `LOCAL_DEV` w `NODE_ENV=production`
 *   jest odrzucana wyjątkiem `RuntimeModeConfigError`.
 * - Poza `NODE_ENV === 'production'` brak `PAP_RUNTIME_MODE` przyjmuje `'LOCAL_DEV'`.
 */
export function resolveWebRuntimeMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeMode {
  const raw = env['PAP_RUNTIME_MODE']?.trim();
  const isNodeProduction = env['NODE_ENV'] === 'production';

  if (!raw) {
    return isNodeProduction ? 'PRODUCTION' : 'LOCAL_DEV';
  }

  const parsed = RuntimeModeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RuntimeModeConfigError(
      `Nieznana wartość PAP_RUNTIME_MODE="${raw}". Dozwolone: LOCAL_DEV, STAGING_PRIVATE, PUBLIC_DEMO, PRODUCTION.`,
    );
  }

  if (parsed.data === 'LOCAL_DEV' && isNodeProduction) {
    throw new RuntimeModeConfigError(
      'Tryb PAP_RUNTIME_MODE=LOCAL_DEV jest niedozwolony, gdy NODE_ENV=production (ochrona fail-closed).',
    );
  }

  return parsed.data;
}

/**
 * Syntetyczny selektor person testowych i ciasteczka `pap_oidc_token`/`pap_session_ctx`
 * są dozwolone wyłącznie w jawnym lokalnym trybie deweloperskim (`LOCAL_DEV` poza `NODE_ENV=production`).
 */
export function isSyntheticPersonaLoginAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  try {
    const mode = resolveWebRuntimeMode(env);
    return mode === 'LOCAL_DEV' && env['NODE_ENV'] !== 'production';
  } catch {
    return false;
  }
}

/**
 * Określa, czy ciasteczka sesji BFF muszą posiadać atrybut `Secure`.
 * Zawsze `true` w `NODE_ENV=production`, dla protokołu `https:` oraz we wszystkich trybach innych niż `LOCAL_DEV`
 * (chyba że środowisko testowe Vitest/HTTP loopback działa bez TLS w `NODE_ENV=test` z `PAP_ALLOW_HTTP_LOOPBACK_TEST_COOKIES=true`).
 */
export function shouldUseSecureSessionCookie(
  requestUrl?: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env['NODE_ENV'] === 'production') {
    return true;
  }
  if (requestUrl) {
    try {
      const parsed = new URL(requestUrl);
      if (parsed.protocol === 'https:') {
        return true;
      }
      if (
        env['NODE_ENV'] === 'test' &&
        env['PAP_ALLOW_HTTP_LOOPBACK_TEST_COOKIES'] === 'true' &&
        (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      ) {
        return false;
      }
    } catch {
      return true;
    }
  }

  try {
    const mode = resolveWebRuntimeMode(env);
    if (mode !== 'LOCAL_DEV') {
      return true;
    }
  } catch {
    return true;
  }

  return false;
}
