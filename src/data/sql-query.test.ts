import { describe, expect, it } from 'vitest';
import { buildSqlQuery } from './sql-query';

describe('indexed SQL query translation', () => {
  it('combines filters, stable ordering, paging and bound parameters', () => {
    const query = buildSqlQuery('reports', {
      where: [
        { field: 'patientId', op: '==', value: 'p1' },
        { field: 'status', op: 'in', value: ['draft', 'final'] },
      ],
      orderBy: 'createdAt',
      direction: 'desc',
      limit: 25,
      offset: 50,
    });
    expect(query?.sql).toContain(`json_extract(data, '$."patientId"') = ?`);
    expect(query?.sql).toContain(
      'ORDER BY json_extract(data, \'$."createdAt"\') DESC, id ASC LIMIT ? OFFSET ?',
    );
    expect(query?.params).toEqual(['p1', 'draft', 'final', 25, 50]);
  });

  it('treats contains wildcards literally and restricts them to text values', () => {
    const query = buildSqlQuery('patients', {
      where: [{ field: 'remark', op: 'contains', value: '50%_' }],
    });
    expect(query?.sql).toContain("json_type(data, '$.remark') = 'text'");
    expect(query?.sql).toContain("ESCAPE '\\'");
    expect(query?.params).toEqual(['50\\%\\_']);
  });

  it('uses the document id column for id lookups', () => {
    const query = buildSqlQuery('patients', {
      where: [{ field: 'id', op: '==', value: 'p1' }],
      limit: 1,
    });
    expect(query?.sql).toContain('WHERE id = ?');
    expect(query?.params).toEqual(['p1', 1]);
  });
});
