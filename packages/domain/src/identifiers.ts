const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare const tenantIdBrand: unique symbol;
declare const legalEntityIdBrand: unique symbol;

export type TenantId = string & { readonly [tenantIdBrand]: true };
export type LegalEntityId = string & { readonly [legalEntityIdBrand]: true };

export class InvalidIdentifierError extends Error {
  constructor(identifierName: string) {
    super(`${identifierName} must be a UUID`);
    this.name = 'InvalidIdentifierError';
  }
}

function parseUuid<T extends string>(value: string, identifierName: string): T {
  if (!uuidPattern.test(value)) {
    throw new InvalidIdentifierError(identifierName);
  }

  return value.toLowerCase() as T;
}

/** Validates identifier shape only. A valid ID never grants access to its tenant. */
export function tenantId(value: string): TenantId {
  return parseUuid<TenantId>(value, 'tenant_id');
}

/** Validates identifier shape only. A valid ID never grants access to its company. */
export function legalEntityId(value: string): LegalEntityId {
  return parseUuid<LegalEntityId>(value, 'legal_entity_id');
}
