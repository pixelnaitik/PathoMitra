import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database(':memory:');
const TOTAL = 50_000;
const RUNS = 100;

try {
  db.exec(`
    CREATE TABLE documents (entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity, id));
    CREATE INDEX idx_bench_patient_status_created ON documents(entity, json_extract(data, '$.patientId'), json_extract(data, '$.status'), json_extract(data, '$.createdAt'));
  `);
  const insert = db.prepare('INSERT INTO documents (entity, id, data) VALUES (?, ?, ?)');
  const write = db.transaction(() => {
    for (let index = 0; index < TOTAL; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      insert.run(
        'reports',
        `synthetic-${index}`,
        JSON.stringify({
          patientId: `synthetic-patient-${index % 1000}`,
          status: index % 5 === 0 ? 'final' : 'draft',
          createdAt: `2026-11-${day}T10:00:00.000Z`,
        }),
      );
    }
  });
  write();

  const query = db.prepare(`
    SELECT id, data FROM documents
    WHERE entity = ? AND json_extract(data, '$.patientId') = ? AND json_extract(data, '$.status') = ?
    ORDER BY json_extract(data, '$.createdAt') DESC, id ASC
    LIMIT ? OFFSET ?
  `);
  const run = () => query.all('reports', 'synthetic-patient-42', 'draft', 25, 0);
  for (let index = 0; index < 10; index += 1) run();
  const durations = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    const rows = run();
    durations.push(performance.now() - started);
    if (rows.length !== 25)
      throw new Error('Paged query returned the wrong number of synthetic rows.');
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.floor(durations.length * 0.95) - 1];
  const result = {
    records: TOTAL,
    runs: RUNS,
    pageSize: 25,
    p95Ms: Number(p95.toFixed(3)),
    budgetMs: 100,
  };
  console.log(JSON.stringify(result));
  if (p95 > 100)
    throw new Error(`Query performance budget exceeded: p95 ${p95.toFixed(2)} ms > 100 ms.`);
} finally {
  db.close();
}
