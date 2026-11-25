import type { Role } from '../lib/models';
import { can, type Permission } from '../lib/permissions';
import { repositoryPermission } from '../lib/repository-permissions';
import type {
  DataRepository,
  EntityName,
  ListOptions,
  LocalDoc,
  PrincipalAwareRepository,
  WhereFilter,
} from './types';

export interface RepositoryActor {
  uid: string;
  role: Role;
}

export class AuthorizationError extends Error {
  constructor(action: string, entity: EntityName | 'database') {
    super(`The signed-in operator is not allowed to ${action} ${entity}.`);
    this.name = 'AuthorizationError';
  }
}

type Mutation = 'create' | 'update' | 'delete';

const permissionFor = repositoryPermission;

/**
 * Mutation boundary for the renderer data layer.
 *
 * Reads remain available to every signed-in role. Every write requires the actor
 * installed by AuthContext, an action-specific permission, and an append-only audit
 * event. Transactions receive another authorized facade so a callback cannot drop
 * the actor context by using its `tx` argument.
 */
export class AuthorizedRepository implements DataRepository {
  private actor: RepositoryActor | null;

  constructor(
    private readonly inner: DataRepository,
    actor: RepositoryActor | null = null,
  ) {
    this.actor = actor;
  }

  setActor(actor: RepositoryActor | null): void {
    this.actor = actor;
    const principalAware = this.asPrincipalAware();
    if (principalAware) void principalAware.setPrincipal(actor).catch(() => {});
  }

  private asPrincipalAware(): PrincipalAwareRepository | null {
    const candidate = this.inner as Partial<PrincipalAwareRepository>;
    return typeof candidate.setPrincipal === 'function'
      ? (candidate as PrincipalAwareRepository)
      : null;
  }

  private async bindPrincipal(actor: RepositoryActor): Promise<void> {
    const principalAware = this.asPrincipalAware();
    if (principalAware) await principalAware.setPrincipal(actor);
  }

  private require(
    permission: Permission,
    action: string,
    entity: EntityName | 'database',
  ): RepositoryActor {
    if (!this.actor) throw new AuthorizationError(action, entity);
    if (!can(this.actor.role, permission)) throw new AuthorizationError(action, entity);
    return this.actor;
  }

  private async audit(
    action: Mutation,
    entity: EntityName,
    entityId: string,
    actor: RepositoryActor,
  ): Promise<void> {
    await this.inner.set('auditEvents', `repo-${globalThis.crypto.randomUUID()}`, {
      action: `repository.${action}`,
      entity,
      entityId,
      actor: actor.uid,
      actorRole: actor.role,
      at: new Date().toISOString(),
    });
  }

  init(): Promise<void> {
    return this.inner.init();
  }

  list(entity: EntityName, options?: ListOptions): Promise<LocalDoc[]> {
    return this.inner.list(entity, options);
  }

  get(entity: EntityName, id: string): Promise<LocalDoc | null> {
    return this.inner.get(entity, id);
  }

  count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    return this.inner.count(entity, where);
  }

  subscribe(
    entity: EntityName,
    cb: (docs: LocalDoc[]) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return this.inner.subscribe(entity, cb, onError);
  }

  async set(entity: EntityName, id: string, value: Record<string, unknown>): Promise<void> {
    const actor = this.require(permissionFor(entity, 'create', value), 'write', entity);
    if (entity === 'auditEvents' && actor.role === 'guest')
      throw new AuthorizationError('write', entity);
    await this.bindPrincipal(actor);
    await this.inner.set(entity, id, value);
    await this.audit('create', entity, id, actor);
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const actor = this.require(permissionFor(entity, 'create', value), 'create', entity);
    if (entity === 'auditEvents' && actor.role === 'guest')
      throw new AuthorizationError('write', entity);
    await this.bindPrincipal(actor);
    const id = await this.inner.add(entity, value);
    await this.audit('create', entity, id, actor);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    const actor = this.require(permissionFor(entity, 'update', patch), 'update', entity);
    await this.bindPrincipal(actor);
    await this.inner.update(entity, id, patch);
    await this.audit('update', entity, id, actor);
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    const actor = this.require(permissionFor(entity, 'delete'), 'delete', entity);
    await this.bindPrincipal(actor);
    await this.inner.delete(entity, id);
    await this.audit('delete', entity, id, actor);
  }

  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    const actor = this.require('viewClinical', 'run a transaction', 'database');
    await this.bindPrincipal(actor);
    await this.inner.transaction(async tx => fn(new AuthorizedRepository(tx, this.actor)));
  }

  async clearAll(): Promise<void> {
    const actor = this.require('eraseData', 'erase', 'database');
    await this.bindPrincipal(actor);
    await this.inner.clearAll();
  }
}
