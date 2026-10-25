import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readKrillinRuntimeManifest,
  verifyKrillinRuntimeManifest
} from '../../src/creator/krillin/manifest.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Krillin Runtime 清单校验', () => {
  it.each([false, true])('accepts build provenance from a packaged runtime (signed: %s)', signed => {
    const fixture = createFixture();
    const path = join(fixture.root, 'manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    const cliSha256 = manifest.resources[0].sha256;
    manifest.krillinBuild = { buildRecipeSha256: 'a'.repeat(64), cliSha256 };
    if (signed) manifest.cliSigning = { unsignedSha256: 'b'.repeat(64), signedSha256: cliSha256 };
    writeFileSync(path, JSON.stringify(manifest));

    const parsed = readKrillinRuntimeManifest(fixture.root);
    expect(parsed.krillinBuild).toEqual(manifest.krillinBuild);
    expect(parsed.cliSigning).toEqual(manifest.cliSigning);
    expect(verifyKrillinRuntimeManifest(fixture.root, parsed)).toEqual({ cacheHit: false });
    writeFileSync(fixture.executable, 'tampered-runtime');
    expect(() => verifyKrillinRuntimeManifest(fixture.root, parsed)).toThrow('dependency_hash_mismatch');
  });

  it.each([
    { krillinBuild: { buildRecipeSha256: 'invalid', cliSha256: 'a'.repeat(64) } },
    { cliSigning: { unsignedSha256: 'a'.repeat(64), signedSha256: 'invalid' } },
    { unknownMetadata: true }
  ])('rejects malformed or unknown manifest metadata (%j)', metadata => {
    const fixture = createFixture();
    const path = join(fixture.root, 'manifest.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...metadata }));
    expect(() => readKrillinRuntimeManifest(fixture.root)).toThrow();
  });

  it('缓存完整校验结果，并在资源变化时拒绝缓存', () => {
    const fixture = createFixture();
    const manifest = readKrillinRuntimeManifest(fixture.root);

    expect(verifyKrillinRuntimeManifest(fixture.root, manifest, {
      cachePath: fixture.cachePath
    })).toEqual({ cacheHit: false });
    expect(verifyKrillinRuntimeManifest(fixture.root, manifest, {
      cachePath: fixture.cachePath
    })).toEqual({ cacheHit: true });

    writeFileSync(fixture.executable, 'tampered-runtime');
    expect(() => verifyKrillinRuntimeManifest(fixture.root, manifest, {
      cachePath: fixture.cachePath
    })).toThrow('dependency_hash_mismatch: bin/krillinai-cli');
  });
});

function createFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-krillin-manifest-'));
  const root = join(tempDir, 'runtime');
  const executable = join(root, 'bin', 'krillinai-cli');
  const cachePath = join(tempDir, 'cache', 'krillinai.json');
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, 'packaged-runtime');
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    version: 1,
    platform: process.platform,
    arch: process.arch,
    resources: [{
      path: 'bin/krillinai-cli',
      kind: 'executable',
      sha256: createHash('sha256').update(readFileSync(executable)).digest('hex')
    }]
  }));
  return { root, executable, cachePath };
}
