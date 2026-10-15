import { describe, it, expect, vi } from 'vitest';
import { SqliteRepository } from './sqliteRepository';

/**
 * The native store's transaction contract, against a fake that enforces the
 * rules the Android plugin actually applies (SQLite/Database.java):
 *
 *   - `beginTransaction()` on a connection that is already inside a transaction
 *     throws "Failed in beginTransactionAlready in transaction" — the plugin has
 *     no nesting, so a second BEGIN is a hard failure, not a savepoint;
 *   - writes made inside a transaction stay pending until COMMIT, and a
 *     ROLLBACK discards them all.
 *
 * Both reported failures live in that gap: two batches opened at once (issuing a
 * report twice in the same frame), the second BEGIN threw, and the rollback the
 * failed batch then issued undid the FIRST batch's writes — so the lab saw
 * "Could not issue the report" and no report on disk either.
 */

type Store = Map<string, Map<string, string>>;

class FakeConnection {
  private committed: Store = new Map();
  private pending: Store | null = null;
  private active = false;
  readonly calls: string[] = [];

  open(): Promise<void> {
    return Promise.resolve();
  }

  execute(_sql: string): Promise<void> {
    return Promise.resolve();
  }

  beginTransaction(): Promise<void> {
    this.calls.push('begin');
    if (this.active) {
      return Promise.reject(new Error('Failed in beginTransactionAlready in transaction'));
    }
    this.active = true;
    this.pending = new Map();
    return Promise.resolve();
  }

  isTransactionActive(): Promise<{ result: boolean }> {
    return Promise.resolve({ result: this.active });
  }

  commitTransaction(): Promise<void> {
    this.calls.push('commit');
    if (!this.active) return Promise.reject(new Error('Failed in commitTransaction'));
    for (const [table, rows] of this.pending ?? []) {
      const target = this.committed.get(table) ?? new Map<string, string>();
      for (const [id, data] of rows) target.set(id, data);
      this.committed.set(table, target);
    }
    this.active = false;
    this.pending = null;
    return Promise.resolve();
  }

  rollbackTransaction(): Promise<void> {
    this.calls.push('rollback');
    this.active = false;
    this.pending = null;
    return Promise.resolve();
  }

  /** Leave a transaction open with nothing pending — an abandoned earlier run. */
  abandonTransaction(): void {
    this.active = true;
    this.pending = new Map();
  }

  run(sql: string, params: unknown[] = []): Promise<void> {
    this.calls.push('run');
    const insert = /^INSERT INTO (\w+)/.exec(sql);
    const deleteById = /^DELETE FROM (\w+) WHERE id = \?/.test(sql);
    const deleteAll = /^DELETE FROM (\w+);$/.test(sql);
    if (insert) {
      const table = insert[1];
      const rows = this.writeTarget(table);
      rows.set(String(params[0]), String(params[1]));
    } else if (deleteById) {
      const table = /^DELETE FROM (\w+)/.exec(sql)?.[1];
      if (table) this.writeTarget(table).delete(String(params[0]));
    } else if (deleteAll) {
      const table = /^DELETE FROM (\w+)/.exec(sql)?.[1];
      if (table) this.writeTarget(table).clear();
    }
    return Promise.resolve();
  }

  private writeTarget(table: string): Map<string, string> {
    if (this.active) {
      const pending = this.pending ?? new Map();
      if (!pending.has(table)) {
        pending.set(table, new Map(this.committed.get(table) ?? new Map<string, string>()));
      }
      this.pending = pending;
      return pending.get(table) as Map<string, string>;
    }
    // Outside a transaction a write is durable the moment it runs, so it goes
    // straight onto the committed map (and creates it when the table is new).
    let target = this.committed.get(table);
    if (!target) {
      target = new Map<string, string>();
      this.committed.set(table, target);
    }
    return target;
  }

  query(sql: string, params: unknown[] = []): Promise<{ values: unknown[] }> {
    const table = /^SELECT id, data FROM (\w+)/.exec(sql)?.[1];
    if (!table) return Promise.resolve({ values: [] });
    const rows = this.active ? this.writeTarget(table) : (this.committed.get(table) ?? new Map());
    const all = [...rows.entries()].map(([id, data]) => ({ id, data }));
    const filtered = /WHERE id = \?/.test(sql) ? all.filter(r => r.id === String(params[0])) : all;
    return Promise.resolve({ values: filtered });
  }
}

