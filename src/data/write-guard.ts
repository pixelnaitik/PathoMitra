import type { DataRepository } from './types';

const MUTATIONS = new Set<keyof DataRepository>([
  'set',
  'add',
  'update',
  'delete',
  'transaction',
  'clearAll',
]);
let guard: (() => void) | null = null;
let recoveryDepth = 0;

export function setRepositoryWriteGuard(next: (() => void) | null): void {
  guard = next;
}

export function assertRepositoryWritesAllowed(): void {
  if (recoveryDepth === 0) guard?.();
}

/** Restore/repair is the explicit exception to read-only safe mode. */
export async function withRecoveryWrites<T>(task: () => Promise<T>): Promise<T> {
  recoveryDepth += 1;
  try {
    return await task();
  } finally {
    recoveryDepth = Math.max(0, recoveryDepth - 1);
  }
}

function wrapRepository<T extends DataRepository>(repository: T): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function' || !MUTATIONS.has(property as keyof DataRepository)) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      if (property === 'transaction') {
        return async (fn: (tx: DataRepository) => Promise<void>) => {
          assertRepositoryWritesAllowed();
          return target.transaction(tx => fn(wrapRepository(tx)));
        };
      }
      return async (...args: unknown[]) => {
        assertRepositoryWritesAllowed();
        return (value as (...input: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

export function guardRepository<T extends DataRepository>(repository: T): T {
  return wrapRepository(repository);
}
