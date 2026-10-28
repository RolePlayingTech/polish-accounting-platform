import type {
  TenantAuthorizationDataSource,
  TenantAuthorizationFacts,
  TenantAuthorizationQuery,
} from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { and, eq } from 'drizzle-orm';
import type { connectDatabase } from './client.js';
import { companyAccessGrant, tenantMembership } from './schema.js';

type AuthorizationDatabase = Pick<ReturnType<typeof connectDatabase>['db'], 'select'>;

/** Źródło faktów dla serwera; UUID wykonującego musi pochodzić ze zweryfikowanej tożsamości. */
export class PostgresTenantAuthorizationDataSource implements TenantAuthorizationDataSource {
  constructor(private readonly db: AuthorizationDatabase) {}

  async getFacts(query: TenantAuthorizationQuery): Promise<TenantAuthorizationFacts> {
    try {
      // Jeden SELECT: członkostwo i granty z tego samego snapshotu, bez cache.
      // Warunki grantu w JOIN zachowują członkostwo również przy braku grantu.
      const rows = await this.db
        .select({ membership: tenantMembership, grant: companyAccessGrant })
        .from(tenantMembership)
        .leftJoin(
          companyAccessGrant,
          and(
            eq(companyAccessGrant.tenantId, tenantMembership.tenantId),
            eq(companyAccessGrant.userId, tenantMembership.userId),
            eq(companyAccessGrant.legalEntityId, query.legalEntityId),
            eq(companyAccessGrant.action, query.action),
          ),
        )
        .where(
          and(
            eq(tenantMembership.tenantId, query.tenantId),
            eq(tenantMembership.userId, query.userId),
          ),
        );

      const membership = rows[0]?.membership;
      return {
        membership: membership
          ? {
              ...membership,
              tenantId: tenantId(membership.tenantId),
              userId: userId(membership.userId),
            }
          : null,
        grants: rows.flatMap(({ grant }) =>
          grant
            ? [
                {
                  ...grant,
                  tenantId: tenantId(grant.tenantId),
                  userId: userId(grant.userId),
                  legalEntityId: legalEntityId(grant.legalEntityId),
                },
              ]
            : [],
        ),
        // Schemat 6B nie zawiera autorytatywnego źródła ról platformy.
        platformRoleAssignments: [],
      };
    } catch {
      // Bez surowego SQL, parametrów, poświadczeń ani cause sterownika.
      // Istniejący application service zamienia błąd na authorization_data_unavailable.
      throw new Error('Źródło danych autoryzacji jest niedostępne.');
    }
  }
}
