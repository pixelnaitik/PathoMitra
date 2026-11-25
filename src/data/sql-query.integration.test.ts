import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { applyQuery, makeDoc } from './query';
import { buildSqlQuery } from './sql-query';
import type { ListOptions } from './types';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3-multiple-ciphers');

describe('SQL query translation against SQLite', () => {
  it('matches the shared JS semantics for filters, ordering and paging', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE reports (id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id));');
      const insert = db.prepare('INSERT INTO reports (id, data) VALUES (?, ?)');
      const records = [
        { id: 'a', patientId: 'p1', status: 'draft', createdAt: '2026-01-03', remark: '50 mg/dL' },
        { id: 'b', patientId: 'p1', status: 'final', createdAt: '2026-01-02', remark: '50%' },
        { id: 'c', patientId: 'p2', status: 'draft', createdAt: '2026-01-01', remark: 'other' },
        { id: 'd', patientId: 'p1', status: 'draft', createdAt: '2026-01-04', remark: 'newest' },
      ];
      for (const record of records) insert.run(record.id, JSON.stringify(record));
      const options: ListOptions = {
        where: [{ field: 'patientId', op: '==', value: 'p1' }],
        orderBy: 'createdAt',
        direction: 'desc',
        limit: 2,
        offset: 1,
      };
      const query = buildSqlQuery('reports', options)!;
      const sqlRows = db
        .prepare(query.sql)
        .all(...query.params)
        .map((row: { id: string }) => row.id);
      const jsRows = applyQuery(
        records.map(record => makeDoc(record.id, record)),
        options,
      ).map(doc => doc.id);
      expect(sqlRows).toEqual(jsRows);

      const literal = buildSqlQuery('reports', {
        where: [{ field: 'remark', op: 'contains', value: '50%' }],
      })!;
      const literalRows = db.prepare(literal.sql).all(...literal.params);
      expect(literalRows).toHaveLength(1);
      expect(literalRows[0].id).toBe('b');
    } finally {
      db.close();
    }
  });

  it('scopes Electron document-store queries to one entity', () => {
    const db = new Database(':memory:');
    try {
      db.exec(
        'CREATE TABLE documents (entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity, id));',
      );
      const insert = db.prepare('INSERT INTO documents (entity, id, data) VALUES (?, ?, ?)');
      insert.run('reports', 'r1', JSON.stringify({ status: 'draft', createdAt: '2026-01-01' }));
      insert.run('patients', 'p1', JSON.stringify({ status: 'draft', createdAt: '2026-01-02' }));
      const query = buildSqlQuery(
        'reports',
        { where: [{ field: 'status', op: '==', value: 'draft' }], limit: 10 },
        'documents',
      )!;
      const rows = db.prepare(query.sql).all(...query.params);
      expect(rows.map((row: { id: string }) => row.id)).toEqual(['r1']);
    } finally {
      db.close();
    }
  });
});
