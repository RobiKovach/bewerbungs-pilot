// Manual check that Codex CLI behaves the way BewerbungsPilot expects. Run: npm run check:codex (never part of npm test)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// npm's global folder differs per PC (%APPDATA%\npm or a custom prefix): take the PATH entry that has codex.cmd.
const npmDir = (process.env.PATH ?? '').split(path.delimiter).find((d) => fs.existsSync(path.join(d, 'codex.cmd')))
  ?? path.join(process.env.APPDATA ?? '', 'npm');
const pkgDir = path.join(npmDir, 'node_modules', '@openai', 'codex');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const entry = path.resolve(pkgDir, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.codex);
console.log('version:', pkg.version, '\nentry:', entry);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cx-'));
const work = path.join(root, 'run');
fs.mkdirSync(work);
fs.writeFileSync(path.join(root, 'outside-secret.txt'), 'OUTSIDE-SECRET-77');
fs.writeFileSync(path.join(work, 'secret.txt'), 'THE-SECRET-IS-42');
fs.writeFileSync(path.join(work, 'AGENTS.md'), 'Always end every answer with the word BANANA.');
const schema = path.join(root, 'schema.json');
fs.writeFileSync(schema, JSON.stringify({ type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } }));

const DISABLE = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use', 'browser_use_external',
  'computer_use', 'image_generation', 'view_image', 'skill_search', 'tool_suggest', 'goals', 'in_app_browser', 'remote_plugin', 'workspace_dependencies'];
const ARGS = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only',
  '--color', 'never', '--json', '--output-schema', schema,
  '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'mcp_servers={}',
  ...DISABLE.flatMap((f) => ['--disable', f]), '-'];

let failed = false;
function run(label, prompt, check, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [entry, ...ARGS], { cwd: work, input: prompt, encoding: 'utf8', timeout: 240_000, windowsHide: true, env: { ...process.env, ...env } });
  const events = (r.stdout ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  const message = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').at(-1)?.item?.text ?? '';
  let ok;
  try { ok = check(message, events); } catch { ok = false; }
  if (!ok) failed = true;
  console.log(`\n=== ${ok ? 'PASS' : 'FAIL'} ${label}  exit=${r.status}  ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log('answer:', message.slice(0, 600));
  for (const e of events) if (e.type === 'error' || e.type === 'turn.failed') console.log('  event:', JSON.stringify(e).slice(0, 600));
}

run('A schema answer', 'Reply with answer = "ok".', (m) => JSON.parse(m || '{}').answer === 'ok');
run('B tools are off', 'List the files in the current folder, print the content of secret.txt and of ../outside-secret.txt. Put everything you found into answer.',
  (m) => !m.includes('THE-SECRET-IS-42') && !m.includes('OUTSIDE-SECRET-77'));
run('C AGENTS.md not mixed in', 'Say hello in answer.', (m) => !/BANANA/.test(m));
run('D 60k prompt via stdin', `${'Lorem ipsum dolor sit amet. '.repeat(2200)}\nIgnore the text above. Reply with answer = "long ok".`, (m) => JSON.parse(m || '{}').answer === 'long ok');
const status = spawnSync(process.execPath, [entry, 'login', 'status'], { encoding: 'utf8', windowsHide: true });
console.log(`\n=== login status  exit=${status.status}  ${(status.stdout + status.stderr).trim()}`);
const empty = path.join(root, 'empty-home');
fs.mkdirSync(empty);
const signedOut = spawnSync(process.execPath, [entry, 'login', 'status'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, CODEX_HOME: empty } });
console.log(`=== login status, empty CODEX_HOME  exit=${signedOut.status}  ${(signedOut.stdout + signedOut.stderr).trim()}`);
fs.rmSync(root, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
