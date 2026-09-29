#!/usr/bin/env node
// PaperLab A-line: manuscript compile loop.
// Compiles <paper-dir>/manuscript/main.tex (or --tex override) in an isolated
// build dir, copies the PDF back, and writes a structured build report to
// <paper-dir>/evidence/build-report.json. Pure Node stdlib; no npm deps.
//
// Usage:
//   node paperlab-compile.mjs --paper-dir <dir> [--engine auto|tectonic|pdflatex]
//                             [--tex <path>] [--keep-cache]
//
// Engine detection (auto): tectonic preferred (single command, handles the
// bibtex loop internally); otherwise pdflatex + bibtex + pdflatex x2.
// If neither exists, prints install instructions and exits 2.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { engine: 'auto', keepCache: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--paper-dir') args.paperDir = argv[++i];
    else if (a === '--tex') args.tex = argv[++i];
    else if (a === '--engine') args.engine = argv[++i];
    else if (a === '--keep-cache') args.keepCache = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else { console.error(`unknown argument: ${a}`); process.exit(1); }
  }
  return args;
}

function usage() {
  console.log(`paperlab-compile — compile a PaperLab manuscript to PDF.

Usage:
  node paperlab-compile.mjs --paper-dir <dir> [--engine auto|tectonic|pdflatex] [--tex <path>] [--keep-cache]

Options:
  --paper-dir <dir>   paper root (contains manuscript/, figures/, evidence/)
  --tex <path>        override the tex entry (default: <dir>/manuscript/main.tex)
  --engine <name>     auto | tectonic | pdflatex  (default: auto)
  --keep-cache        do not wipe the build dir after a successful compile

Behavior:
  - Builds in <dir>/.paperlab/build/<stamp>/ (temp), never pollutes manuscript/
  - Copies main.tex + figures/ + *.bib into the build dir before compiling
  - PDF lands at <dir>/manuscript/main.pdf
  - Structured log -> <dir>/evidence/build-report.json
  - Idempotent: if the tex sha256 matches the last build, skips and returns the cached report`);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function which(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, bin);
    try { if (fs.statSync(p).isFile() && (fs.statSync(p).mode & 0o111)) return p; } catch { /* next */ }
  }
  return null;
}

/** Recursively copy src -> dst (files only, keeps relative structure). */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

// ---------------------------------------------------------------------------
// log parsing -> structured findings
// ---------------------------------------------------------------------------

