import type { AccountingWorkspaceService } from '@pap/application';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';

interface InspectableInMemoryStore {
  readonly users: Map<unknown, unknown>;
  readonly memberships: Map<string, unknown>;
  readonly grants: Map<string, unknown>;
  readonly companies: Map<string, unknown>;
  readonly mcpProposals: Map<string, unknown>;
  readonly humanChallenges: Map<string, unknown>;
  readonly auditEvents: unknown[];
}

interface InspectableNotificationsEngine {
  readonly preferencesByKey: Map<string, unknown>;
  readonly optOutTokens: Map<string, unknown>;
  readonly outboxByDedupKey: Map<string, unknown>;
  readonly outboxById: Map<string, unknown>;
}

interface InspectableMailboxTransport {
  readonly deliveredMessages: unknown[];
}

interface InspectableWorkspaceService {
  readonly store: InspectableInMemoryStore;
  readonly notificationsEngine: InspectableNotificationsEngine;
  readonly sandboxMailboxTransport: InspectableMailboxTransport;
  readonly internalNotificationsTransport?: InspectableMailboxTransport;
}

interface InspectableMcpGateway {
  readonly proposalsById: Map<string, unknown>;
  readonly prepareIdempotency: Map<string, unknown>;
  readonly confirmIdempotency: Map<string, unknown>;
  readonly humanChallengesByProposal: Map<string, unknown>;
}

interface GatewayRamSnapshot {
  readonly gateway: PapMcpGateway;
  readonly proposalsById: Map<string, unknown>;
  readonly prepareIdempotency: Map<string, unknown>;
  readonly confirmIdempotency: Map<string, unknown>;
  readonly humanChallengesByProposal: Map<string, unknown>;
}

export interface WorkspaceRamSnapshot {
  readonly users: Map<unknown, unknown>;
  readonly memberships: Map<string, unknown>;
  readonly grants: Map<string, unknown>;
  readonly companies: Map<string, unknown>;
  readonly mcpProposals: Map<string, unknown>;
  readonly humanChallenges: Map<string, unknown>;
  readonly auditEvents: unknown[];
  readonly preferencesByKey: Map<string, unknown>;
  readonly optOutTokens: Map<string, unknown>;
  readonly outboxByDedupKey: Map<string, unknown>;
  readonly outboxById: Map<string, unknown>;
  readonly sandboxDeliveredMessages: unknown[];
  readonly internalDeliveredMessages: unknown[] | null;
  readonly gateways: readonly GatewayRamSnapshot[];
}

function cloneMap<K, V>(source: ReadonlyMap<K, V>): Map<K, V> {
  const cloned = new Map<K, V>();
  for (const [k, v] of source.entries()) {
    cloned.set(k, structuredClone(v));
  }
  return cloned;
}

function restoreMapInPlace<K, V>(target: Map<K, V>, snapshot: ReadonlyMap<K, V>): void {
  target.clear();
  for (const [k, v] of snapshot.entries()) {
    target.set(k, structuredClone(v));
  }
}

function cloneArray<T>(source: readonly T[]): T[] {
  return source.map((item) => structuredClone(item));
}

function restoreArrayInPlace<T>(target: T[], snapshot: readonly T[]): void {
  target.length = 0;
  for (const item of snapshot) {
    target.push(structuredClone(item));
  }
}

/**
 * Kolejka wyłączności mutacji gwarantująca deterministyczne migawki i atomowy rollback stanu RAM
 * przy każdym błędzie transakcji PostgreSQL lub odmowie autoryzacji (eliminacja split-brain).
 */
export class AsyncMutationMutex {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    return previous
      .catch(() => undefined)
      .then(() => work())
      .finally(() => {
        release();
      });
  }
}

