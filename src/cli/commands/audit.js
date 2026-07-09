import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { patternsForLang } from '../../audit/patterns.js';
import { buildInventory } from '../../audit/inventory.js';
import { collectSourceFiles, DEFAULT_IGNORE_DIRS } from '../../audit/scanner.js';
import { scanFile } from '../../audit/scanner.js';
import { resolveFinding } from '../../audit/resolve.js';

const LEVEL_ORDER = { high: 0, info: 1 };

/**
 * Wheel-reinvention audit: scan a project for hand-rolled code that installed
 * dependencies or the standard library already cover.
 * @param {Record<string, string|boolean>} opts - {json, dir, includeTests, suggest, ci}
 */
export async function run(opts) {
  const rootDir = resolvePath(String(opts.dir || process.cwd()));
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    throw { message: `not a directory: ${rootDir}`, exitCode: 2 };
  }

  const inventory = buildInventory(rootDir);

  if (!inventory.languages.length) {
    if (opts.json) {
      console.log(JSON.stringify({
        rootDir,
        findings: [],
        summary: { total: 0, high: 0, info: 0, filesScanned: 0, filesWithFindings: 0, patternsApplied: 0 },
        inventory: { languages: [], node: inventory.node.version, npmDeps: 0, pyDeps: 0, pythonRequires: inventory.pythonRequires, manifests: inventory.manifests },
        coverage: { ignoredDirs: DEFAULT_IGNORE_DIRS, testsExcluded: !opts.includeTests, truncated: false }
      }, null, 2));
    } else {
      console.log('Prior Art — wheel-reinvention audit');
      console.log(`no js/py sources detected under ${rootDir}`);
      console.log(coverageLine({ filesScanned: 0, perLang: {}, truncated: false, includeTests: !!opts.includeTests, patternsApplied: 0 }));
    }
    return;
  }

  const patterns = inventory.languages.flatMap(l => patternsForLang(l));
  const patternById = new Map(patterns.map(p => [p.id, p]));
  const { files, truncated } = collectSourceFiles(rootDir, { includeTests: !!opts.includeTests });

  const findings = [];
  const perLang = {};
  for (const file of files) {
    perLang[file.lang] = (perLang[file.lang] || 0) + 1;
    let content;
    try {
      content = readFileSync(file.path, 'utf8');
    } catch {
      continue;
    }
    const langPatterns = patternsForLang(file.lang);
    for (const match of scanFile(content, file.lang, langPatterns)) {
      const finding = resolveFinding(
        { ...match, file: file.rel },
        patternById.get(match.patternId),
        inventory,
        { suggest: !!opts.suggest }
      );
      if (finding) findings.push(finding);
    }
  }

  findings.sort((a, b) =>
    (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) ||
    a.file.localeCompare(b.file) ||
    (a.line - b.line)
  );

  const high = findings.filter(f => f.level === 'high').length;
  const info = findings.length - high;
  const filesWithFindings = new Set(findings.map(f => f.file)).size;
  const coverage = {
    filesScanned: files.length,
    perLang,
    truncated,
    includeTests: !!opts.includeTests,
    patternsApplied: patterns.length
  };

  if (opts.json) {
    console.log(JSON.stringify({
      rootDir,
      findings,
      summary: { total: findings.length, high, info, filesScanned: files.length, filesWithFindings, patternsApplied: patterns.length },
      inventory: {
        languages: inventory.languages,
        node: inventory.node.version,
        npmDeps: inventory.npmDeps.length,
        pyDeps: inventory.pyDeps.length,
        pythonRequires: inventory.pythonRequires,
        manifests: inventory.manifests
      },
      coverage: { ignoredDirs: DEFAULT_IGNORE_DIRS, testsExcluded: !opts.includeTests, truncated }
    }, null, 2));
  } else {
    console.log(renderHuman({ rootDir, inventory, findings, high, info, filesWithFindings, coverage }));
  }

  if (opts.ci && high > 0) {
    process.exitCode = 1;
  }
}

function coverageLine({ filesScanned, perLang, truncated, includeTests, patternsApplied }) {
  const langBits = Object.entries(perLang).map(([l, n]) => `${l} ${n}`).join(', ');
  return 'Coverage: scanned ' + filesScanned + ` file${filesScanned === 1 ? '' : 's'}` +
    (langBits ? ` (${langBits})` : '') +
    (truncated ? ', truncated at file cap' : '') +
    `; ${includeTests ? 'tests included' : 'tests excluded (use --include-tests)'}` +
    `; ignored dirs: ${DEFAULT_IGNORE_DIRS.slice(0, 6).join(', ')}, …` +
    `; patterns applied: ${patternsApplied}.`;
}

function renderHuman({ rootDir, inventory, findings, high, info, filesWithFindings, coverage }) {
  const lines = [];
  lines.push('Prior Art — wheel-reinvention audit');
  lines.push(`${rootDir}  ·  langs: ${inventory.languages.join(',')}  ·  Node ${inventory.node.version}  ·  npm deps: ${inventory.npmDeps.length}  ·  py deps: ${inventory.pyDeps.length}`);
  lines.push('');

  for (const f of findings) {
    lines.push(`[${f.level.toUpperCase()}] ${f.title} — ${f.file}:${f.line}`);
    lines.push(`    found:      ${f.snippet}`);
    lines.push(`    covered by: ${f.coveredBy}`);
    if (f.fpNote) lines.push(`    note:       ${f.fpNote}`);
    if (f.blockLines > 2) lines.push(`    (~${f.blockLines} lines could go)`);
    lines.push('');
  }

  if (findings.length) {
    const s = n => (n === 1 ? '' : 's');
    lines.push(`${findings.length} finding${s(findings.length)} (${high} high, ${info} info) across ${filesWithFindings} file${s(filesWithFindings)}.`);
  } else {
    lines.push('No reinvented wheels found by the current patterns — either genuinely clean, or the wheel is one we do not have a pattern for yet.');
  }
  lines.push(coverageLine(coverage));
  if (findings.length) {
    lines.push('Verify and fix inside Claude Code (prior-art plugin) — confirmed fixes are worth recording: pa stats record wheel-fixed 1 "<what>"');
  }
  return lines.join('\n');
}
