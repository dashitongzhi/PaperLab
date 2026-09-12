// paperlab/lib/skill/installer.js — install/uninstall skills.
//
// v1 install protocol:
//   1. Resolve `<author>/<name>@<version>` against a registry index.
//   2. If a git URL is configured for that entry, `git clone` into
//      ~/.paperlab/cache/<author>/<name>/ + checkout the version tag.
//   3. Validate manifest.yaml + SKILL.md.
//   4. Symlink (or copy) into ~/.paperlab/marketplace/<author>/<name>@<version>/
//   5. Record in registry.json.
//
// `pa skill install kral/enrichment-consistency@0.1.0` is the canonical
// invocation. If the registry is unavailable (offline / no network), the
// installer accepts `--from <local-path>` for local-only installs.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadManifest } from './manifest.js';
import { MARKET_DIR, CACHE_DIR, recordInstall, removeInstalled } from './store.js';

const REGISTRY_URL = process.env.PAPERLAB_REGISTRY_URL
  || 'https://github.com/kral/paper-skills-registry';

/**
 * Resolve a paperlab skill ref into a concrete git URL + ref to checkout.
 *
 * Accepts:
 *   author/name                     → registry lookup (default registry URL)
 *   author/name@version             → registry lookup, pinned
 *   github:owner/repo               → https://github.com/owner/repo.git @ latest tag
 *   github:owner/repo@ref           → https://github.com/owner/repo.git @ ref
 *   https://github.com/owner/repo    → same as github:
 *   https://github.com/owner/repo/tree/<ref>      → @ref
 *   https://github.com/owner/repo/blob/<ref>/path  → @ref (path recorded)
 *   /local/path                     → local install (no git)
 */
export function resolveRef(ref) {
  // Local path
  if (ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('~')) {
    return { kind: 'local', path: ref };
  }

  // Full GitHub URL
  const urlMatch = ref.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+))?(?:\/(.+))?$/);
  if (urlMatch) {
    return {
      kind: 'github',
      owner: urlMatch[1],
      repo: urlMatch[2],
      ref: urlMatch[3] || null,
      subpath: urlMatch[4] || null,
      url: `https://github.com/${urlMatch[1]}/${urlMatch[2]}.git`,
    };
  }

  // github:owner/repo[@ref]
  const ghMatch = ref.match(/^github:([\w.-]+)\/([\w.-]+?)(?:@([\w.+/-]+))?$/);
  if (ghMatch) {
    return {
      kind: 'github',
      owner: ghMatch[1],
      repo: ghMatch[2],
      ref: ghMatch[3] || null,
      subpath: null,
      url: `https://github.com/${ghMatch[1]}/${ghMatch[2]}.git`,
    };
  }

  // author/name[@version] — registry lookup
  const regMatch = ref.match(/^([\w.-]+)\/([\w.-]+?)(?:@([\w.+-]+))?$/);
  if (regMatch) {
    return {
      kind: 'registry',
      author: regMatch[1],
      name: regMatch[2],
      version: regMatch[3] || 'latest',
    };
  }

  throw new Error(`invalid skill ref: ${ref}`);
}

export function parseRef(ref) {
  const r = resolveRef(ref);
  if (r.kind === 'registry') return { author: r.author, name: r.name, version: r.version };
  throw new Error(`parseRef only handles registry refs; use resolveRef for github/local`);
}

export function installSkill(ref, opts = {}) {
  // --from overrides ref entirely: install from a local directory.
  if (opts.from) {
    return installFromLocal(opts.from, opts);
  }

  const resolved = resolveRef(ref);

  if (resolved.kind === 'local') {
    return installFromLocal(resolved.path, opts);
  }
  if (resolved.kind === 'github') {
    return installFromGithub(resolved, opts);
  }
  // registry
  return installFromRegistry(ref, resolved, opts);
}

function installFromLocal(localPath) {
  const manifest = loadManifest(localPath);
  const dirName = path.basename(localPath);
  // Derive author/name from directory path best-effort; if not possible, use 'local'.
  const installDir = path.join(MARKET_DIR, 'local', dirName);
  fs.mkdirSync(path.dirname(installDir), { recursive: true });
  if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
  try {
    fs.symlinkSync(path.resolve(localPath), installDir, 'dir');
  } catch (e) {
    copyDir(localPath, installDir);
  }
  const entry = recordInstall({
    author: 'local', name: dirName, version: manifest.version,
    source: `local:${path.resolve(localPath)}`,
    installPath: installDir, manifest,
  });
  return entry;
}

