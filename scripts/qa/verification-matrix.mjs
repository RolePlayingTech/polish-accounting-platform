// Wersjonowana macierz weryfikacji oparta na ryzyku (Issue #85, ADR-006, internal-development-merge-policy.md).
// Mapuje zmienione ścieżki plików na powierzchnie ryzyka (a)-(e), wymagane testy (w tym jawnie
// @pap/db test:integration ORAZ @pap/api test:integration) oraz bramki decyzji Merge-to-Main vs Release GO.

export const VERIFICATION_MATRIX_VERSION = '2026-11-08.1';

export const FORBIDDEN_BRANCH_NAMES = Object.freeze([
  'HEAD',
  'main',
  'master',
  'codex/astra-critical-review-gemini-plan',
]);

/**
 * Definicje powierzchni ryzyka zgodnie z Issue #85 Sekcja 1:
 * (a) db_transaction_provisioning
 * (b) oidc_rls_tenant
 * (c) money_legal_rules
 * (d) mcp_import
 * (e) docs_dormant
 * + governance_infra_alert (zmiany w AGENTS.md, .github/workflows, skryptach Hetzner, infra)
 */
export const RISK_SURFACES = Object.freeze({
  db_transaction_provisioning: {
    id: 'db_transaction_provisioning',
    code: 'a',
    label: 'DB / Transakcje / UnitOfWork / Provisioning / Persystencja Runtime',
    riskLevel: 'high',
    requiresHetznerPgIntegration: true,
    requiresBothDbAndApiIntegration: true,
    requiresAdversarialSuite: true,
    requiresIndependentReview: true,
    negativeScenarios: [
      'Dwie instancje API ładują tę samą firmę F, a następnie naprzemiennie zapisują i czytają bez restartu (#79)',
      'Wstrzymana transakcja i potwierdzony ROLLBACK nigdy nie ujawniają niezatwierdzonego stanu czytelnikom (#79)',
      '20 równoległych żądań utworzenia firmy o tym samym NIP -> dokładnie 1 sukces (201) i przewidywalne 409 bez częściowego stanu (#80)',
      'Utrata potwierdzenia COMMIT -> fail-closed transaction_outcome_unknown (503) i bezpieczne ponowienie z tym samym kluczem idempotencji',
      'Powtórzenie tego samego klucza idempotencji z innym payloadem -> 409 Conflict',
      'Brak fallbacku do uprzywilejowanego PAP_MIGRATOR_DATABASE_URL w runtime API',
    ],
  },
  oidc_rls_tenant: {
    id: 'oidc_rls_tenant',
    code: 'b',
    label: 'OIDC / Sesja BFF / FORCE RLS / Autoryzacja Tenantów / Audyt Bezpieczeństwa',
    riskLevel: 'high',
    requiresHetznerPgIntegration: true,
    requiresBothDbAndApiIntegration: true,
    requiresAdversarialSuite: true,
    requiresIndependentReview: true,
    negativeScenarios: [
      'Odmowa dostępu cross-tenant (403) i natychmiastowa blokada po cofnięciu członkostwa lub grantu (6D-R)',
      'Brak wycieku kontekstu pap.context przy reużyciu połączenia z puli dla innego tenanta',
      'Awaria zapisu security_decision_event przerywa transakcję i wycofuje efekt biznesowy',
      'Odrzucenie nagłówków spoofujących (x-user-id, x-tenant-id -> 401) i wygasłych/niepoprawnych tokenów JWT',
    ],
  },
  money_legal_rules: {
    id: 'money_legal_rules',
    code: 'c',
    label: 'Arytmetyka Pieniężna / Reguły Podatkowe i Księgowe / Kontrakty',
    riskLevel: 'high',
    requiresHetznerPgIntegration: false,
    requiresBothDbAndApiIntegration: false,
    requiresAdversarialSuite: false,
    requiresIndependentReview: true,
    negativeScenarios: [
      'Zakaz float/number dla kwot pieniężnych; odrzucenie kwot przekraczających bezpieczny zakres groszy (400)',
      'Odrzucenie niezbilansowanego dekretu Wn !== Ma (422) oraz zapisu w zamkniętym okresie',
      'Reguła unverified rzuca UnverifiedLegalRuleError (fail-closed); rozstrzyganie wersji na dzień zdarzenia (resolveRuleAtDate)',
    ],
  },
  mcp_import: {
    id: 'mcp_import',
    code: 'd',
    label: 'Serwer MCP / Parser Importu Dokumentów (KSeF/CSV/MT940) / Powiadomienia',
    riskLevel: 'high',
    requiresHetznerPgIntegration: false,
    requiresBothDbAndApiIntegration: false,
    requiresAdversarialSuite: false,
    requiresIndependentReview: true,
    negativeScenarios: [
      'Neutralizacja prompt injection i znaczników Unicode Bidi w polach zaimportowanych faktur',
      'Zakaz samo-zatwierdzenia propozycji przez token agenta MCP (403 agent_self_approval_forbidden)',
      'Odrzucenie XML z DTD/XXE (400) i duplikatu SHA-256 dokumentu (409)',
    ],
  },
  docs_dormant: {
    id: 'docs_dormant',
    code: 'e',
    label: 'Dokumentacja / ADR / Narzędzia QA / Kod nieaktywny',
    riskLevel: 'low',
    requiresHetznerPgIntegration: false,
    requiresBothDbAndApiIntegration: false,
    requiresAdversarialSuite: false,
    requiresIndependentReview: false,
    negativeScenarios: [
      'Brak przypadkowych sekretów, niezamaskowanych identyfikatorów wolumenów (HC_Volume_*) i adresów IP',
      'Spójność granic architektonicznych i brak niezamierzonych zmian w kodzie wykonawczym',
    ],
  },
  governance_infra_alert: {
    id: 'governance_infra_alert',
    code: 'gov',
    label: 'Polityka Projektu / Workflow CI / Runner Hetzner / Infrastruktura',
    riskLevel: 'critical_governance',
    requiresHetznerPgIntegration: false,
    requiresBothDbAndApiIntegration: false,
    requiresAdversarialSuite: false,
    requiresIndependentReview: true,
    negativeScenarios: [
      'Automatyczne wyzwalacze GitHub Actions (.github/workflows/ci.yml) muszą pozostać wyłączone',
      'Skrypt efemerycznego PG18 na Hetznerze wymusza limity cgroups v2, loopback 127.0.0.1 i pełne sprzątanie',
    ],
  },
});

