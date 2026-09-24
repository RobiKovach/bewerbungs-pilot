// Builds everything and packs release/BewerbungsPilot-v<version>.zip for GitHub Releases.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `BewerbungsPilot-v${version}`;
const out = path.join(root, 'release', name);

execSync('npm run build', { cwd: root, stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (rel) => {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) throw new Error(`Release: missing file ${rel}`);
  fs.cpSync(src, path.join(out, rel), { recursive: true });
};
for (const rel of ['package.json', 'package-lock.json', 'LICENSE', 'README.md', 'server/package.json', 'server/dist', 'web/package.json', 'web/dist', 'installer']) {
  copy(rel);
}
fs.rmSync(path.join(out, 'installer', 'node-path.txt'), { force: true });
fs.copyFileSync(path.join(root, 'installer', 'install.bat'), path.join(out, 'install.bat'));

const zip = `${out}.zip`;
fs.rmSync(zip, { force: true });
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force"`, { stdio: 'inherit' });
console.log(`Release ready: ${zip}`);
