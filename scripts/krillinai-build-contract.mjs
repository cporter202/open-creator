import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const binaryNames = ['krillinai-cli', 'krillinai-server'];
const identityFields = [
  'componentVersion', 'sourceCommit', 'sourceSha256', 'buildRecipeSha256', 'platform', 'arch'
];

export function krillinBuildIdentity({ rootDir, platform, arch, version }) {
  let sourceCommit = 'unknown';
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch { /* Source archives may not include Git metadata. */ }
  const recipe = createHash('sha256');
  for (const path of ['scripts/build-krillinai.mjs', 'scripts/download-go-modules.mjs', 'scripts/krillinai-build-contract.mjs']) {
    recipe.update(path).update('\0').update(readFileSync(join(rootDir, path))).update('\0');
  }
  return {
    componentVersion: version ?? JSON.parse(readFileSync(join(rootDir, 'apps/desktop/package.json'), 'utf8')).version,
    sourceCommit,
    sourceSha256: hashKrillinSource(join(rootDir, 'runtime/krillinai')),
    buildRecipeSha256: recipe.digest('hex'),
    platform,
    arch
  };
}

export function assertKrillinBuildIdentity(actual, expected) {
  for (const field of identityFields) {
    if (actual?.[field] !== expected[field]) {
      throw new Error(`KrillinAI build does not match current source/target: ${field}; rebuild required`);
    }
  }
}

export function verifyKrillinBuild(buildRoot, expected) {
  const manifest = JSON.parse(readFileSync(join(buildRoot, 'manifest.json'), 'utf8'));
  assertKrillinBuildIdentity(manifest, expected);
  if (manifest.version !== 1 || manifest.component !== 'opencreator-krillinai' || manifest.buildVcs !== false
    || Object.keys(manifest.binaries ?? {}).sort().join(',') !== binaryNames.join(',')) {
    throw new Error('KrillinAI build manifest is invalid');
  }
  for (const name of binaryNames) {
    const binary = manifest.binaries[name];
    if (!/^[a-f0-9]{64}$/.test(binary?.sha256 ?? '')) {
      throw new Error(`KrillinAI build manifest is missing ${name}`);
    }
    for (const path of [binary.path, binary.artifact]) {
      const absolute = resolveBuildPath(buildRoot, path);
      if (!statSync(absolute).isFile() || hashKrillinFile(absolute) !== binary.sha256) {
        throw new Error(`KrillinAI build binary hash mismatch: ${name}`);
      }
    }
  }
  return manifest;
}

export function resolveBuildPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw new Error('Invalid KrillinAI build path');
  const absolute = resolve(root, path);
  const inside = relative(resolve(root), absolute);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('KrillinAI build path escapes its root');
  }
  return absolute;
}

export function hashKrillinFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function hashKrillinSource(root) {
  const files = [];
  visit(root);
  const digest = createHash('sha256');
  for (const path of files.sort()) {
    digest.update(relative(root, path).replaceAll('\\', '/')).update('\0');
    digest.update(readFileSync(path)).update('\0');
  }
  return digest.digest('hex');

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (['.git', 'build', 'dist', '.tmp', 'bin', 'models', 'uploads', '.DS_Store'].includes(entry.name)
        || entry.name.endsWith('.log')
        || (current === join(root, 'config') && entry.name === 'config.toml')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
}
