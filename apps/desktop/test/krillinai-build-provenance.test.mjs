import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashKrillinFile, krillinBuildIdentity, verifyKrillinBuild } from '../../../scripts/krillinai-build-contract.mjs';
import { verifyCreatorRuntime } from '../scripts/creator-runtime-contract.mjs';
import { verifyCreatorRuntimeBuild } from '../scripts/creator-runtime-build.mjs';
import { signCreatorRuntimeBundle } from '../scripts/sign-creator-runtime-after-pack.mjs';
import { createKrillinBuildFixture, runtimeBuildMetadata } from './helpers/krillinai-build.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('KrillinAI source build provenance', () => {
  it('accepts the current source and both verified build artifacts', () => {
    const fixture = createFixture();
    expect(() => verify(fixture)).not.toThrow();
  });

  it('rejects an internally consistent old runtime after an uncommitted source change', () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.rootDir, 'runtime/krillinai/main.go'), 'package main\n// new progress events');
    expect(() => verifyCreatorRuntime(fixture.runtimeRoot, 'darwin', 'arm64')).not.toThrow();
    expect(() => verify(fixture)).toThrow('sourceSha256');
  });

  it.each(['componentVersion', 'sourceCommit', 'sourceSha256', 'buildRecipeSha256', 'platform', 'arch'])(
    'rejects a stale or mismatched build %s', field => {
      const fixture = createFixture();
      const build = { ...fixture.manifest, [field]: 'old' };
      writeFileSync(join(fixture.buildRoot, 'manifest.json'), JSON.stringify(build));
      expect(() => verify(fixture)).toThrow(field);
    }
  );

  it.each(['krillinai-build-contract.mjs', 'download-go-modules.mjs'])('includes %s changes in the build recipe', helper => {
    const fixture = createFixture();
    writeFileSync(join(fixture.rootDir, 'scripts', helper), '// updated build helper');
    expect(() => verify(fixture)).toThrow('buildRecipeSha256');
  });

  it('checks cached artifacts as well as the binary used for packaging', () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.buildRoot, 'artifacts/krillinai-cli'), 'old CLI');
    expect(() => verifyKrillinBuild(fixture.buildRoot, identity(fixture))).toThrow('hash mismatch');
  });

  it('rejects an old copied CLI even if its runtime file hashes were regenerated', () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.runtimeRoot, 'bin/krillinai-cli'), 'old CLI');
    refreshRuntime(fixture);
    expect(() => verifyCreatorRuntime(fixture.runtimeRoot, 'darwin', 'arm64')).not.toThrow();
    expect(() => verify(fixture)).toThrow('binary hash mismatch');
  });

  it('rejects stale build records even if the runtime manifest claims the current source', () => {
    const fixture = createFixture();
    const record = { ...runtimeBuildMetadata(fixture.manifest), sourceSha256: 'a'.repeat(64) };
    writeFileSync(join(fixture.runtimeRoot, 'build-record.json'), JSON.stringify(record));
    refreshRuntime(fixture);
    expect(() => verify(fixture)).toThrow('does not match the current source build');
  });

  it('blocks signing an old CLI before the signing tool is called', async () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.runtimeRoot, 'bin/krillinai-cli'), 'old CLI');
    refreshRuntime(fixture);
    const signBinary = vi.fn();
    await expect(signCreatorRuntimeBundle({
      electronPlatformName: 'darwin', appOutDir: join(fixture.rootDir, 'app'),
      packager: { appInfo: { productFilename: 'OpenCreator' } }
    }, {
      ...fixture, env: { OPENCREATOR_DESKTOP_TARGET_ARCH: 'arm64' }, signBinary
    })).rejects.toThrow('binary hash mismatch');
    expect(signBinary).not.toHaveBeenCalled();
  });

  it('rejects a signing record for a different source build', () => {
    const fixture = createFixture();
    const manifest = JSON.parse(readFileSync(join(fixture.runtimeRoot, 'manifest.json'), 'utf8'));
    manifest.cliSigning = { unsignedSha256: 'a'.repeat(64), signedSha256: fixture.manifest.binaries['krillinai-cli'].sha256 };
    writeFileSync(join(fixture.runtimeRoot, 'manifest.json'), JSON.stringify(manifest));
    expect(() => verifyCreatorRuntimeBuild(fixture.runtimeRoot, 'darwin', 'arm64', {
      ...fixture, allowSigned: true
    })).toThrow('signing record');
  });
});

function identity(fixture) {
  return krillinBuildIdentity({ rootDir: fixture.rootDir, platform: 'darwin', arch: 'arm64' });
}

function verify(fixture) {
  return verifyCreatorRuntimeBuild(fixture.runtimeRoot, 'darwin', 'arm64', fixture);
}

function createFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), 'krillinai-build-provenance-'));
  roots.push(rootDir);
  const build = createKrillinBuildFixture(rootDir);
  const runtimeRoot = join(rootDir, 'app/OpenCreator.app/Contents/Resources/creator-runtime/krillinai');
  const metadata = runtimeBuildMetadata(build.manifest);
  const files = {
    'bin/ffmpeg': 'ffmpeg', 'bin/ffprobe': 'ffprobe', 'bin/yt-dlp': 'yt-dlp',
    'build-record.json': JSON.stringify(metadata)
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(runtimeRoot, path)), { recursive: true });
    writeFileSync(join(runtimeRoot, path), content);
  }
  copyFileSync(join(build.buildRoot, 'bin/krillinai-cli'), join(runtimeRoot, 'bin/krillinai-cli'));
  const runtime = {
    version: 1, runtimeMode: 'cli', ...metadata, integrationPatchSha256: 'a'.repeat(64),
    ytDlp: { mode: 'standalone', version: 'test', executable: 'bin/yt-dlp' },
    resources: ['bin/krillinai-cli', ...Object.keys(files)].map(path => ({
      path, kind: path.startsWith('bin/') ? 'executable' : 'asset', sha256: hashKrillinFile(join(runtimeRoot, path))
    }))
  };
  writeFileSync(join(runtimeRoot, 'manifest.json'), JSON.stringify(runtime));
  return { ...build, runtimeRoot };
}

function refreshRuntime(fixture) {
  const path = join(fixture.runtimeRoot, 'manifest.json');
  const runtime = JSON.parse(readFileSync(path, 'utf8'));
  for (const resource of runtime.resources) resource.sha256 = hashKrillinFile(join(fixture.runtimeRoot, resource.path));
  writeFileSync(path, JSON.stringify(runtime));
}
