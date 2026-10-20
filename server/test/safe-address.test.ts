import { describe, it, expect } from 'vitest';
import { checkPublicUrl, isPublicAddress } from '../src/vacancies/sources/safe-address.js';

const publicLookup = async () => ['93.184.216.34'];

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '240.0.0.1', '::', '::1', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:192.168.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:c0a8:101::1', '2001:db8::1',
    'not an ip',
  ])('%s is not public', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '172.32.0.1', '93.184.216.34', '2a00:1450:4001::1', '::ffff:8.8.8.8'])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe('checkPublicUrl', () => {
  it.each([
    ['ftp://x.de/', 'scheme'],
    ['file:///C:/Windows/win.ini', 'scheme'],
    ['https://u:p@x.de/', 'credentials'],
    ['https://u@x.de/', 'credentials'],
    ['https://x.de:22/', 'port'],
    ['http://localhost/', 'host'],
    ['http://localhost./', 'host'],
    ['http://app.localhost/', 'host'],
    ['http://printer/', 'host'],
    ['http://box.local/', 'host'],
    ['http://127.0.0.1:8080/api/health', 'private'],
    ['http://2130706433/', 'private'],
    ['http://[::1]/', 'private'],
    ['not a url', 'scheme'],
  ] as const)('%s → %s', async (url, why) => {
    expect(await checkPublicUrl(url, publicLookup)).toEqual({ ok: false, why });
  });

  it('any private address among the resolved ones → private', async () => {
    expect(await checkPublicUrl('https://jobs.example.de/1', async () => ['93.184.216.34', '10.0.0.5'])).toEqual({ ok: false, why: 'private' });
  });

  it('a lookup that fails or finds nothing → dns', async () => {
    expect(await checkPublicUrl('https://jobs.example.de/1', async () => { throw new Error('ENOTFOUND'); })).toEqual({ ok: false, why: 'dns' });
    expect(await checkPublicUrl('https://jobs.example.de/1', async () => [])).toEqual({ ok: false, why: 'dns' });
  });

  it('a public site on an allowed port → ok', async () => {
    expect(await checkPublicUrl('https://jobs.example.de/123', publicLookup)).toEqual({ ok: true });
    expect(await checkPublicUrl('http://jobs.example.de:8080/123', publicLookup)).toEqual({ ok: true });
    expect(await checkPublicUrl('https://8.8.8.8/', async () => { throw new Error('not called'); })).toEqual({ ok: true });
  });
});
