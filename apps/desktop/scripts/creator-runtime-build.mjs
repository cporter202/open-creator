import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashKrillinFile, krillinBuildIdentity, verifyKrillinBuild } from '../../../scripts/krillinai-build-contract.mjs';
import { verifyCreatorRuntime } from './creator-runtime-contract.mjs';

const defaultRootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Package self-consistency alone cannot establish that a cached CLI is current.
export function verifyCreatorRuntimeBuild(runtimeRoot, platform, arch, options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const buildRoot = options.buildRoot ?? process.env.OPENCREATOR_KRILLINAI_BUILD_OUTPUT
    ?? join(rootDir, '.runtime/build/krillinai', `${platform}-${arch}`);
  const build = verifyKrillinBuild(buildRoot, krillinBuildIdentity({ rootDir, platform, arch }));
  const runtime = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8'));
  const record = JSON.parse(readFileSync(join(runtimeRoot, 'build-record.json'), 'utf8'));
  for (const metadata of [runtime, record]) {
    if (metadata.cliVersion !== build.componentVersion
      || metadata.sourceCommit !== build.sourceCommit
      || metadata.sourceSha256 !== build.sourceSha256
      || metadata.platform !== build.platform || metadata.arch !== build.arch
      || metadata.krillinBuild?.buildRecipeSha256 !== build.buildRecipeSha256
      || metadata.krillinBuild?.cliSha256 !== build.binaries['krillinai-cli'].sha256) {
      throw new Error('Packaged KrillinAI CLI does not match the current source build; rebuild required');
    }
  }
  verifyCreatorRuntime(runtimeRoot, platform, arch);
  const cliSha256 = hashKrillinFile(join(runtimeRoot, 'bin', `krillinai-cli${platform === 'win32' ? '.exe' : ''}`));
  if (runtime.cliSigning !== undefined) {
    if (!options.allowSigned || platform !== 'darwin'
      || runtime.cliSigning.unsignedSha256 !== build.binaries['krillinai-cli'].sha256
      || runtime.cliSigning.signedSha256 !== cliSha256) {
      throw new Error('Packaged KrillinAI CLI signing record does not match the current build');
    }
  } else if (cliSha256 !== build.binaries['krillinai-cli'].sha256) {
    throw new Error('Packaged KrillinAI CLI binary hash mismatch with the current source build');
  }
  return runtime;
}
