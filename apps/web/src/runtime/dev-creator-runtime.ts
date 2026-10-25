import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';

type Resource = { path: string; sha256: string; kind: string };

// Development uses the current checkout's CLI. Packaged dependencies may have
// been prepared by another worktree, so never execute their cached CLI directly.
export function resolveDevCreatorRuntimeRoot(repositoryRoot: string): string | undefined {
  const configured = process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT?.trim();
  if (configured) return resolve(configured);
  const dependencyRoot = join(repositoryRoot, 'apps/desktop/.pack/creator-runtime/krillinai');
  if (!existsSync(join(dependencyRoot, 'manifest.json'))) return undefined;
  const buildRoot = join(repositoryRoot, '.runtime/build/krillinai', `${process.platform}-${process.arch}`);
  execFileSync(process.execPath, [join(repositoryRoot, 'scripts/build-krillinai.mjs')], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      OPENCREATOR_KRILLINAI_TARGET_PLATFORM: process.platform,
      OPENCREATOR_KRILLINAI_TARGET_ARCH: process.arch,
      OPENCREATOR_KRILLINAI_BUILD_OUTPUT: buildRoot
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return prepareDevCreatorRuntime({
    dependencyRoot,
    buildRoot,
    outputRoot: join(repositoryRoot, '.runtime/dev/creator-runtime/krillinai')
  });
}

export function prepareDevCreatorRuntime(input: {
  dependencyRoot: string; buildRoot: string; outputRoot: string;
}): string {
  const base = JSON.parse(readFileSync(join(input.dependencyRoot, 'manifest.json'), 'utf8'));
  const build = JSON.parse(readFileSync(join(input.buildRoot, 'manifest.json'), 'utf8'));
  if ([base, build].some(value => value.platform !== process.platform || value.arch !== process.arch)) {
    throw new Error('Creator development runtime platform mismatch');
  }
  const cli = build.binaries?.['krillinai-cli'];
  const cliPath = `bin/krillinai-cli${process.platform === 'win32' ? '.exe' : ''}`;
  if (cli?.path !== cliPath || !/^[a-f0-9]{64}$/.test(cli.sha256)
    || !base.resources.some((resource: Resource) => resource.path === cliPath)) {
    throw new Error('Creator development CLI build is incomplete');
  }
  const cliBytes = readFileSync(join(input.buildRoot, cliPath));
  if (sha256(cliBytes) !== cli.sha256) throw new Error('Creator development CLI hash mismatch');
  const origin = {
    sourceCommit: build.sourceCommit,
    sourceSha256: build.sourceSha256,
    cliVersion: build.componentVersion,
    cliSource: { kind: 'local-source', revision: build.sourceCommit }
  };
  const record = JSON.stringify({
    ...JSON.parse(readFileSync(join(input.dependencyRoot, 'build-record.json'), 'utf8')),
    ...origin
  }, null, 2) + '\n';
  const manifest = JSON.stringify({
    ...base, ...origin,
    resources: base.resources.map((resource: Resource) => ({
      ...resource,
      sha256: resource.path === cliPath ? cli.sha256
        : resource.path === 'build-record.json' ? sha256(record) : resource.sha256
    }))
  }, null, 2) + '\n';
  // Include the dependency location: two checkouts must not share linked assets.
  const destination = join(input.outputRoot, sha256('dev-runtime-v1:' + resolve(input.dependencyRoot) + manifest));
  if (existsSync(destination)) {
    if (readFileSync(join(destination, 'manifest.json'), 'utf8') !== manifest
      || sha256(readFileSync(join(destination, cliPath))) !== cli.sha256
      || readFileSync(join(destination, 'build-record.json'), 'utf8') !== record) {
      throw new Error('Creator development runtime cache is inconsistent');
    }
    return destination;
  }
  mkdirSync(input.outputRoot, { recursive: true });
  const staging = mkdtempSync(join(input.outputRoot, '.preparing-'));
  try {
    for (const entry of readdirSync(input.dependencyRoot, { withFileTypes: true })) {
      if (['manifest.json', 'build-record.json', 'bin'].includes(entry.name)) continue;
      const source = resolve(input.dependencyRoot, entry.name);
      const target = join(staging, entry.name);
      if (entry.isDirectory()) symlinkSync(source, target, 'junction');
      else copyFileSync(source, target, constants.COPYFILE_FICLONE);
    }
    mkdirSync(join(staging, 'bin'));
    for (const entry of readdirSync(join(input.dependencyRoot, 'bin'))) {
      if (`bin/${entry}` !== cliPath) copyFileSync(resolve(input.dependencyRoot, 'bin', entry), join(staging, 'bin', entry), constants.COPYFILE_FICLONE);
    }
    // Copy rather than link the build output: later builds may replace it.
    copyFileSync(join(input.buildRoot, cliPath), join(staging, cliPath));
    if (sha256(readFileSync(join(staging, cliPath))) !== cli.sha256) throw new Error('Creator CLI changed while preparing development runtime');
    writeFileSync(join(staging, 'build-record.json'), record);
    writeFileSync(join(staging, 'manifest.json'), manifest);
    try {
      renameSync(staging, destination);
    } catch (error) {
      // Two Vite servers may prepare the same immutable version concurrently.
      if (!existsSync(join(destination, 'manifest.json'))
        || readFileSync(join(destination, 'manifest.json'), 'utf8') !== manifest
        || sha256(readFileSync(join(destination, cliPath))) !== cli.sha256) throw error;
    }
    return destination;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
