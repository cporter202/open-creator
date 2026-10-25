import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareDevCreatorRuntime, resolveDevCreatorRuntimeRoot } from './dev-creator-runtime.js';

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const build = vi.fn();
  return { ...actual, default: { ...actual, execFileSync: build }, execFileSync: build };
});

const roots: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const cliPath = `bin/krillinai-cli${process.platform === 'win32' ? '.exe' : ''}`;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'creator-dev-runtime-'));
  roots.push(root);
  const input = { repositoryRoot: root, dependencyRoot: join(root, 'apps/desktop/.pack/creator-runtime/krillinai'),
    buildRoot: join(root, '.runtime/build/krillinai', `${process.platform}-${process.arch}`), outputRoot: join(root, 'development') };
  for (const dir of [input.dependencyRoot, input.buildRoot]) mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(input.dependencyRoot, cliPath), 'old-batch-progress');
  writeFileSync(join(input.dependencyRoot, 'bin/ffmpeg'), 'media-dependency');
  writeFileSync(join(input.dependencyRoot, 'subtitle-style.json'), '{}');
  writeFileSync(join(input.dependencyRoot, 'build-record.json'), '{}');
  const resources = [cliPath, 'bin/ffmpeg', 'subtitle-style.json', 'build-record.json'].map(path => ({
    path, sha256: hash(readFileSync(join(input.dependencyRoot, path))), kind: path.startsWith('bin/') ? 'executable' : 'asset'
  }));
  writeFileSync(join(input.dependencyRoot, 'manifest.json'), JSON.stringify({
    version: 1, platform: process.platform, arch: process.arch, sourceCommit: 'old-checkout', resources
  }));
  writeFileSync(join(input.buildRoot, cliPath), 'new-detailed-progress');
  writeFileSync(join(input.buildRoot, 'manifest.json'), JSON.stringify({
    platform: process.platform, arch: process.arch, sourceCommit: 'current-checkout', sourceSha256: 'a'.repeat(64), componentVersion: '3.2.7',
    binaries: { 'krillinai-cli': { path: cliPath, sha256: hash('new-detailed-progress') } }
  }));
  return input;
}

describe('development Creator runtime', () => {
  it('builds from the active checkout before choosing a runtime, overriding inherited cross-build output paths', () => {
    const input = fixture();
    vi.stubEnv('OPENCREATOR_CREATOR_RUNTIME_ROOT', '');
    vi.stubEnv('OPENCREATOR_KRILLINAI_BUILD_OUTPUT', '/another-checkout/build');
    vi.stubEnv('OPENCREATOR_KRILLINAI_TARGET_PLATFORM', 'another-platform');
    const root = resolveDevCreatorRuntimeRoot(input.repositoryRoot)!;
    expect(execFileSync).toHaveBeenCalledWith(process.execPath, [join(input.repositoryRoot, 'scripts/build-krillinai.mjs')], expect.objectContaining({
      cwd: input.repositoryRoot,
      env: expect.objectContaining({
        OPENCREATOR_KRILLINAI_BUILD_OUTPUT: input.buildRoot,
        OPENCREATOR_KRILLINAI_TARGET_PLATFORM: process.platform,
        OPENCREATOR_KRILLINAI_TARGET_ARCH: process.arch
      })
    }));
    expect(readFileSync(join(root, cliPath), 'utf8')).toBe('new-detailed-progress');
  });

  it('runs the current checkout CLI and verifies its manifest without rewriting packaged dependencies', () => {
    const input = fixture();
    const root = prepareDevCreatorRuntime(input);
    expect(readFileSync(join(root, cliPath), 'utf8')).toBe('new-detailed-progress');
    expect(readFileSync(join(input.dependencyRoot, cliPath), 'utf8')).toBe('old-batch-progress');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    expect(manifest.sourceCommit).toBe('current-checkout');
    for (const resource of manifest.resources) {
      expect(lstatSync(join(root, resource.path)).isSymbolicLink()).toBe(false);
      expect(hash(readFileSync(join(root, resource.path)))).toBe(resource.sha256);
    }
    expect(prepareDevCreatorRuntime(input)).toBe(root);
  });

  it('keeps the selected CLI stable when another worktree overwrites the package or a new build appears', () => {
    const input = fixture();
    const root = prepareDevCreatorRuntime(input);
    writeFileSync(join(input.dependencyRoot, cliPath), 'another-worktree');
    writeFileSync(join(input.buildRoot, cliPath), 'next-build');
    expect(readFileSync(join(root, cliPath), 'utf8')).toBe('new-detailed-progress');
    const build = JSON.parse(readFileSync(join(input.buildRoot, 'manifest.json'), 'utf8'));
    build.binaries['krillinai-cli'].sha256 = hash('next-build');
    writeFileSync(join(input.buildRoot, 'manifest.json'), JSON.stringify(build));
    const next = prepareDevCreatorRuntime(input);
    expect(next).not.toBe(root);
    expect(readFileSync(join(next, cliPath), 'utf8')).toBe('next-build');
    expect(readFileSync(join(root, cliPath), 'utf8')).toBe('new-detailed-progress');
  });

  it('rejects mismatched binaries instead of silently using the old package', () => {
    const input = fixture();
    writeFileSync(join(input.buildRoot, cliPath), 'wrong-build');
    expect(() => prepareDevCreatorRuntime(input)).toThrow('hash mismatch');
  });

  it('honors an explicitly configured runtime without requiring a local Go build', () => {
    const input = fixture();
    vi.stubEnv('OPENCREATOR_CREATOR_RUNTIME_ROOT', input.dependencyRoot);
    expect(resolveDevCreatorRuntimeRoot('/missing-checkout')).toBe(input.dependencyRoot);
    vi.stubEnv('OPENCREATOR_CREATOR_RUNTIME_ROOT', '');
    expect(resolveDevCreatorRuntimeRoot('/missing-checkout')).toBeUndefined();
  });
});