function normalizeRepoPath(rawPath) {
  return String(rawPath).replaceAll('\\', '/').replace(/^\.\//, '').trim();
}

/**
 * Klasyfikuje pojedynczą ścieżkę pliku do jednej lub więcej powierzchni ryzyka.
 */
export function classifyFilePath(rawPath) {
  const path = normalizeRepoPath(rawPath);
  if (!path) {
    return [];
  }

  const matched = new Set();

  // Alert governance / infra
  if (
    path === 'AGENTS.md' ||
    path.startsWith('.github/') ||
    path.startsWith('scripts/hetzner/') ||
    path.startsWith('infra/') ||
    path === 'compose.yaml'
  ) {
    matched.add('governance_infra_alert');
  }

  const isQaHarnessFile =
    path.startsWith('scripts/qa/') ||
    path === 'test/qa-gate.test.ts' ||
    path === 'vitest.config.ts' ||
    path === 'apps/api/vitest.adversarial.config.ts' ||
    path.startsWith('apps/api/test/adversarial/') ||
    path === 'apps/api/test/tsconfig.json' ||
    path === 'apps/api/package.json' ||
    path === 'package.json';

  // Dokumentacja i narzędzia QA (powierzchnia e)
  if (
    path === 'README.md' ||
    path === 'SECURITY.md' ||
    path === 'CONTRIBUTING.md' ||
    path.startsWith('docs/') ||
    isQaHarnessFile
  ) {
    matched.add('docs_dormant');
  }

  // (a) DB / Transakcje / Provisioning / Persystencja Runtime (wszystkie aktywne ścieżki DB, application i API)
  if (
    path.startsWith('packages/db/') ||
    path.startsWith('packages/application/src/') ||
    path.startsWith('packages/application/test/') ||
    path.startsWith('apps/api/src/') ||
    (path.startsWith('apps/api/test/') &&
      !path.startsWith('apps/api/test/adversarial/') &&
      path !== 'apps/api/test/tsconfig.json')
  ) {
    matched.add('db_transaction_provisioning');
  }

  // (b) OIDC / RLS / Tenant / Audyt
  if (
    path.startsWith('apps/api/src/auth/') ||
    path === 'apps/web/lib/session.ts' ||
    path === 'packages/application/src/oidc-authentication.ts' ||
    path === 'packages/application/src/tenant-authorization.ts' ||
    path === 'packages/application/src/access-management.ts' ||
    path === 'packages/application/src/security-audit.ts' ||
    path === 'packages/db/src/runtime-security.ts' ||
    path === 'packages/db/src/signed-context.ts' ||
    path === 'packages/db/src/security-audit.ts' ||
    path === 'packages/db/src/tenant-authorization.ts' ||
    path === 'packages/db/src/access-management.ts' ||
    path === 'packages/db/src/user-identity.ts' ||
    path === 'packages/db/src/transactional-unit-of-work.ts' ||
    path === 'packages/db/src/transaction-primitives.ts' ||
    path.startsWith('packages/db/drizzle/') ||
    path.startsWith('packages/db/sql/')
  ) {
    matched.add('oidc_rls_tenant');
  }

  // (c) Arytmetyka pieniężna / Reguły prawne / Kontrakty
  if (path.startsWith('packages/domain/') || path.startsWith('packages/contracts/')) {
    matched.add('money_legal_rules');
  }

  // (d) MCP / Import / Powiadomienia
  if (
    path.startsWith('apps/mcp/') ||
    path.startsWith('apps/api/src/mcp/') ||
    path === 'packages/application/src/mcp-gateway.ts' ||
    path === 'packages/application/src/document-import-parsers.ts' ||
    path === 'packages/application/src/notifications-engine.ts'
  ) {
    matched.add('mcp_import');
  }

  // Pozostałe pliki wykonywalne (np. apps/web, packages/ui)
  if (matched.size === 0) {
    if (path.endsWith('.md')) {
      matched.add('docs_dormant');
    } else if (path.startsWith('apps/web/') || path.startsWith('packages/ui/')) {
      matched.add('oidc_rls_tenant');
    } else {
      matched.add('docs_dormant');
    }
  }

  return Array.from(matched);
}

/**
 * Wyznacza pełny plan weryfikacji dla zestawu zmienionych plików.
 */
export function classifyChangedFiles(rawPaths) {
  const normalizedFiles = Array.from(
    new Set((rawPaths ?? []).map(normalizeRepoPath).filter((p) => p.length > 0)),
  ).sort();

  const surfaceIds = new Set();
  for (const file of normalizedFiles) {
    for (const surfaceId of classifyFilePath(file)) {
      surfaceIds.add(surfaceId);
    }
  }

  if (surfaceIds.size === 0) {
    surfaceIds.add('docs_dormant');
  }

  const orderedSurfaceIds = [
    'db_transaction_provisioning',
    'oidc_rls_tenant',
    'money_legal_rules',
    'mcp_import',
    'governance_infra_alert',
    'docs_dormant',
  ].filter((id) => surfaceIds.has(id));

  const surfaces = orderedSurfaceIds.map((id) => RISK_SURFACES[id]);
  const touchesMigrations = normalizedFiles.some(
    (f) => f.startsWith('packages/db/drizzle/') || f.startsWith('packages/db/sql/'),
  );
  const touchesGovernanceOrInfra = surfaceIds.has('governance_infra_alert');
  const touchesQaHarness = normalizedFiles.some(
    (f) =>
      f.startsWith('scripts/qa/') ||
      f.startsWith('apps/api/test/adversarial/') ||
      f === 'apps/api/vitest.adversarial.config.ts' ||
      f === 'test/qa-gate.test.ts',
  );

  const requiresHetznerPgIntegration = surfaces.some((s) => s.requiresHetznerPgIntegration);
  const requiresBothDbAndApiIntegration = requiresHetznerPgIntegration;
  const requiresAdversarialSuite = surfaces.some((s) => s.requiresAdversarialSuite);
  const requiresIndependentReview =
    surfaces.some((s) => s.requiresIndependentReview) || touchesQaHarness;
  const requiresOwnerApproval = touchesMigrations || touchesGovernanceOrInfra;

  let riskLevel = 'low';
  if (touchesGovernanceOrInfra || touchesMigrations) {
    riskLevel = 'critical_governance';
  } else if (surfaces.some((s) => s.riskLevel === 'high')) {
    riskLevel = 'high';
  }

  const requiredChecks = [
    {
      id: 'git_preflight_and_secret_scan',
      description:
        'Higiena gałęzi Git, merge-base względem origin/main, git diff --check i skan sekretów',
      command: 'node scripts/qa/preflight.mjs',
      environment: 'local',
      mandatoryForMergeToMain: true,
    },
    {
      id: 'architecture_boundaries',
      description: 'Granice architektoniczne monorepo (ESLint no-restricted-imports)',
      command: 'pnpm test:arch',
      environment: 'local',
      mandatoryForMergeToMain: true,
    },
  ];

  const touchesCodeOrConfig = normalizedFiles.some((f) => !f.endsWith('.md'));
  if (touchesCodeOrConfig) {
    requiredChecks.push(
      {
        id: 'typecheck_and_lint',
        description: 'Kontrola typów TypeScript i lintera ESLint zmienionych pakietów',
        command: 'pnpm typecheck && pnpm lint',
        environment: 'local',
        mandatoryForMergeToMain: true,
      },
      {
        id: 'unit_tests',
        description: 'Testy jednostkowe i kontraktowe Vitest',
        command: 'pnpm test',
        environment: 'local',
        mandatoryForMergeToMain: true,
      },
    );
  }

  if (requiresBothDbAndApiIntegration) {
    requiredChecks.push(
      {
        id: 'hetzner_pg18_db_integration',
        description:
          'Testy integracyjne @pap/db na izolowanym PostgreSQL 18.6 (migracje, FORCE RLS, NOBYPASSRLS, UoW, audyt)',
        command: 'pnpm --filter @pap/db test:integration',
        environment: 'hetzner-ephemeral-pg18',
        mandatoryForMergeToMain: true,
      },
      {
        id: 'hetzner_pg18_api_integration',
        description:
          'Testy integracyjne @pap/api na izolowanym PostgreSQL 18.6 (REST, MCP, spójność wieloinstancyjna, provisioning)',
        command: 'pnpm --filter @pap/api test:integration',
        environment: 'hetzner-ephemeral-pg18',
        mandatoryForMergeToMain: true,
      },
    );
  }

  if (requiresAdversarialSuite) {
    requiredChecks.push({
      id: 'hetzner_pg18_adversarial_regressions',
      description:
        'Testy kontrprzykładów i regresji adversarial (#79 spójność 2 instancji, #80 współbieżny provisioning NIP i atomowość)',
      command: 'pnpm --filter @pap/api test:adversarial',
      environment: 'hetzner-ephemeral-pg18',
      mandatoryForMergeToMain: true,
    });
  }

  const negativeScenarios = Array.from(
    new Set(surfaces.flatMap((surface) => surface.negativeScenarios)),
  );

  return {
    matrixVersion: VERIFICATION_MATRIX_VERSION,
    changedFiles: normalizedFiles,
    surfaces: orderedSurfaceIds,
    riskLevel,
    touchesMigrations,
    touchesGovernanceOrInfra,
    requiresHetznerPgIntegration,
    requiresBothDbAndApiIntegration,
    requiresAdversarialSuite,
    requiresIndependentReview,
    requiresOwnerApproval,
    requiredChecks,
    negativeScenarios,
    releaseGateDistinction: {
      internalMergeToMain:
        riskLevel === 'low'
          ? 'Proporcjonalny odbiór wewnętrzny: wystarcza preflight, kontrola granic i przegląd diffu (bez wymogu uruchamiania PG18 ani E2E).'
          : 'Wymagane celowane testy jednostkowe, oba zestawy integracyjne (@pap/db ORAZ @pap/api) na izolowanym Hetznerze PG18 na końcowym SHA oraz niezależny review.',
      stagingBetaProduction:
        'Scalenie do main NIE jest zgodą na wdrożenie ani dowodem gotowości produkcyjnej. Staging/Beta/Produkcja wymagają osobnej zgody właściciela, domknięcia fal 1–4, podpisu doradcy podatkowego i pełnego release manifestu.',
    },
  };
}

/**
 * Skanuje tekst pod kątem przypadkowych sekretów, kluczy prywatnych, tokenów
 * oraz niezamaskowanych identyfikatorów infrastruktury Hetzner.
 */
export function scanTextForAccidentalSecretsAndLeaks(rawFilePath, content) {
  const filePath = normalizeRepoPath(rawFilePath);
  const findings = [];
  const text = String(content ?? '');

  const isSelfScannerOrTest =
    filePath === 'scripts/qa/verification-matrix.mjs' ||
    filePath === 'test/hetzner-ephemeral-pg18.test.ts' ||
    filePath === 'test/qa-gate.test.ts';

  const rules = [
    {
      id: 'private_key_block',
      regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
      message: 'Wykryto blok klucza prywatnego PEM.',
      allowInTestMocks: false,
    },
    {
      id: 'github_or_mumro_token',
      regex: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|smm_[A-Za-z0-9_-]{16,})\b/,
      message: 'Wykryto token dostępowy (GitHub PAT lub Mumro API key).',
      allowInTestMocks: false,
    },
    {
      id: 'unredacted_hetzner_volume_id',
      regex: /HC_Volume_[0-9]{6,}/,
      message:
        'Wykryto niezamaskowany identyfikator wolumenu Hetzner (użyj placeholderu HC_Volume_<ID>).',
      allowInTestMocks: true,
    },
    {
      id: 'unredacted_hetzner_ip',
      regex: /\b159\.69\.[0-9]{1,3}\.[0-9]{1,3}\b/,
      message: 'Wykryto niezamaskowany adres IP serwera Hetzner.',
      allowInTestMocks: true,
    },
  ];

  for (const rule of rules) {
    if (isSelfScannerOrTest && rule.allowInTestMocks) {
      continue;
    }
    if (rule.regex.test(text)) {
      findings.push({
        filePath,
        ruleId: rule.id,
        message: rule.message,
      });
    }
  }

  return findings;
}

