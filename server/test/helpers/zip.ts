import zlib from 'node:zlib';

/** One entry of a hand-built zip. `declaredSize` lies about the unpacked size; `unixMode` marks e.g. a symlink. */
export interface RawEntry {
  name: string;
  data?: Buffer | string;
  /** 0 = stored, 8 = deflated (default). */
  method?: 0 | 8;
  declaredSize?: number;
  unixMode?: number;
}

// A minimal zip writer for tests: yazl refuses names like `../x`, and hostile archives must still be built byte by byte.
export function rawZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8');
    const method = e.method ?? 8;
    const packed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const size = e.declaredSize ?? data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.unixMode === undefined ? 20 : (3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.unixMode === undefined ? 0 : (e.unixMode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A valid `backup.json` entry; `over` replaces fields (e.g. `{ format: 2 }`). */
export function metaEntry(over: Record<string, unknown> = {}): RawEntry {
  const meta = { format: 1, app: 'bewerbungs-pilot', appVersion: '0.9.0', createdAt: '2026-10-21T08:00:00.000Z', kind: 'manual', ...over };
  return { name: 'backup.json', data: JSON.stringify(meta) };
}
