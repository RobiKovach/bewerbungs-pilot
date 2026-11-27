// What a release zip contains (paths from the repo root). Kept apart from release.mjs, which builds on import.
export const RELEASE_FILES = [
  'package.json', 'package-lock.json', 'LICENSE', 'README.md', 'CHANGELOG.md',
  'server/package.json', 'server/dist', 'server/assets', 'web/package.json', 'web/dist', 'installer',
];