/** Extract {severity, line, message}[] from a LaTeX engine log. */
function parseLog(logText) {
  const findings = [];
  const lines = logText.split(/\r?\n/);
  const rxLineNo = /^(?:l\.|on input line )(\d+)/;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    // tectonic console format: "error: main.tex:36: Undefined control sequence"
    //                          "warning: main.tex:34: Overfull \\hbox ..."
    const mTec = t.match(/^(error|warning|note):\s+(\S+?):(\d+):\s*(.*)$/);
    if (mTec) {
      const sev = mTec[1] === 'error' ? 'error' : mTec[1] === 'warning' ? 'warning' : 'info';
      findings.push({ severity: sev, line: Number(mTec[3]), message: mTec[4] });
      continue;
    }
    // "! " error lines: "! LaTeX Error: ..." / "! Undefined control sequence."
    if (t.startsWith('!')) {
      const msg = t.replace(/^!\s*/, '').trim();
      // try to find a line number nearby ("l.123 ...")
      let line = null;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const m = lines[j].match(rxLineNo);
        if (m) { line = Number(m[1]); break; }
      }
      findings.push({ severity: 'error', line, message: msg });
      continue;
    }
    // Overfull/Underfull boxes ("Overfull \\hbox (12.3pt too wide) in paragraph at lines 45--50")
    const mBox = t.match(/^(Overfull|Underfull) \\[hv]box \(([^)]*)\)(?: in (?:paragraph|alignment) )?(?:at lines? (\d+))?/);
    if (mBox) {
      findings.push({
        severity: mBox[1] === 'Overfull' ? 'warning' : 'info',
        line: mBox[3] ? Number(mBox[3]) : null,
        message: `${mBox[1]} \\${mBox[2] ? '' : ''}box (${mBox[2] || 'badness'}) ${t.slice(mBox[0].length).trim()}`.trim(),
      });
      continue;
    }
    // Package / generic warnings: "LaTeX Warning: ..." / "Package natbib Warning: ..."
    if (/^(LaTeX|Package|Class|pdfTeX)\s+Warning:/i.test(t)) {
      let line = null;
      const m = t.match(/on input line (\d+)/) || t.match(/line (\d+)/);
      if (m) line = Number(m[1]);
      findings.push({ severity: 'warning', line, message: t.replace(/^(LaTeX|Package|Class|pdfTeX)\s+Warning:\s*/i, '$1: ') });
      continue;
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// engines
// ---------------------------------------------------------------------------

function detectEngine(prefer) {
  if (prefer === 'tectonic' || prefer === 'pdflatex') {
    const bin = which(prefer);
    if (!bin) {
      console.error(`error: engine "${prefer}" requested but not found on PATH.`);
      process.exit(2);
    }
    return { name: prefer, bin };
  }
  const tec = which('tectonic');
  if (tec) return { name: 'tectonic', bin: tec };
  const pdf = which('pdflatex');
  if (pdf) return { name: 'pdflatex', bin: pdf };
  console.error(
    'error: no LaTeX engine found (tried tectonic, pdflatex).\n' +
    'install one of:\n' +
    '  brew install tectonic          # ~20MB single binary, recommended\n' +
    '  brew install --cask basictex   # or a full texlive\n'
  );
  process.exit(2);
}

function bufToStr(b) {
  if (!b) return '';
  return Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
}

/** Run tectonic. Returns { pdfPath } or throws with the captured log. */
function runTectonic(engine, buildDir, texName) {
  try {
    execFileSync(engine.bin, [texName], { cwd: buildDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60 * 1000 });
    const pdf = path.join(buildDir, texName.replace(/\.tex$/, '.pdf'));
    if (!fs.existsSync(pdf)) throw new Error('tectonic did not produce a PDF');
    return { pdfPath: pdf, log: collectTectonicLog(buildDir) };
  } catch (err) {
    const log = bufToStr(err.stdout) + bufToStr(err.stderr);
    const err2 = new Error(`tectonic failed: ${err.message}`);
    err2.log = log || collectTectonicLog(buildDir);
    throw err2;
  }
}

/** Tectonic keeps its own log in <name>.log next to the tex unless -k passed. */
function collectTectonicLog(buildDir) {
  const candidates = fs.readdirSync(buildDir).filter(f => f.endsWith('.log')).map(f => path.join(buildDir, f));
  let text = '';
  for (const c of candidates) { try { text += fs.readFileSync(c, 'utf8') + '\n'; } catch { /* ignore */ } }
  return text;
}

/** Classic loop: pdflatex -> bibtex -> pdflatex -> pdflatex. */
function runPdflatex(engine, buildDir, texName) {
  const run = (args) => execFileSync(engine.bin, args, { cwd: buildDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60 * 1000 });
  const base = texName.replace(/\.tex$/, '');
  let out = '';
  try {
    out += run(['-interaction=nonstopmode', '-halt-on-error', texName]);
    if (fs.existsSync(path.join(buildDir, `${base}.aux`)) && fs.existsSync(path.join(buildDir, 'references.bib'))) {
      try { out += run(['bibtex', base]); } catch { /* bibtex warnings are non-fatal */ }
      out += run(['-interaction=nonstopmode', '-halt-on-error', texName]);
    }
    out += run(['-interaction=nonstopmode', '-halt-on-error', texName]);
    const pdf = path.join(buildDir, `${base}.pdf`);
    if (!fs.existsSync(pdf)) throw new Error('pdflatex did not produce a PDF');
    return { pdfPath: pdf, log: out };
  } catch (err) {
    const log = bufToStr(err.stdout) + bufToStr(err.stderr);
    const e2 = new Error(`pdflatex failed: ${err.message}`);
    e2.log = log;
    throw e2;
  }
}

function pdfPageCount(pdfPath) {
  const pdfinfoBin = which('pdfinfo');
  if (!pdfinfoBin) return null;
  try {
    const out = execFileSync(pdfinfoBin, [pdfPath], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 1000 }).toString();
    const m = out.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.paperDir) { usage(); process.exit(args.paperDir ? 0 : 1); }

  const paperDir = path.resolve(args.paperDir);
  if (!fs.existsSync(paperDir)) { console.error(`error: paper dir not found: ${paperDir}`); process.exit(1); }

  const texPath = args.tex ? path.resolve(args.tex) : path.join(paperDir, 'manuscript', 'main.tex');
  if (!fs.existsSync(texPath)) { console.error(`error: tex not found: ${texPath} (use --tex to override)`); process.exit(1); }

  const manuscriptDir = path.dirname(texPath);
  const evidenceDir = path.join(paperDir, 'evidence');
  const reportPath = path.join(evidenceDir, 'build-report.json');
  const buildRoot = path.join(paperDir, '.paperlab', 'build');

  // ---- idempotence: same tex hash -> return cached report
  const texHash = sha256(texPath);
  if (fs.existsSync(reportPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (prev.tex_sha256 === texHash && prev.ok === true && fs.existsSync(prev.pdf_path)) {
        console.log(JSON.stringify({ ...prev, skipped: true }, null, 2));
        return;
      }
    } catch { /* corrupt report -> rebuild */ }
  }

  const engine = detectEngine(args.engine);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const buildDir = path.join(buildRoot, stamp);
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  // ---- stage inputs: tex + sibling .bib + figures/
  fs.copyFileSync(texPath, path.join(buildDir, path.basename(texPath)));
  const texName = path.basename(texPath);
  const bibs = fs.existsSync(manuscriptDir) ? fs.readdirSync(manuscriptDir).filter(f => f.endsWith('.bib')) : [];
  for (const b of bibs) fs.copyFileSync(path.join(manuscriptDir, b), path.join(buildDir, b));
  const figDirs = [
    path.join(paperDir, 'figures'),
    path.join(manuscriptDir, 'figures'),
  ];
  let figDirCopied = false;
  for (const fd of figDirs) {
    if (fs.existsSync(fd)) { copyTree(fd, path.join(buildDir, 'figures')); figDirCopied = true; break; }
  }

  const started = Date.now();
  let result;
  try {
    result = engine.name === 'tectonic' ? runTectonic(engine, buildDir, texName) : runPdflatex(engine, buildDir, texName);
  } catch (err) {
    const findings = parseLog(typeof err.log === 'string' ? err.log : '');
    const report = {
      ok: false, engine: engine.name, tex: texPath, tex_sha256: texHash,
      pdf_path: null, pages: null, duration_ms: Date.now() - started,
      warnings: findings.filter(f => f.severity === 'warning'),
      errors: findings.filter(f => f.severity === 'error'),
      infos: findings.filter(f => f.severity === 'info'),
      error_message: err.message, built_at: new Date().toISOString(),
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.error(`COMPILE FAILED: ${err.message}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(3);
  }

  // ---- collect log text for finding extraction
  let logText = result.log || '';
  if (engine.name === 'tectonic') logText += '\n' + collectTectonicLog(buildDir);
  const findings = parseLog(logText);

  // ---- copy PDF back to manuscript/
  const outPdf = path.join(manuscriptDir, path.basename(texPath).replace(/\.tex$/, '.pdf'));
  fs.copyFileSync(result.pdfPath, outPdf);

  const report = {
    ok: true, engine: engine.name, tex: texPath, tex_sha256: texHash,
    pdf_path: outPdf, pages: pdfPageCount(outPdf),
    figures_dir_copied: figDirCopied,
    duration_ms: Date.now() - started,
    warnings: findings.filter(f => f.severity === 'warning'),
    errors: findings.filter(f => f.severity === 'error'),
    infos: findings.filter(f => f.severity === 'info'),
    built_at: new Date().toISOString(),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // ---- clean the build dir unless asked to keep
  if (!args.keepCache) fs.rmSync(buildRoot, { recursive: true, force: true });

  console.log(JSON.stringify(report, null, 2));
}

main();
