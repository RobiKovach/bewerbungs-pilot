// Manual check that the Arbeitsagentur API still answers the way BewerbungsPilot expects.
// Run: npm run check:arbeitsagentur   (never part of npm test)
const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service';
const HEADERS = { 'X-API-Key': 'jobboerse-jobsuche', Accept: 'application/json' };

async function get(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function count(label, params) {
  const q = new URLSearchParams({ was: 'Webentwickler', wo: 'Berlin', umkreis: '25', size: '1', veroeffentlichtseit: '30', ...params });
  const r = await get(`${BASE}/pc/v6/jobs?${q}`);
  console.log(`${label.padEnd(28)} HTTP ${r.status}  maxErgebnisse=${r.body?.maxErgebnisse}`);
  return r;
}

const base = await count('base (no filters)', {});
const first = base.body?.ergebnisliste?.[0];
if (!first) { console.log('No result - try again later or change the query.'); process.exit(1); }
console.log('\nKeys of one search hit:', Object.keys(first).sort().join(', '));
console.log('stellenlokationen[0]:', JSON.stringify(first.stellenlokationen?.[0]));
await count('angebotsart=1 (work)', { angebotsart: '1' });
await count('angebotsart=4 (apprenticeship)', { angebotsart: '4' });
await count('angebotsart=34 (internship)', { angebotsart: '34' });
await count('arbeitszeit=vz', { angebotsart: '1', arbeitszeit: 'vz' });
await count('arbeitszeit=tz', { angebotsart: '1', arbeitszeit: 'tz' });
await count('arbeitszeit=mj', { angebotsart: '1', arbeitszeit: 'mj' });
await count('arbeitszeit=vz;tz', { angebotsart: '1', arbeitszeit: 'vz;tz' });
await count('zeitarbeit=false', { angebotsart: '1', zeitarbeit: 'false' });

const refnr = first.referenznummer;
const d = await get(`${BASE}/pc/v4/jobdetails/${Buffer.from(refnr).toString('base64')}`);
console.log(`\ndetails ${refnr}: HTTP ${d.status}`);
console.log('Keys of details:', d.body ? Object.keys(d.body).sort().join(', ') : '(no JSON)');
console.log('Description starts:', String(d.body?.stellenangebotsBeschreibung ?? '').slice(0, 200));
const gone = await get(`${BASE}/pc/v4/jobdetails/${Buffer.from('10000-0000000000-S').toString('base64')}`);
console.log(`details of a non-existing offer: HTTP ${gone.status}`);
