import { describe, it, expect } from 'vitest';
import { addressRules, testPagesPort } from '../src/vacancies/sources/test-pages.js';

const TEST_MODE = { BP_DATA_DIR: 'C:\\tmp\\bp-e2e', BP_TEST_PAGES_PORT: '45123' };

describe('test pages (end-to-end fixture server)', () => {
  it('outside test mode 127.0.0.1 stays blocked even with BP_TEST_PAGES_PORT', async () => {
    // No throw-away data folder, or no fake mail: the variable is ignored.
    for (const [env, argv] of [
      [{ BP_TEST_PAGES_PORT: '45123' }, ['--fake-mail']],
      [{ BP_TEST_PAGES_PORT: '45123', BP_DATA_DIR: 'C:\\tmp\\bp-e2e' }, []],
      [{ BP_TEST_PAGES_PORT: '45123', BP_DATA_DIR: '' }, ['--fake-mail']],
    ] as const) {
      const port = testPagesPort(env, argv);
      expect(port).toBeNull();
      const rules = addressRules(port);
      expect((await rules.check('http://127.0.0.1:45123/stelle')).ok).toBe(false);
      expect(await rules.check('http://127.0.0.1/stelle')).toEqual({ ok: false, why: 'private' });
      expect(rules.addressOk('127.0.0.1')).toBe(false);
    }
  });

  it('in test mode only http://127.0.0.1:<port> is read — every other address, public ones too, is refused', async () => {
    const port = testPagesPort(TEST_MODE, ['--fake-mail']);
    expect(port).toBe(45123);
    const rules = addressRules(port);
    expect(await rules.check('http://127.0.0.1:45123/stelle')).toEqual({ ok: true });
    for (const url of [
      'http://127.0.0.1:45124/', 'https://127.0.0.1:45123/', 'http://localhost:45123/', 'http://u:p@127.0.0.1:45123/',
      'http://192.168.1.1/', 'https://www.example.com/', 'not a url',
    ]) expect((await rules.check(url)).ok).toBe(false);
    expect(rules.addressOk('127.0.0.1')).toBe(true);
    expect(rules.addressOk('93.184.216.34')).toBe(false);
  });

  it('BP_FAKE_MAIL=1 counts as fake mail; a bad or privileged port turns test pages off', () => {
    expect(testPagesPort({ ...TEST_MODE, BP_FAKE_MAIL: '1' }, [])).toBe(45123);
    for (const bad of ['', 'abc', '80', '70000', '45123x']) {
      expect(testPagesPort({ ...TEST_MODE, BP_TEST_PAGES_PORT: bad }, ['--fake-mail'])).toBeNull();
    }
  });
});
