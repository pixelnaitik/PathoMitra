import type { ListOptions, WhereFilter } from './types';

export interface SqlQuery {
  sql: string;
  params: Array<string | number | boolean>;
}

function fieldExpression(field: string, table: string): string | null {
  if (field === 'id') return 'id';
  if (table === 'documents' && field === 'entity') return 'entity';
  if (!/^[A-Za-z0-9_]+$/.test(field)) return null;
  return `json_extract(data, '$."${field}"')`;
}

function scalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

/** Shared SQL translation for native SQLite and Electron's main-process database. */
export function buildWhereSql(where?: WhereFilter[], table = 'entity'): SqlQuery | null {
  const clauses: string[] = [];
  const params: Array<string | number | boolean> = [];
  for (const filter of where ?? []) {
    const expression = fieldExpression(filter.field, table);
    if (!expression) return null;
    switch (filter.op) {
      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=': {
        if (!scalar(filter.value)) return null;
        const operator = filter.op === '==' ? '=' : filter.op;
        if (operator === '!=') clauses.push(`(${expression} IS NULL OR ${expression} != ?)`);
        else if (operator === '<' || operator === '<=')
          clauses.push(`(${expression} IS NULL OR ${expression} ${operator} ?)`);
        else clauses.push(`${expression} ${operator} ?`);
        params.push(filter.value);
        break;
      }
      case 'contains': {
        if (typeof filter.value !== 'string') return null;
        clauses.push(
          `(json_type(data, '$.${filter.field}') = 'text' AND LOWER(${expression}) LIKE '%' || LOWER(?) || '%' ESCAPE '\\')`,
        );
        params.push(escapeLike(filter.value));
        break;
      }
      case 'in':
        if (
          !Array.isArray(filter.value) ||
          filter.value.length === 0 ||
          !filter.value.every(scalar)
        )
          return null;
        clauses.push(`${expression} IN (${filter.value.map(() => '?').join(', ')})`);
        params.push(...filter.value);
        break;
      case 'array-contains':
        if (!scalar(filter.value)) return null;
        clauses.push(`EXISTS (SELECT 1 FROM json_each(${expression}) WHERE value = ?)`);
        params.push(filter.value);
        break;
      default:
        return null;
    }
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

export function buildSqlQuery(
  entity: string,
  options: ListOptions = {},
  table: string = entity,
): SqlQuery | null {
  const filters =
    table === 'documents'
      ? [{ field: 'entity', op: '==' as const, value: entity }, ...(options.where ?? [])]
      : options.where;
  const where = buildWhereSql(filters, table);
  const orderExpression = fieldExpression(options.orderBy ?? 'createdAt', table);
  if (!where || !orderExpression) return null;
  const direction = options.direction === 'asc' ? 'ASC' : 'DESC';
  const limit = options.limit;
  const offset = options.offset ?? 0;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) return null;
  if (!Number.isInteger(offset) || offset < 0) return null;
  let sql = `SELECT id, data FROM ${table}${where.sql} ORDER BY ${orderExpression} ${direction}, id ASC`;
  const params = [...where.params];
  if (limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(limit);
    if (offset > 0) {
      sql += ' OFFSET ?';
      params.push(offset);
    }
  } else if (offset > 0) {
    sql += ' LIMIT -1 OFFSET ?';
    params.push(offset);
  }
  return { sql, params };
}