/**
 * Potwierdza, że .github/workflows/ci.yml ma wyłączone automatyczne wyzwalacze (ADR-006).
 */
export function validateCiWorkflowRemainsDisabled(ciYamlContent) {
  const lines = String(ciYamlContent ?? '').split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (/^(push|pull_request|pull_request_target|schedule)\s*:/.test(trimmed)) {
      return {
        valid: false,
        reason: `Wykryto aktywny automatyczny wyzwalacz '${trimmed}' w .github/workflows/ci.yml (naruszenie ADR-006).`,
      };
    }
  }
  return { valid: true };
}

/**
 * Waliduje raport dowodowy QA przed oznaczeniem PR jako gotowego do przeglądu/merge.
 * Zasada: żaden niewykonany test (NOT RUN) dla obowiązkowej bramki nie jest równoważny PASS.
 */
export function validateEvidenceReport(report, expectedHeadSha) {
  const technicalErrors = [];
  const approvalErrors = [];

  if (!report || typeof report !== 'object') {
    return {
      valid: false,
      technicalChecksValid: false,
      mergeVerdict: 'NO-GO (DRAFT)',
      errors: ['Brak obiektu raportu QA.'],
    };
  }

  if (!report.headSha || typeof report.headSha !== 'string') {
    technicalErrors.push('Brak dokładnego commit SHA (headSha) w raporcie.');
  } else if (expectedHeadSha && report.headSha !== expectedHeadSha) {
    technicalErrors.push(
      `Niezgodność SHA dowodów: raport dotyczy ${report.headSha}, a bieżący HEAD to ${expectedHeadSha}.`,
    );
  }

  if (!Array.isArray(report.changedFiles) || report.changedFiles.length === 0) {
    technicalErrors.push(
      'Lista zmienionych plików (changedFiles) w raporcie QA nie może być pusta.',
    );
  }

  const classification = classifyChangedFiles(report.changedFiles ?? []);
  const checkMap = new Map((report.checks ?? []).map((c) => [c.id, c]));

  for (const reqCheck of classification.requiredChecks) {
    if (!reqCheck.mandatoryForMergeToMain) {
      continue;
    }
    const recorded = checkMap.get(reqCheck.id);
    if (!recorded) {
      technicalErrors.push(`Brak wymaganego sprawdzenia '${reqCheck.id}' (${reqCheck.command}).`);
      continue;
    }
    if (recorded.status !== 'PASS') {
      technicalErrors.push(
        `Wymagane sprawdzenie '${reqCheck.id}' ma status '${recorded.status}' (wymagane PASS na wskazanym SHA).`,
      );
    }
  }

  if (classification.requiresHetznerPgIntegration && report.cleanupVerified !== true) {
    technicalErrors.push(
      'Brak potwierdzenia sprzątania zasobów tymczasowych Hetzner (cleanupVerified !== true).',
    );
  }

  if (classification.requiresIndependentReview && report.independentReviewStatus !== 'APPROVED') {
    approvalErrors.push(
      `Zmiana wysokiego ryzyka wymaga niezależnego review (aktualny status: ${report.independentReviewStatus ?? 'PENDING'}).`,
    );
  }

  if (classification.requiresOwnerApproval && report.ownerApprovalStatus !== 'APPROVED') {
    approvalErrors.push(
      `Zmiana migracji DB lub polityki/infrastruktury wymaga osobnej zgody właściciela (aktualny status: ${report.ownerApprovalStatus ?? 'PENDING'}).`,
    );
  }

  const errors = [...technicalErrors, ...approvalErrors];
  const technicalChecksValid = technicalErrors.length === 0;
  const valid = errors.length === 0;

  return {
    valid,
    technicalChecksValid,
    mergeVerdict: valid ? 'READY FOR MERGE' : 'NO-GO (KEEP DRAFT)',
    classification,
    errors,
  };
}