export function captureWorkspaceRamSnapshot(
  workspace: AccountingWorkspaceService,
  gateways: ReadonlySet<PapMcpGateway>,
): WorkspaceRamSnapshot {
  const ws = workspace as unknown as InspectableWorkspaceService;
  const gatewaySnapshots: GatewayRamSnapshot[] = [];

  for (const gateway of gateways) {
    const gw = gateway as unknown as InspectableMcpGateway;
    gatewaySnapshots.push({
      gateway,
      proposalsById: cloneMap(gw.proposalsById),
      prepareIdempotency: cloneMap(gw.prepareIdempotency),
      confirmIdempotency: cloneMap(gw.confirmIdempotency),
      humanChallengesByProposal: cloneMap(gw.humanChallengesByProposal),
    });
  }

  return {
    users: cloneMap(ws.store.users),
    memberships: cloneMap(ws.store.memberships),
    grants: cloneMap(ws.store.grants),
    companies: cloneMap(ws.store.companies),
    mcpProposals: cloneMap(ws.store.mcpProposals),
    humanChallenges: cloneMap(ws.store.humanChallenges),
    auditEvents: cloneArray(ws.store.auditEvents),
    preferencesByKey: cloneMap(ws.notificationsEngine.preferencesByKey),
    optOutTokens: cloneMap(ws.notificationsEngine.optOutTokens),
    outboxByDedupKey: cloneMap(ws.notificationsEngine.outboxByDedupKey),
    outboxById: cloneMap(ws.notificationsEngine.outboxById),
    sandboxDeliveredMessages: cloneArray(ws.sandboxMailboxTransport.deliveredMessages),
    internalDeliveredMessages: ws.internalNotificationsTransport
      ? cloneArray(ws.internalNotificationsTransport.deliveredMessages)
      : null,
    gateways: gatewaySnapshots,
  };
}

export function restoreWorkspaceRamSnapshot(
  workspace: AccountingWorkspaceService,
  gateways: ReadonlySet<PapMcpGateway>,
  snapshot: WorkspaceRamSnapshot,
): void {
  const ws = workspace as unknown as InspectableWorkspaceService;
  restoreMapInPlace(ws.store.users, snapshot.users);
  restoreMapInPlace(ws.store.memberships, snapshot.memberships);
  restoreMapInPlace(ws.store.grants, snapshot.grants);
  restoreMapInPlace(ws.store.companies, snapshot.companies);
  restoreMapInPlace(ws.store.mcpProposals, snapshot.mcpProposals);
  restoreMapInPlace(ws.store.humanChallenges, snapshot.humanChallenges);
  restoreArrayInPlace(ws.store.auditEvents, snapshot.auditEvents);

  restoreMapInPlace(ws.notificationsEngine.preferencesByKey, snapshot.preferencesByKey);
  restoreMapInPlace(ws.notificationsEngine.optOutTokens, snapshot.optOutTokens);
  restoreMapInPlace(ws.notificationsEngine.outboxByDedupKey, snapshot.outboxByDedupKey);
  restoreMapInPlace(ws.notificationsEngine.outboxById, snapshot.outboxById);

  restoreArrayInPlace(
    ws.sandboxMailboxTransport.deliveredMessages,
    snapshot.sandboxDeliveredMessages,
  );
  if (ws.internalNotificationsTransport && snapshot.internalDeliveredMessages) {
    restoreArrayInPlace(
      ws.internalNotificationsTransport.deliveredMessages,
      snapshot.internalDeliveredMessages,
    );
  }

  for (const gwSnap of snapshot.gateways) {
    if (!gateways.has(gwSnap.gateway)) {
      continue;
    }
    const gw = gwSnap.gateway as unknown as InspectableMcpGateway;
    restoreMapInPlace(gw.proposalsById, gwSnap.proposalsById);
    restoreMapInPlace(gw.prepareIdempotency, gwSnap.prepareIdempotency);
    restoreMapInPlace(gw.confirmIdempotency, gwSnap.confirmIdempotency);
    restoreMapInPlace(gw.humanChallengesByProposal, gwSnap.humanChallengesByProposal);
  }
}
