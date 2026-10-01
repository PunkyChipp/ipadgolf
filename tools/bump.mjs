// Bumps the version stamp on every file the game loads, so iPads never mix a
// new page with old cached scripts. Run before each release: npm run bump
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const files = ['index.html', 'sw.js', ...readdirSync('src').filter((f) => f.endsWith('.js')).map((f) => `src/${f}`)];
const cur = Number(JSON.parse(readFileSync('version.json', 'utf8')).v);
const next = String(cur + 1);
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  const out = s.replace(/\?v=\d+/g, `?v=${next}`).replace(/pocket-links-v\d+/g, `pocket-links-v${next}`);
  if (out !== s) writeFileSync(f, out);
}
writeFileSync('version.json', JSON.stringify({ v: next }) + '\n');
console.log(`version ${cur} -> ${next}`);
