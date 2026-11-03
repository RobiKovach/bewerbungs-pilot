// Refuses a release whose package.json files disagree about the version.
export function checkVersions(versions) {
  const distinct = new Set(Object.values(versions));
  if (distinct.size !== 1) {
    const list = Object.entries(versions).map(([f, v]) => `${f}=${v}`).join(', ');
    throw new Error(`Release: versions differ (${list}). Bump all package.json files to the same version first.`);
  }
}
