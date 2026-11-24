import fs from 'node:fs';

/** Removes a temp folder; a folder Windows still holds (EBUSY, e.g. a process that is just ending) is left to the system. */
export async function removeTemp(dir: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
