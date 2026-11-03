// Packs the CONTENTS of a folder into a zip with forward-slash entry names (installer/install.ps1 at the root of the
// zip). PowerShell 5.1 Compress-Archive writes backslashes, which the in-app updater (like the backup restore)
// rightly refuses, so releases are packed here with yazl.
import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';

function listFiles(dir, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...listFiles(dir, r));
    else if (d.isFile()) out.push(r);
  }
  return out.sort();
}

/** Resolves when `zipFile` is fully written. Empty folders are not stored (the installer creates what it needs). */
export function packFolder(folder, zipFile) {
  const zip = new yazl.ZipFile();
  for (const rel of listFiles(folder)) zip.addFile(path.join(folder, ...rel.split('/')), rel);
  const out = fs.createWriteStream(zipFile);
  return new Promise((resolve, reject) => {
    out.once('error', reject);
    zip.outputStream.once('error', reject);
    out.once('close', resolve);
    zip.outputStream.pipe(out);
    zip.end();
  });
}
