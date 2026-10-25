import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadGoModules } from './download-go-modules.mjs';
import {
  assertKrillinBuildIdentity,
  hashKrillinFile as hashFile,
  krillinBuildIdentity,
  verifyKrillinBuild
} from './krillinai-build-contract.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(scriptPath), '..');
const sourceRoot = join(rootDir, 'runtime', 'krillinai');
const targetPlatform = normalizePlatform(
  process.env.OPENCREATOR_KRILLINAI_TARGET_PLATFORM
    ?? process.env.OPENCREATOR_DESKTOP_TARGET_PLATFORM
    ?? process.env.OPENCREATOR_CREATOR_RUNTIME_PLATFORM
    ?? process.platform
);
const targetArch = normalizeArch(
  process.env.OPENCREATOR_KRILLINAI_TARGET_ARCH
    ?? process.env.OPENCREATOR_DESKTOP_TARGET_ARCH
    ?? process.env.OPENCREATOR_CREATOR_RUNTIME_ARCH
    ?? process.arch
);
const target = `${targetPlatform}-${targetArch}`;
const outputRoot = resolve(
  process.env.OPENCREATOR_KRILLINAI_BUILD_OUTPUT
    ?? join(rootDir, '.runtime', 'build', 'krillinai', target)
);
const binDir = join(outputRoot, 'bin');
const artifactDir = join(outputRoot, 'artifacts');
const executableSuffix = targetPlatform === 'win32' ? '.exe' : '';
const version = process.env.OPENCREATOR_VERSION?.trim()
  || JSON.parse(readFileSync(join(rootDir, 'apps', 'desktop', 'package.json'), 'utf8')).version;
const identityOptions = { rootDir, platform: targetPlatform, arch: targetArch, version };
const identity = krillinBuildIdentity(identityOptions);
const testOnly = process.argv.includes('--test-only');
const runTests = testOnly || process.argv.includes('--test');
const targets = [
  { name: 'krillinai-cli', package: './cmd/cli', versionPackage: 'krillin-ai/internal/cli.Version' },
  { name: 'krillinai-server', package: './cmd/server' }
];

if (!existsSync(join(sourceRoot, 'go.mod'))) {
  throw new Error(`KrillinAI source is missing: ${sourceRoot}`);
}

if (runTests) {
  prepareGoModules(nativeGoEnvironment());
  runGo(['test', './...'], nativeGoEnvironment());
}
if (testOnly) {
  console.log(JSON.stringify({ ok: true, tested: sourceRoot }));
  process.exit(0);
}

const manifestPath = join(outputRoot, 'manifest.json');
if (
  process.env.OPENCREATOR_FORCE_KRILLINAI_BUILD !== '1'
  && canReuseBuild(manifestPath)
) {
  console.log(JSON.stringify({ ok: true, reused: true, outputRoot }));
  process.exit(0);
}

rmSync(manifestPath, { force: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });
if (!runTests) prepareGoModules(targetGoEnvironment());

const binaries = {};
for (const targetBinary of targets) {
  const fileName = `${targetBinary.name}${executableSuffix}`;
  const outputPath = join(binDir, fileName);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  const ldflags = [
    '-s',
    '-w',
    ...(targetBinary.versionPackage === undefined
      ? []
      : ['-X', `${targetBinary.versionPackage}=${version}`])
  ].join(' ');
  rmSync(temporaryPath, { force: true });
  runGo([
    'build',
    '-buildvcs=false',
    '-trimpath',
    '-ldflags',
    ldflags,
    '-o',
    temporaryPath,
    targetBinary.package
  ], targetGoEnvironment());
  rmSync(outputPath, { force: true });
  renameSync(temporaryPath, outputPath);
  if (targetPlatform !== 'win32') chmodSync(outputPath, 0o755);
  verifyNoVcsMetadata(outputPath);
  if (targetBinary.name === 'krillinai-cli' && isNativeTarget()) {
    verifyCli(outputPath);
  }
  const artifactPath = join(
    artifactDir,
    `${targetBinary.name}-${targetPlatform}-${targetArch}${executableSuffix}`
  );
  copyFileSync(outputPath, artifactPath);
  if (targetPlatform !== 'win32') chmodSync(artifactPath, 0o755);
  binaries[targetBinary.name] = {
    path: relative(outputRoot, outputPath).replaceAll('\\', '/'),
    sha256: hashFile(outputPath),
    artifact: relative(outputRoot, artifactPath).replaceAll('\\', '/')
  };
}

const manifest = {
  version: 1,
  component: 'opencreator-krillinai',
  ...identity,
  goVersion: commandOutput('go', ['version']),
  buildVcs: false,
  binaries
};
// Never label a binary with a source snapshot that changed during compilation.
assertKrillinBuildIdentity(identity, krillinBuildIdentity(identityOptions));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, reused: false, outputRoot, binaries }));

function canReuseBuild(path) {
  if (!existsSync(path)) return false;
  try {
    verifyKrillinBuild(outputRoot, identity);
    assertKrillinBuildIdentity(identity, krillinBuildIdentity(identityOptions));
    return true;
  } catch {
    return false;
  }
}

function runGo(args, env) {
  execFileSync('go', args, {
    cwd: sourceRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
}

function prepareGoModules(env) {
  downloadGoModules({ cwd: sourceRoot, env: { ...process.env, ...env } });
}

function nativeGoEnvironment() {
  return {
    GOFLAGS: `${process.env.GOFLAGS ?? ''} -buildvcs=false`.trim()
  };
}

function targetGoEnvironment() {
  return {
    ...nativeGoEnvironment(),
    GOOS: targetPlatform === 'win32' ? 'windows' : targetPlatform,
    GOARCH: targetArch === 'x64' ? 'amd64' : targetArch,
    CGO_ENABLED: '0'
  };
}

function verifyCli(path) {
  const output = execFileSync(path, ['--help'], {
    cwd: sourceRoot,
    env: minimalEnvironment(process.env),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    windowsHide: true
  });
  if (!/krillinai-cli <command>/i.test(output)) {
    throw new Error('KrillinAI CLI emitted an unexpected help response');
  }
}

function verifyNoVcsMetadata(path) {
  const metadata = commandOutput('go', ['version', '-m', path]);
  if (/\bbuild\s+vcs(?:\.modified|\.revision|\.time)?=/m.test(metadata)) {
    throw new Error(`KrillinAI binary contains VCS metadata: ${path}`);
  }
}

function isNativeTarget() {
  return targetPlatform === normalizePlatform(process.platform)
    && targetArch === normalizeArch(process.arch);
}

function commandOutput(command, args, cwd = rootDir) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function minimalEnvironment(env) {
  const names = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']
    : ['HOME', 'TMPDIR', 'LANG', 'LC_ALL'];
  return Object.fromEntries(names.flatMap(name => (
    env[name] === undefined ? [] : [[name, env[name]]]
  )));
}

function normalizePlatform(value) {
  if (value === 'mac') return 'darwin';
  if (value === 'win') return 'win32';
  if (['darwin', 'win32', 'linux'].includes(value)) return value;
  throw new Error(`Unsupported KrillinAI target platform: ${value}`);
}

function normalizeArch(value) {
  if (value === 'amd64') return 'x64';
  if (['x64', 'arm64'].includes(value)) return value;
  throw new Error(`Unsupported KrillinAI target architecture: ${value}`);
}
