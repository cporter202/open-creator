import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hashKrillinFile, krillinBuildIdentity } from '../../../../scripts/krillinai-build-contract.mjs';

export function createKrillinBuildFixture(rootDir, options = {}) {
  const platform = options.platform ?? 'darwin';
  const arch = options.arch ?? 'arm64';
  const buildRoot = join(rootDir, 'build');
  const files = {
    'apps/desktop/package.json': JSON.stringify({ version: options.version ?? 'test' }),
    'scripts/build-krillinai.mjs': '// build recipe',
    'scripts/download-go-modules.mjs': '// module downloader',
    'scripts/krillinai-build-contract.mjs': '// build contract',
    'runtime/krillinai/main.go': 'package main\nfunc main() {}',
    'build/bin/krillinai-cli': 'krillin',
    'build/bin/krillinai-server': 'server',
    'build/artifacts/krillinai-cli': 'krillin',
    'build/artifacts/krillinai-server': 'server'
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(rootDir, path)), { recursive: true });
    writeFileSync(join(rootDir, path), content);
  }
  const manifest = {
    version: 1, component: 'opencreator-krillinai', buildVcs: false,
    ...krillinBuildIdentity({ rootDir, platform, arch }),
    binaries: Object.fromEntries(['krillinai-cli', 'krillinai-server'].map(name => [name, {
      path: `bin/${name}`, artifact: `artifacts/${name}`, sha256: hashKrillinFile(join(buildRoot, 'bin', name))
    }]))
  };
  writeFileSync(join(buildRoot, 'manifest.json'), JSON.stringify(manifest));
  return { rootDir, buildRoot, manifest };
}

export function runtimeBuildMetadata(build) {
  return {
    cliVersion: build.componentVersion, sourceCommit: build.sourceCommit, sourceSha256: build.sourceSha256,
    platform: build.platform, arch: build.arch,
    krillinBuild: { buildRecipeSha256: build.buildRecipeSha256, cliSha256: build.binaries['krillinai-cli'].sha256 }
  };
}
