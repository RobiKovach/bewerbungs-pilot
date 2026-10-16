// Stand-in for the real Codex CLI. Behaviour chosen with FAKE_CODEX_MODE.
import fs from 'node:fs';

const mode = process.env.FAKE_CODEX_MODE ?? 'ok';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(`codex-cli ${process.env.FAKE_CODEX_VERSION ?? '0.162.1'}`); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') {
  if (mode === 'not-logged-in') { console.error('Not logged in'); process.exit(1); }
  console.error('Logged in using ChatGPT'); process.exit(0);
}
if (args[0] === 'login') process.exit(0);
const stdin = fs.readFileSync(0, 'utf8');
if (process.env.FAKE_CODEX_RECORD) {
  const i = args.indexOf('--output-schema');
  fs.writeFileSync(process.env.FAKE_CODEX_RECORD, JSON.stringify({
    args, stdin, cwd: process.cwd(), schema: i >= 0 && fs.existsSync(args[i + 1]) ? JSON.parse(fs.readFileSync(args[i + 1], 'utf8')) : null,
  }));
}
let call = 0;
const counter = process.env.FAKE_CODEX_COUNTER;
if (counter) { call = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0; fs.writeFileSync(counter, String(call + 1)); }
const ev = (e) => console.log(JSON.stringify(e));
const answer = (text) => {
  ev({ type: 'thread.started', thread_id: 't1' });
  ev({ type: 'turn.started' });
  ev({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text } });
  ev({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
};
const fail = (message) => { ev({ type: 'error', message }); ev({ type: 'turn.failed', error: { message } }); process.exit(1); };
switch (mode) {
  case 'ok': answer('{"greeting":"Hallo!"}'); break;
  case 'bad-then-ok': answer(call === 0 ? '{"wrong":1}' : '{"greeting":"second try"}'); break;
  case 'always-bad': answer('Sorry, I cannot help with that.'); break;
  case 'always-empty': answer('{}'); break;
  case 'no-message': ev({ type: 'turn.completed', usage: {} }); break;
  case 'limit': fail("You've hit your usage limit. Try again later. (429 Too Many Requests)"); break;
  case 'not-logged-in': fail('unexpected status 401 Unauthorized: Missing bearer or basic authentication in header'); break;
  default: process.exit(2);
}