function installFromGithub(resolved, opts) {
  const { owner, repo, ref, subpath } = resolved;
  const cacheDir = path.join(CACHE_DIR, 'github', owner, repo);
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(path.join(cacheDir, '.git'))) {
    const r = spawnSync('git', ['clone', resolved.url, cacheDir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`clone failed: ${r.stderr || r.stdout}`);
  } else {
    spawnSync('git', ['-C', cacheDir, 'fetch', '--all', '--tags', '--force'], { encoding: 'utf8' });
  }
  // Determine ref: explicit > latest tag > default branch
  let checkoutRef = ref;
  if (!checkoutRef) {
    const tagsOut = spawnSync('git', ['-C', cacheDir, 'tag', '--sort=-version:refname'], { encoding: 'utf8' });
    const tags = (tagsOut.stdout || '').split(/\r?\n/).filter(Boolean);
    checkoutRef = tags[0] || 'HEAD';
  }
  const co = spawnSync('git', ['-C', cacheDir, 'checkout', checkoutRef], { encoding: 'utf8' });
  if (co.status !== 0) throw new Error(`checkout ${checkoutRef} failed: ${co.stderr}`);

  const skillRoot = subpath ? path.join(cacheDir, subpath) : cacheDir;
  if (!fs.existsSync(skillRoot)) {
    throw new Error(`subpath ${subpath} not in repo ${owner}/${repo}@${checkoutRef}`);
  }

  const manifest = loadManifest(skillRoot);
  const installDir = path.join(MARKET_DIR, owner, `${repo}@${manifest.version}`);
  fs.mkdirSync(path.dirname(installDir), { recursive: true });
  if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
  try {
    fs.symlinkSync(skillRoot, installDir, 'dir');
  } catch (e) {
    copyDir(skillRoot, installDir);
  }
  const entry = recordInstall({
    author: owner, name: repo, version: manifest.version,
    source: `github:${resolved.url}@${checkoutRef}${subpath ? ':' + subpath : ''}`,
    installPath: installDir, manifest,
  });
  return entry;
}

function installFromRegistry(origRef, resolved, opts) {
  const { author, name, version } = resolved;
  const cacheDir = path.join(CACHE_DIR, author, name);

  const repoDir = path.join(CACHE_DIR, '_registry');
  fs.mkdirSync(repoDir, { recursive: true });
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    const r = spawnSync('git', ['clone', '--depth', '1', REGISTRY_URL, repoDir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`registry clone failed: ${r.stderr}`);
  } else {
    spawnSync('git', ['-C', repoDir, 'pull', '--ff-only'], { encoding: 'utf8' });
  }
  const indexPath = path.join(repoDir, 'registry.yaml');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`registry has no registry.yaml at ${indexPath}`);
  }
  const index = parseRegistryIndex(fs.readFileSync(indexPath, 'utf8'));
  const entry = index[`${author}/${name}`];
  if (!entry) {
    throw new Error(`skill ${author}/${name} not in registry index`);
  }
  const url = entry.url;
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(path.join(cacheDir, '.git'))) {
    const r = spawnSync('git', ['clone', url, cacheDir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`clone failed: ${r.stderr}`);
  } else {
    spawnSync('git', ['-C', cacheDir, 'fetch', '--all', '--tags'], { encoding: 'utf8' });
  }
  if (version && version !== 'latest') {
    const r = spawnSync('git', ['-C', cacheDir, 'checkout', version], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`checkout ${version} failed: ${r.stderr}`);
  }
  const sourceDir = cacheDir;
  const manifest = loadManifest(sourceDir);
  const resolvedVersion = version === 'latest' ? manifest.version : version;
  const installDir = path.join(MARKET_DIR, author, `${name}@${resolvedVersion}`);
  fs.mkdirSync(path.dirname(installDir), { recursive: true });
  if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
  try {
    fs.symlinkSync(sourceDir, installDir, 'dir');
  } catch (e) {
    copyDir(sourceDir, installDir);
  }
  return recordInstall({
    author, name, version: resolvedVersion,
    source: opts.from ? `local:${opts.from}` : `git:${REGISTRY_URL}`,
    installPath: installDir, manifest,
  });
}

export function uninstallSkill(ref) {
  const { author, name, version } = parseRef(ref);
  const id = `${author}/${name}@${version}`;
  const removed = removeInstalled(id);
  if (!removed) throw new Error(`${id} not installed`);
  const installDir = path.join(MARKET_DIR, author, `${name}@${removed.version}`);
  if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
  return removed;
}

function parseRegistryIndex(text) {
  // Simple flat YAML: "<author>/<name>:\n  url: <git-url>\n  versions:\n    - <v>"
  const out = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const top = raw.match(/^([\w.-]+\/[\w.-]+):\s*$/);
    const sub = raw.match(/^\s+([\w]+):\s*(.*)$/);
    if (top) {
      current = top[1];
      out[current] = { url: '', versions: [] };
    } else if (sub && current) {
      if (sub[1] === 'url') out[current].url = sub[2].trim();
      else if (sub[1] === 'versions') out[current].versions.push(sub[2].trim());
    }
  }
  return out;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else if (entry.isFile()) fs.copyFileSync(sp, dp);
  }
}
