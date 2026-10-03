import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

const allowScripts = (
  JSON.parse(read('package.json')) as {
    allowScripts: Record<string, boolean>;
  }
).allowScripts;

/**
 * Install scripts of dependencies run only when they are reviewed and approved (ADR-0108). npm fails
 * the install when a dependency brings an install script that `allowScripts` does not cover.
 */
describe('Dependency install scripts (ADR-0108)', () => {
  it('fails the install on any unreviewed install script', () => {
    expect(read('.npmrc')).toMatch(/^strict-allow-scripts=true$/m);
  });

  it('approves no install script: every reviewed one is denied', () => {
    const approved = Object.entries(allowScripts)
      .filter(([, allowed]) => allowed)
      .map(([name]) => name);

    expect(approved).toEqual([]);
  });

  it('never runs the install telemetry of @scarf/scarf', () => {
    expect(allowScripts['@scarf/scarf']).toBe(false);
  });

  it('writes name-only entries, so a new version of a reviewed package keeps its decision', () => {
    const pinned = Object.keys(allowScripts).filter((name) => /.@/.test(name));

    expect(pinned).toEqual([]);
  });

  it('applies the same policy when Docker installs dependencies', () => {
    const dockerfile = read('Dockerfile');
    // Every `npm ci` of an image, with options or without (ADR-0147).
    const installs = [...dockerfile.matchAll(/^RUN npm ci\b/gm)].length;
    const copies = [...dockerfile.matchAll(/^COPY [^\n]*\.npmrc[^\n]*$/gm)]
      .length;

    expect(installs).toBeGreaterThan(0);
    expect(copies).toBe(installs);
  });
});