const connection = { current: null as FakeConnection | null };

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    isSecretStored(): Promise<{ result: boolean }> {
      return Promise.resolve({ result: true });
    }
    setEncryptionSecret(): Promise<void> {
      return Promise.resolve();
    }
    isConnection(): Promise<{ result: boolean }> {
      return Promise.resolve({ result: false });
    }
    createConnection(): Promise<FakeConnection> {
      const conn = new FakeConnection();
      connection.current = conn;
      return Promise.resolve(conn);
    }
    retrieveConnection(): Promise<FakeConnection> {
      return Promise.resolve(connection.current as FakeConnection);
    }
  },
}));

async function withRepo(): Promise<{ repo: SqliteRepository; conn: FakeConnection }> {
  const repo = new SqliteRepository();
  await repo.init();
  return { repo, conn: connection.current as FakeConnection };
}

describe('SqliteRepository.transaction', () => {
  it('commits a batch as one unit and never leaves a transaction open', async () => {
    const { repo, conn } = await withRepo();
    await repo.transaction(async tx => {
      await tx.set('reports', 'r1', { status: 'final' });
      await tx.set('reportVersions', 'r1:v1', { snapshot: 'old' });
    });
    expect(conn.calls.filter(c => c === 'begin')).toHaveLength(1);
    expect(conn.calls.filter(c => c === 'commit')).toHaveLength(1);
    expect(await repo.get('reports', 'r1')).not.toBeNull();
    expect((await conn.isTransactionActive()).result).toBe(false);
  });

  it('a nested transaction joins the open one instead of issuing a second BEGIN', async () => {
    const { repo, conn } = await withRepo();
    await repo.transaction(async tx => {
      await tx.set('reports', 'r1', { status: 'final' });
      await repo.transaction(async inner => {
        await inner.set('patients', 'p1', { name: 'Asha' });
      });
    });
    expect(conn.calls.filter(c => c === 'begin')).toHaveLength(1);
    expect(conn.calls).not.toContain('rollback');
    expect(await repo.get('patients', 'p1')).not.toBeNull();
    expect(await repo.get('reports', 'r1')).not.toBeNull();
  });

  it('two overlapping transactions both land — the second cannot undo the first', async () => {
    const { repo, conn } = await withRepo();
    await Promise.all([
      repo.transaction(async tx => {
        await tx.set('reports', 'r1', { status: 'final' });
      }),
      repo.transaction(async tx => {
        await tx.set('reports', 'r2', { status: 'draft' });
      }),
    ]);
    // Whatever the interleaving, neither batch may end in "Already in
    // transaction" and neither may roll the other's row away.
    expect(conn.calls).not.toContain('rollback');
    expect(await repo.get('reports', 'r1')).not.toBeNull();
    expect(await repo.get('reports', 'r2')).not.toBeNull();
  });

  it('rolls back only its own writes when the body throws, and the chain survives', async () => {
    const { repo, conn } = await withRepo();
    await expect(
      repo.transaction(async tx => {
        await tx.set('reports', 'r1', { status: 'final' });
        throw new Error('domain rule');
      }),
    ).rejects.toThrow('domain rule');
    expect(await repo.get('reports', 'r1')).toBeNull();
    expect((await conn.isTransactionActive()).result).toBe(false);
    // A later write is not blocked by the failed transaction.
    await repo.set('reports', 'r2', { status: 'draft' });
    expect(await repo.get('reports', 'r2')).not.toBeNull();
  });

  it('heals a transaction left open by an earlier run instead of failing forever', async () => {
    const { repo, conn } = await withRepo();
    conn.abandonTransaction();
    await repo.set('reports', 'seed', { status: 'final' });
    await repo.transaction(async tx => {
      await tx.set('reports', 'r1', { status: 'final' });
    });
    expect(await repo.get('reports', 'r1')).not.toBeNull();
    expect((await conn.isTransactionActive()).result).toBe(false);
  });
});