/**
 * Generuje zwięzłą tabelę Markdown do sekcji weryfikacji i handoffu w opisie PR.
 */
export function formatEvidenceReportMarkdown(report) {
  const validation = validateEvidenceReport(report, report.headSha);
  const { classification } = validation;

  const lines = [
    `### Bramka Jakości QA (macierz \`${VERIFICATION_MATRIX_VERSION}\`)`,
    '',
    `- **HEAD SHA:** \`${report.headSha ?? 'nieznany'}\``,
    `- **Baza (\`origin/main\`):** \`${report.baseSha ?? 'nieznana'}\``,
    `- **Powierzchnie ryzyka:** ${classification.surfaces.map((s) => `\`${s}\``).join(', ')} (poziom: **\`${classification.riskLevel}\`**)`,
    `- **Środowisko wykonawcze:** \`${report.environment ?? 'lokalne / Hetzner'}\``,
    `- **Sprzątanie zasobów efemerycznych:** \`${report.cleanupVerified === true ? 'VERIFIED (0 pozostałości)' : report.cleanupVerified === false ? 'FAILED' : 'NOT APPLICABLE'}\``,
    `- **Niezależny review:** \`${report.independentReviewStatus ?? 'PENDING'}\``,
    ...(classification.requiresOwnerApproval
      ? [`- **Zgoda właściciela (migracja/infra):** \`${report.ownerApprovalStatus ?? 'PENDING'}\``]
      : []),
    `- **Werdykt bramki Merge-to-Main:** **\`${validation.mergeVerdict}\`** _(nie stanowi zgody na deploy produkcyjny/stagingowy)_`,
    '',
    '| ID sprawdzenia | Polecenie | Środowisko | Status | Czas |',
    '| --- | --- | --- | --- | --- |',
  ];

  const checkMap = new Map((report.checks ?? []).map((c) => [c.id, c]));
  for (const reqCheck of classification.requiredChecks) {
    const rec = checkMap.get(reqCheck.id) ?? {
      id: reqCheck.id,
      command: reqCheck.command,
      environment: reqCheck.environment,
      status: 'NOT RUN',
      durationSec: null,
    };
    const durationText =
      typeof rec.durationSec === 'number' ? `${rec.durationSec.toFixed(1)}s` : '—';
    lines.push(
      `| \`${reqCheck.id}\` | \`${rec.command ?? reqCheck.command}\` | \`${rec.environment ?? reqCheck.environment}\` | **${rec.status}** | ${durationText} |`,
    );
  }

  for (const extra of report.checks ?? []) {
    if (!classification.requiredChecks.some((r) => r.id === extra.id)) {
      const durationText =
        typeof extra.durationSec === 'number' ? `${extra.durationSec.toFixed(1)}s` : '—';
      lines.push(
        `| \`${extra.id}\` | \`${extra.command}\` | \`${extra.environment ?? 'custom'}\` | **${extra.status}** | ${durationText} |`,
      );
    }
  }

  if (validation.errors.length > 0) {
    lines.push('', '#### Niespełnione warunki bramki (powody `NO-GO / DRAFT`):');
    for (const err of validation.errors) {
      lines.push(`- ${err}`);
    }
  }

  return lines.join('\n');
}
