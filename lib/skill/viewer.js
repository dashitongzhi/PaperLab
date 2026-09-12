// paperlab/lib/skill/viewer.js — read SKILL.md content from a ref without installing.
//
// Supports GitHub raw URLs and local paths. Useful for "is this skill
// right for my paper?" preview without polluting ~/.paperlab/marketplace.

import fs from 'node:fs';
import path from 'node:path';
import { resolveRef } from './installer.js';
import { loadManifest } from './manifest.js';

/**
 * Fetch SKILL.md + manifest.yaml content for a ref.
 * For github: refs, uses raw.githubusercontent.com (no git clone required).
 *
 * @param {string} ref  — accepts github:owner/repo[@ref], https://github.com/..., or local path
 * @returns {Promise<{ref, skillMd: string, manifestYaml: string, source: string, manifest: object}>}
 */
export async function viewRef(ref) {
  const resolved = resolveRef(ref);

  if (resolved.kind === 'local') {
    const p = path.resolve(resolved.path);
    return {
      ref,
      source: `local:${p}`,
      skillMd: readIfExists(path.join(p, 'SKILL.md')),
      manifestYaml: readIfExists(path.join(p, 'manifest.yaml')),
      manifest: safeLoadManifest(p),
    };
  }

  if (resolved.kind === 'github') {
    const { owner, repo, ref: gitRef, subpath } = resolved;
    // Use raw.githubusercontent.com to fetch files. If gitRef is null,
    // default to 'main' (raw.githubusercontent.com doesn't resolve "latest").
    const branch = gitRef || 'main';
    const basePath = subpath ? `${owner}/${repo}/${branch}/${subpath}` : `${owner}/${repo}/${branch}`;

    const [skillMd, manifestYaml] = await Promise.all([
      fetchRaw(`${basePath}/SKILL.md`),
      fetchRaw(`${basePath}/manifest.yaml`),
    ]);

    let manifest = null;
    try { manifest = JSON.parse(JSON.stringify(parseFrontmatter(manifestYaml))); }
    catch (e) { manifest = { _parse_error: e.message }; }

    return {
      ref,
      source: `github:https://github.com/${owner}/${repo}${gitRef ? '@' + gitRef : ''}${subpath ? ':' + subpath : ''}`,
      url: `https://github.com/${owner}/${repo}${gitRef ? '/tree/' + gitRef : ''}${subpath ? '/' + subpath : ''}`,
      skillMd,
      manifestYaml,
      manifest,
    };
  }

  if (resolved.kind === 'registry') {
    throw new Error('registry refs do not support view (no source URL known); use github: or local ref');
  }

  throw new Error(`unsupported ref: ${ref}`);
}

async function fetchRaw(path) {
  const url = `https://raw.githubusercontent.com/${path}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    return `# fetch failed: ${url}\n# status: ${res.status}\n`;
  }
  return await res.text();
}

function readIfExists(p) {
  if (!fs.existsSync(p)) return `# not found: ${p}\n`;
  return fs.readFileSync(p, 'utf8');
}

function safeLoadManifest(dir) {
  try { return loadManifest(dir); }
  catch (e) { return { _error: e.message }; }
}

// Lightweight YAML reader for the manifest only — reuses the simple
// YAML parser from manifest.js so we don't need a network of deps.
import { parseSimpleYaml } from './manifest.js';

function parseFrontmatter(text) {
  // For manifest.yaml we use parseSimpleYaml. For SKILL.md we only need
  // the raw text; the frontmatter lives in the markdown front.
  return parseSimpleYaml(text);
}
