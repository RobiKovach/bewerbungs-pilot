// Stand-in for the real `claude` CLI. Behaviour chosen with FAKE_CLAUDE_MODE.
import fs from 'node:fs';

const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, 'utf8');

if (process.env.FAKE_CLAUDE_RECORD) {
  const inputs = {};
  if (fs.existsSync('input')) {
    for (const name of fs.readdirSync('input')) inputs[`input/${name}`] = fs.readFileSync(`input/${name}`, 'utf8');
  }
  fs.writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ args, stdin, cwd: process.cwd(), inputs }));
}
let call = 0;
const counter = process.env.FAKE_CLAUDE_COUNTER;
if (counter) {
  call = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(call + 1));
}
const result = (extra) => console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...extra }));

switch (mode) {
  case 'ok':
    result({ result: '{"greeting":"Hallo!"}', structured_output: { greeting: 'Hallo!' } });
    break;
  case 'result-only':
    result({ result: '{"greeting":"Hi"}' });
    break;
  case 'bad-then-ok':
    if (call === 0) result({ result: 'nope', structured_output: { wrong: 1 } });
    else result({ structured_output: { greeting: 'second try' } });
    break;
  case 'always-bad':
    result({ result: 'nope', structured_output: { wrong: 1 } });
    break;
  case 'not-json':
    console.log('this is not json');
    break;
  case 'not-logged-in':
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }));
    process.exit(1);
    break;
  case 'crash':
    console.error('boom');
    process.exit(3);
    break;
  case 'hang':
    setInterval(() => {}, 1000);
    break;
}
