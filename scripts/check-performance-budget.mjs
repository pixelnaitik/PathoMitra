import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'dist', 'assets');
if (!fs.existsSync(root)) throw new Error('dist/assets is missing; run a production build first.');
const files = fs.readdirSync(root).filter(name => name.endsWith('.js'));
const sizes = files.map(name => ({ name, bytes: fs.statSync(path.join(root, name)).size }));
const total = sizes.reduce((sum, file) => sum + file.bytes, 0);
const fonts = sizes.find(file => file.name.startsWith('pdf-fonts-'));
const failures = [];
if (total > 8 * 1024 * 1024) failures.push('total JavaScript exceeds 8 MB');
if (fonts && fonts.bytes > 8 * 1024 * 1024) failures.push('PDF font chunk exceeds 8 MB');
console.log(
  JSON.stringify(
    {
      totalBytes: total,
      fontBytes: fonts?.bytes ?? 0,
      largest: [...sizes].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
    },
    null,
    2,
  ),
);
if (failures.length) throw new Error(`Performance budget failed: ${failures.join('; ')}`);
