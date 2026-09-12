// paperlab/lib/plugins/skill-sync.js
// Watch ~/.paperlab/marketplace/ and auto-push newly installed skills
// into the dsh skill catalog.

import fs from 'node:fs';
import path from 'node:path';
import { listAllSkills, search } from '../skill/indexer.js';

const HOME = process.env.PAPERLAB_HOME
  || path.join(process.env.HOME || '/Users/kral', '.paperlab');

/**
 * Returns the list of skill roots the dsh filesystem provider should serve.
 * Includes built-in + every marketplace author dir.
 */
export function buildRoots() {
  const roots = [path.join(process.cwd(), 'skills')];
  const market = path.join(HOME, 'marketplace');
  if (fs.existsSync(market)) {
    for (const author of fs.readdirSync(market)) {
      const authorDir = path.join(market, author);
      if (!fs.statSync(authorDir).isDirectory()) continue;
      // Each <author>/<name>@<version>/ subdir.
      for (const verDir of fs.readdirSync(authorDir)) {
        const full = path.join(authorDir, verDir);
        if (fs.statSync(full).isDirectory()) {
          roots.push(full);
        }
      }
    }
  }
  return roots;
}

/**
 * Start a watcher. On change, call onChange(newRoots). Caller is
 * responsible for pushing the new roots into the dsh provider.
 *
 * Returns { roots, close } — call close() when the agent disposes to
 * release the fs.watch handle (otherwise the process never exits).
 */
export function watchMarketplace(onChange) {
  const market = path.join(HOME, 'marketplace');
  if (!fs.existsSync(market)) fs.mkdirSync(market, { recursive: true });
  let debounce;
  const watcher = fs.watch(market, { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => onChange(buildRoots()), 250);
  });
  // Allow the process to exit even with an active watcher.
  if (watcher.unref) watcher.unref();
  return {
    roots: buildRoots(),
    close: () => { try { watcher.close(); } catch {} },
  };
}

/**
 * Sync helper that the dsh plugin calls during apply(). Registers a
 * paperlab-specific skill provider whose roots expand as new skills
 * are installed.
 */
export async function registerSyncProvider(ctx) {
  const initialRoots = buildRoots();
  ctx.skills.registerProvider({
    name: 'paperlab-marketplace',
    list: async () => listAllSkills().map(s => ({
      name: s.name,
      description: s.description || '',
      invocation: { modelInvocable: true, userInvocable: true },
      _path: s.path,
    })),
    load: async (candidate) => ({
      name: candidate.name,
      description: candidate.description || '',
      invocation: { modelInvocable: true, userInvocable: true },
      body: `Installed at ${candidate._path}. Use Read/Bash tools to inspect.`,
    }),
    invalidate: () => {},
  });
  watchMarketplace(() => ctx.skills.invalidateCache && ctx.skills.invalidateCache());
  return initialRoots;
}
