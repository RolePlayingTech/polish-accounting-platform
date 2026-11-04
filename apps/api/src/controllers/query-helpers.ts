import { AccountingWorkspaceValidationError, type DEMO_DEFAULT_PERIOD } from '@pap/application';

const TAX_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type WorkspacePeriodParam = typeof DEMO_DEFAULT_PERIOD;

export function parseOptionalPeriodParam(rawPeriod?: string): WorkspacePeriodParam | undefined {
  if (rawPeriod === undefined) {
    return undefined;
  }
  const trimmed = rawPeriod.trim();
  if (!TAX_PERIOD_PATTERN.test(trimmed)) {
    throw new AccountingWorkspaceValidationError(
      400,
      'invalid_period_format',
      'Okres rozliczeniowy musi mieć format RRRR-MM (np. 2026-03).',
    );
  }
  return trimmed as WorkspacePeriodParam;
}
