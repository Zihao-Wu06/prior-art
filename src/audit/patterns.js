// prior-art: ignore-file — this catalog quotes wheel signatures by design.
//
// Detection-pattern catalog for `pa audit` — the wheel-reinvention detector.
//
// This file is the quality core of the audit. Every API and version cited in a
// `coveredBy` entry is a claim the report repeats to the user, so it must be
// correct: a wrong "since" version or a non-existent method turns a helpful
// finding into misinformation. When unsure, this catalog stays silent rather
// than guessing — a missed wheel costs nothing, a false one costs trust.
//
// FALSE POSITIVES ARE THE DESIGN BAR. These patterns are heuristics that flag
// CANDIDATES; the model (via the prior-art-audit skill) does the semantic
// verification the engine cannot. The catalog's job is to keep the candidate
// stream high-signal so that verification stays cheap.
//
// ── Firing contract (the scanner is built against this) ──────────────────────
// A pattern object describes how a candidate is raised. Two firing paths exist,
// gated by `nameOnly`:
//
//   • nameOnly: true  — a HIGH-CONFIDENCE pattern. It fires when `namePattern`
//                       matches an extracted function name (source: 'name'), OR
//                       when one of its `bodyHints` matches a line (source:
//                       'body'). Because both fire ALONE, such a pattern carries
//                       only bodyHints that are unambiguous on their own — or
//                       none at all.
//
//   • nameOnly: false — a NAME-GATED pattern (the function name is generic, e.g.
//                       `merge`, `retry`, `clamp`). It fires only when
//                       `namePattern` matches a function name AND one of its
//                       `bodyHints` matches within that function's body/window
//                       (source: 'name+body'). Its bodyHints NEVER fire alone,
//                       so they may be distinctive-but-not-unique corroborators.
//
// `namePattern: null` is reserved for body-only patterns; none ship in v0.2,
// because every distinctive body signature we trust (e.g. JSON.parse(JSON.
// stringify(...)) also has a natural name, and we prefer the name+body pair.
//
// `namePattern`/`bodyHints` are standard escaped regex literals, which by
// construction do not match their own source text (`/JSON\.parse/` does not
// match the literal `JSON\.parse`). Keep it that way: never add a hint that
// would match an arbitrary regex-literal line.
//
// Patterns are ordered by `category`, JS entries before Python within each.
// `id`s are a stable public contract — they become report and ledger
// vocabulary — so never rename one casually; add or deprecate instead.

/**
 * @typedef {Object} BuiltinCoverage
 * @property {string} name  - The module or global that covers the wheel.
 * @property {string} api   - The exact call form to reach for.
 * @property {{node?: number|string, python?: string}} [since] - Minimum runtime
 *   version. Omitted when the API is universal in all supported runtimes.
 * @property {string} [note] - Behavioral caveat the verifier must weigh.
 */

/**
 * @typedef {Object} DepCoverage
 * @property {string} name - npm name (js) or PyPI name (py).
 * @property {string} api  - The exact call form, as imported from that package.
 */

/**
 * @typedef {Object} Pattern
 * @property {string} id                 - Unique kebab-case identifier (stable).
 * @property {string} title              - Short human title.
 * @property {('js'|'py')[]} langs       - 'js' covers the js/ts family; 'py' Python.
 * @property {string} category           - Coarse grouping (drives report order).
 * @property {RegExp|null} namePattern   - Tested against extracted function names; null if body-only.
 * @property {boolean} nameOnly          - See the firing contract above.
 * @property {RegExp[]} bodyHints        - Line-level regexes; corroborate or (nameOnly) fire alone.
 * @property {{builtin?: BuiltinCoverage, deps?: DepCoverage[]}} coveredBy - Non-empty.
 * @property {string} [fpNote]           - How a verifier could be misled; present whenever that is realistic.
 */

/** @type {Pattern[]} */
export const PATTERNS = [
  // ── objects ────────────────────────────────────────────────────────────────
  {
    id: 'deep-clone',
    title: 'Hand-rolled deep clone',
    langs: ['js'],
    category: 'objects',
    namePattern: /^(deep[_-]?clone|clone[_-]?deep|deep[_-]?copy|copy[_-]?deep)$/i,
    nameOnly: true,
    bodyHints: [/JSON\.parse\(\s*JSON\.stringify\s*\(/],
    coveredBy: {
      builtin: {
        name: 'structuredClone',
        api: 'structuredClone(value)',
        since: { node: 17 },
        note: 'does not clone functions, class prototypes/methods, or DOM nodes; throws on non-serializable values'
      },
      deps: [
        { name: 'lodash', api: '_.cloneDeep(value)' },
        { name: 'lodash-es', api: 'cloneDeep(value)' },
        { name: 'rfdc', api: 'clone(value)' }
      ]
    },
    fpNote: 'a JSON round-trip clone is a lossy WHEEL (drops undefined, turns Date into a string, loses Map/Set) — that is a bug to fix, not a blocker; but a custom clone that intentionally skips keys, preserves class instances, or handles cycles is NOT equivalent to structuredClone'
  },
  {
    id: 'py-deep-copy',
    title: 'Hand-rolled deep copy',
    langs: ['py'],
    category: 'objects',
    namePattern: /^(deep[_-]?copy|deepcopy|deep[_-]?clone|clone)$/i,
    nameOnly: true,
    bodyHints: [/json\.loads\(\s*json\.dumps\s*\(/],
    coveredBy: {
      builtin: {
        name: 'copy',
        api: 'copy.deepcopy(x)',
        note: 'handles cycles and honors __deepcopy__; a json.loads(json.dumps(...)) round-trip does not, and coerces tuples/sets to lists'
      }
    },
    fpNote: 'copy.deepcopy is the general replacement; a hand-rolled copy that deliberately shares some references (a shallow/hybrid copy) is a different contract'
  },
  {
    id: 'deep-equal',
    title: 'Hand-rolled deep equality',
    langs: ['js'],
    category: 'objects',
    namePattern: /^(deep[_-]?equals?|deep[_-]?compare|deep[_-]?eq)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'node:util',
        api: 'util.isDeepStrictEqual(a, b)',
        note: 'strict (no type coercion), does not treat NaN as unequal to itself, compares own enumerable properties'
      },
      deps: [
        { name: 'lodash', api: '_.isEqual(a, b)' },
        { name: 'fast-deep-equal', api: 'equal(a, b)' }
      ]
    },
    fpNote: 'lodash _.isEqual and util.isDeepStrictEqual differ on edge cases (isEqual compares by value more loosely, e.g. equal Buffers/typed arrays); pick the one matching the call-site semantics'
  },
  {
    id: 'deep-merge',
    title: 'Hand-rolled deep/recursive merge',
    langs: ['js'],
    category: 'objects',
    namePattern: /^(deep[_-]?merge|merge[_-]?deep|deep[_-]?assign|recursive[_-]?merge|merge[_-]?objects?)$/i,
    nameOnly: false,
    bodyHints: [
      /typeof\s+\w+\s*===\s*['"]object['"]/,
      /\bisObject\s*\(/,
      /for\s*\(\s*const\s+\w+\s+in\s+/
    ],
    coveredBy: {
      // No builtin: Object.assign / spread are SHALLOW — recommending them for
      // a deep merge would be exactly the misinformation this catalog forbids.
      deps: [
        { name: 'deepmerge', api: 'deepmerge(a, b)' },
        { name: 'lodash', api: '_.merge(object, ...sources)' }
      ]
    },
    fpNote: 'lodash _.merge MUTATES its target and merges arrays by index; deepmerge returns a new object and concatenates arrays by default — confirm which array/mutation semantics the site needs before swapping'
  },
  {
    id: 'pick',
    title: 'Hand-rolled object pick',
    langs: ['js'],
    category: 'objects',
    namePattern: /^(pick|pick[_-]?keys|pick[_-]?by|pick[_-]?props|select[_-]?keys)$/i,
    nameOnly: false,
    bodyHints: [
      /\b\w*[Kk]eys\.(?:forEach|reduce|filter|map)\(/,
      /for\s*\(\s*const\s+\w+\s+of\s+\w*[Kk]eys\b/,
      /\[\s*\w+\s*\]\s*=\s*\w+\[\s*\w+\s*\]/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.pick(object, [paths])' },
        { name: 'lodash-es', api: 'pick(object, [paths])' }
      ]
    },
    fpNote: 'lodash _.pick supports deep paths ("a.b") and treats missing keys specially; a shallow hand-rolled pick over own keys is only equivalent for the flat-key case'
  },
  {
    id: 'omit',
    title: 'Hand-rolled object omit',
    langs: ['js'],
    category: 'objects',
    namePattern: /^(omit|omit[_-]?keys|except|without[_-]?keys|exclude[_-]?keys)$/i,
    nameOnly: false,
    bodyHints: [
      /\bdelete\s+\w+\[/,
      /\b\w*[Kk]eys\.(?:includes|indexOf)\(/,
      /\.filter\(\s*(?:\w+|\([^)]*\))\s*=>\s*![^)]*\.includes\(/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.omit(object, [paths])' },
        { name: 'lodash-es', api: 'omit(object, [paths])' }
      ]
    },
    fpNote: 'same deep-path caveat as pick; also a delete-based omit mutates unless it clones first — check whether the site expected a copy'
  },
  {
    id: 'group-by',
    title: 'Hand-rolled group-by',
    langs: ['js'],
    category: 'objects',
    namePattern: /^(group[_-]?by|group[_-]?into|bucket[_-]?by)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'Object.groupBy',
        api: 'Object.groupBy(items, item => key)',
        since: { node: 21 },
        note: 'returns a null-prototype object; use Map.groupBy for non-string keys'
      },
      deps: [
        { name: 'lodash', api: '_.groupBy(collection, iteratee)' }
      ]
    },
    fpNote: 'Object.groupBy keys are coerced to strings; if the wheel groups by an object or number key without stringifying, prefer Map.groupBy'
  },
  {
    id: 'py-group-by',
    title: 'Hand-rolled group-by',
    langs: ['py'],
    category: 'objects',
    namePattern: /^(group[_-]?by|groupby|group[_-]?into|bucket[_-]?by)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'collections',
        api: 'd = collections.defaultdict(list); d[key].append(item)',
        note: 'itertools.groupby groups only CONSECUTIVE equal keys, so it needs the input pre-sorted by key; defaultdict groups arbitrary order'
      },
      deps: [
        { name: 'more-itertools', api: 'bucket(iterable, key)' }
      ]
    },
    fpNote: 'do not suggest itertools.groupby unless the input is already sorted by the grouping key — it is the single most common misuse'
  },
  {
    id: 'is-plain-object',
    title: 'Hand-rolled plain-object check',
    langs: ['js'],
    category: 'objects',
    namePattern: /^(is[_-]?plain[_-]?object|is[_-]?plain[_-]?obj|is[_-]?object[_-]?literal|is[_-]?record)$/i,
    nameOnly: false,
    bodyHints: [
      /Object\.prototype\.toString\.call\(/,
      /Object\.getPrototypeOf\(\s*\w+\s*\)\s*===\s*Object\.prototype/,
      /\.constructor\s*===\s*Object\b/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.isPlainObject(value)' },
        { name: 'is-plain-object', api: 'isPlainObject(value)' }
      ]
    },
    fpNote: 'definitions of "plain object" genuinely differ — cross-realm objects, null-prototype objects, and objects with a custom Symbol.toStringTag are handled differently by each implementation; verify the wheel and the library agree for the values this site sees'
  },

  // ── strings ─────────────────────────────────────────────────────────────────
  {
    id: 'slugify',
    title: 'Hand-rolled slugify',
    langs: ['js'],
    category: 'strings',
    namePattern: /^(slugify|to[_-]?slug|make[_-]?slug|sluggify|url[_-]?slug|slugize)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      deps: [
        { name: 'slugify', api: 'slugify(str, options)' },
        { name: '@sindresorhus/slugify', api: 'slugify(str)' }
      ]
    },
    fpNote: 'slug libraries differ on unicode transliteration, separator, and case; a custom slug that intentionally preserves case, dots, or non-latin script is a deliberate variant, not a defect'
  },
  {
    id: 'py-slugify',
    title: 'Hand-rolled slugify',
    langs: ['py'],
    category: 'strings',
    namePattern: /^(slugify|to[_-]?slug|make[_-]?slug|url[_-]?slug)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      deps: [
        { name: 'python-slugify', api: 'from slugify import slugify; slugify(text)' }
      ]
    },
    fpNote: 'transliteration and unicode handling differ between slug libraries; confirm the required separator and casing before replacing'
  },
  {
    id: 'kebab-case',
    title: 'Hand-rolled case converter (kebab/param case)',
    langs: ['js'],
    category: 'strings',
    namePattern: /^(kebab[_-]?case|to[_-]?kebab|dasherize|param[_-]?case|kebabify|to[_-]?dash[_-]?case)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.kebabCase(str)' },
        { name: 'param-case', api: 'paramCase(str)' }
      ]
    },
    fpNote: 'lodash _.kebabCase splits camelCase boundaries and strips punctuation; a naive .replace(/ /g, "-").toLowerCase() differs on both — do not claim equivalence without checking inputs with camelCase or symbols'
  },
  {
    id: 'capitalize',
    title: 'Hand-rolled capitalize / upper-first',
    langs: ['js'],
    category: 'strings',
    namePattern: /^(capitalize|capitalise|ucfirst|upper[_-]?first|uc[_-]?first)$/i,
    nameOnly: false,
    bodyHints: [
      /\.charAt\(\s*0\s*\)\.toUpperCase\(\)/,
      /\[\s*0\s*\]\.toUpperCase\(\)\s*\+/,
      /\.slice\(\s*1\s*\)/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.upperFirst(str)' }
      ]
    },
    fpNote: 'the equivalent is lodash _.upperFirst, NOT _.capitalize — _.capitalize lower-cases the rest of the string, whereas `str[0].toUpperCase() + str.slice(1)` preserves it; suggesting _.capitalize would silently change behavior'
  },
  {
    id: 'escape-html',
    title: 'Hand-rolled HTML escape',
    langs: ['js'],
    category: 'strings',
    namePattern: /^(escape[_-]?html|html[_-]?escape|escape[_-]?markup|sanitize[_-]?html|encode[_-]?html)$/i,
    nameOnly: true,
    bodyHints: [/replace\(\s*\/&\/g\s*,\s*['"]&amp;['"]\s*\)/],
    coveredBy: {
      deps: [
        { name: 'escape-html', api: 'escapeHtml(str)' },
        { name: 'lodash', api: '_.escape(str)' }
      ]
    },
    fpNote: 'escaping is context-sensitive: escape-html and _.escape target HTML text/attribute context (& < > " \'); they are NOT sanitizers and do not make untrusted HTML safe to inject — if the wheel is doing sanitization, the answer is DOMPurify, not this'
  },
  {
    id: 'py-escape-html',
    title: 'Hand-rolled HTML escape',
    langs: ['py'],
    category: 'strings',
    namePattern: /^(escape[_-]?html|html[_-]?escape|escape[_-]?markup|htmlescape|encode[_-]?html)$/i,
    nameOnly: true,
    bodyHints: [/\.replace\(\s*['"]&['"]\s*,\s*['"]&amp;['"]\s*\)/],
    coveredBy: {
      builtin: {
        name: 'html',
        api: 'html.escape(s, quote=True)',
        note: 'escapes & < > and (with quote=True) " and \'; not a sanitizer'
      },
      deps: [
        { name: 'markupsafe', api: 'markupsafe.escape(s)' }
      ]
    },
    fpNote: 'html.escape covers text/attribute escaping; if the wheel is trying to sanitize untrusted markup, that is a different (and harder) problem — bleach/nh3, not html.escape'
  },
  {
    id: 'left-pad',
    title: 'Hand-rolled string padding',
    langs: ['js'],
    category: 'strings',
    namePattern: /^(left[_-]?pad|pad[_-]?left|right[_-]?pad|pad[_-]?right|lpad|rpad|zero[_-]?pad|pad[_-]?start)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'String.prototype.padStart / padEnd',
        api: 'str.padStart(length, padChar) / str.padEnd(length, padChar)',
        note: 'universal; pads only when the string is shorter than length'
      }
    },
    fpNote: 'padStart/padEnd take the target TOTAL length, not a count of characters to add — if the wheel added N copies regardless of current length, the semantics differ'
  },

  // ── arrays ──────────────────────────────────────────────────────────────────
  {
    id: 'chunk',
    title: 'Hand-rolled array chunk',
    langs: ['js'],
    category: 'arrays',
    namePattern: /^(chunk|chunk[_-]?array|split[_-]?into[_-]?chunks|chunkify|to[_-]?chunks|partition[_-]?array)$/i,
    nameOnly: false,
    bodyHints: [
      /\.slice\(\s*\w+\s*,\s*\w+\s*\+\s*\w+\s*\)/,
      /for\s*\([^)]*\+=\s*(?:size|chunkSize|n|len|count|step)\b/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.chunk(array, size)' }
      ]
    },
    fpNote: 'lodash _.chunk makes the final chunk short (never pads); if the wheel pads or drops a partial final chunk, that behavior is not preserved'
  },
  {
    id: 'py-chunk',
    title: 'Hand-rolled batching / chunk',
    langs: ['py'],
    category: 'arrays',
    namePattern: /^(chunk|chunked|chunks|batch|batched|grouper|split[_-]?into[_-]?chunks)$/i,
    nameOnly: false,
    bodyHints: [
      /range\(\s*0\s*,\s*len\([^)]*\)\s*,\s*\w+\s*\)/,
      /\[\s*i\s*:\s*i\s*\+\s*\w+\s*\]/
    ],
    coveredBy: {
      builtin: {
        name: 'itertools',
        api: 'itertools.batched(iterable, n)',
        since: { python: '3.12' },
        note: 'yields tuples and works on any iterable; the last batch is short'
      },
      deps: [
        { name: 'more-itertools', api: 'chunked(iterable, n)' }
      ]
    },
    fpNote: 'itertools.batched needs Python 3.12+ and yields TUPLES; more-itertools.chunked yields LISTS — match the element type and the interpreter version the project targets'
  },
  {
    id: 'unique',
    title: 'Hand-rolled array de-duplication',
    langs: ['js'],
    category: 'arrays',
    namePattern: /^(unique|uniq|dedupe|dedup|distinct|de[_-]?duplicate|remove[_-]?duplicates)$/i,
    nameOnly: false,
    bodyHints: [
      /\.indexOf\(\s*\w+\s*\)\s*===?\s*(?:index|i)\b/,
      /indexOf\([^)]*\)\s*===?\s*(?:index|i)\b/,
      /if\s*\(\s*!\s*\w+\.includes\(\s*\w+\s*\)\s*\)/
    ],
    coveredBy: {
      builtin: {
        name: 'Set',
        api: '[...new Set(array)]',
        note: 'de-dupes by SameValueZero — objects compare by reference, NaN is treated as equal to itself'
      },
      deps: [
        { name: 'lodash', api: '_.uniqBy(array, iteratee) for keyed de-dup' }
      ]
    },
    fpNote: '`[...new Set(x)]` is the fix for primitive de-dup; it is NOT equivalent when the wheel de-dupes objects by a key or by deep value — that needs _.uniqBy or a Map keyed on the identity function'
  },
  {
    id: 'py-dedupe',
    title: 'Hand-rolled de-duplication',
    langs: ['py'],
    category: 'arrays',
    namePattern: /^(dedupe|dedup|unique|uniq|distinct|de[_-]?dup|remove[_-]?duplicates)$/i,
    nameOnly: false,
    bodyHints: [
      /seen\s*=\s*set\(\)/,
      /if\s+\w+\s+not\s+in\s+seen\b/
    ],
    coveredBy: {
      builtin: {
        name: 'dict.fromkeys',
        api: 'list(dict.fromkeys(seq))',
        note: 'preserves first-seen order (unlike set()); items must be hashable'
      },
      deps: [
        { name: 'more-itertools', api: 'unique_everseen(iterable, key=None)' }
      ]
    },
    fpNote: 'dict.fromkeys and set both require hashable items; de-dup by a key function, or over unhashable items, is not covered — use more_itertools.unique_everseen with a key'
  },
  {
    id: 'flatten',
    title: 'Hand-rolled array flatten',
    langs: ['js'],
    category: 'arrays',
    namePattern: /^(flatten|flatten[_-]?deep|flat[_-]?deep|deep[_-]?flatten|flatten[_-]?array)$/i,
    nameOnly: false,
    bodyHints: [
      /Array\.isArray\([^)]*\)\s*\?[^:]*\.concat\(/,
      /\.reduce\([^)]*\.concat\(/,
      /\bflat\w*\s*\(\s*\w+\s*\)/
    ],
    coveredBy: {
      builtin: {
        name: 'Array.prototype.flat',
        api: 'array.flat(Infinity) for deep, array.flat() for one level',
        note: 'universal in supported Node versions'
      },
      deps: [
        { name: 'lodash', api: '_.flattenDeep(array)' }
      ]
    },
    fpNote: 'match the depth: .flat() only flattens ONE level; the wheel is usually recursive (arbitrary depth), so .flat(Infinity) is the equivalent, not a bare .flat()'
  },
  {
    id: 'py-flatten',
    title: 'Hand-rolled list flatten',
    langs: ['py'],
    category: 'arrays',
    namePattern: /^(flatten|flat|flatten[_-]?list|concat[_-]?lists|flatten[_-]?nested)$/i,
    nameOnly: false,
    bodyHints: [
      /\[[^\]]*for\s+\w+\s+in\s+\w+\s+for\s+\w+\s+in\s+\w+\s*\]/,
      /for\s+\w+\s+in\s+\w+:\s*[\s\S]{0,40}\.extend\(/
    ],
    coveredBy: {
      builtin: {
        name: 'itertools',
        api: 'list(itertools.chain.from_iterable(lists))',
        note: 'flattens exactly one level'
      },
      deps: [
        { name: 'more-itertools', api: 'collapse(nested) for arbitrary depth' }
      ]
    },
    fpNote: 'chain.from_iterable flattens one level only; deep or irregular nesting needs more_itertools.collapse (which also descends into strings unless told otherwise)'
  },
  {
    id: 'zip',
    title: 'Hand-rolled array zip',
    langs: ['js'],
    category: 'arrays',
    namePattern: /^(zip|zip[_-]?arrays|zip[_-]?with|pairwise|interleave)$/i,
    nameOnly: false,
    bodyHints: [
      /\.map\(\s*\(\s*\w+\s*,\s*(?:i|index|idx)\s*\)\s*=>\s*\[/,
      /\[\s*\w+\s*,\s*\w+\[\s*(?:i|index|idx)\s*\]\s*\]/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.zip(...arrays)' }
      ]
    },
    fpNote: 'only a positional-pairing wheel matches — "zip" also names file compression, so verify the code actually pairs elements by index; lodash _.zip pads the short array with undefined, a map-based wheel truncates to the first array'
  },

  // ── functions ───────────────────────────────────────────────────────────────
  {
    id: 'debounce',
    title: 'Hand-rolled debounce',
    langs: ['js'],
    category: 'functions',
    namePattern: /^(debounce|debounced|debounce[_-]?fn)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.debounce(fn, wait, { leading, trailing, maxWait })' }
      ]
    },
    fpNote: 'a naive debounce is trailing-only; lodash adds leading/trailing/maxWait and a .cancel()/.flush() — if the site relies on leading-edge or cancellation, the wheel and the library are not interchangeable in either direction'
  },
  {
    id: 'throttle',
    title: 'Hand-rolled throttle',
    langs: ['js'],
    category: 'functions',
    namePattern: /^(throttle|throttled|throttle[_-]?fn)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.throttle(fn, wait, { leading, trailing })' }
      ]
    },
    fpNote: 'throttle and debounce are frequently confused; confirm the wheel actually rate-limits (fires at most once per interval) rather than debouncing (fires after quiet) before swapping'
  },
  {
    id: 'memoize',
    title: 'Hand-rolled memoize',
    langs: ['js'],
    category: 'functions',
    namePattern: /^(memoize|memo|memoized|memoize[_-]?fn|cache[_-]?fn)$/i,
    nameOnly: false,
    bodyHints: [
      /\bcache\.(?:has|get|set)\(/,
      /const\s+key\s*=\s*JSON\.stringify\(/,
      /\bcache\[\s*\w+\s*\]\s*=/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.memoize(fn, resolver)' }
      ]
    },
    fpNote: 'lodash _.memoize keys on the FIRST argument only unless you pass a resolver, and never evicts; a wheel that keys on all args (JSON.stringify) or bounds the cache is doing more — do not down-grade it silently'
  },
  {
    id: 'py-memoize',
    title: 'Hand-rolled memoize',
    langs: ['py'],
    category: 'functions',
    namePattern: /^(memoize|memo|cached|cache[_-]?result|lru)$/i,
    nameOnly: false,
    bodyHints: [
      /_?cache\s*=\s*\{\}/,
      /if\s+\w+\s+in\s+_?cache\b/,
      /_?cache\[\s*\w+\s*\]\s*=/
    ],
    coveredBy: {
      builtin: {
        name: 'functools',
        api: '@functools.lru_cache(maxsize=None)',
        note: '@functools.cache (Python 3.9+) is the shorthand for an unbounded cache; args must be hashable'
      }
    },
    fpNote: 'lru_cache caches on the function for the process lifetime and needs hashable args; a wheel with per-instance caching, TTLs, or custom keys is not equivalent'
  },
  {
    id: 'once',
    title: 'Hand-rolled run-once wrapper',
    langs: ['js'],
    category: 'functions',
    namePattern: /^(once|call[_-]?once|do[_-]?once|run[_-]?once)$/i,
    nameOnly: false,
    bodyHints: [
      /let\s+called\b/,
      /\bcalled\s*=\s*true\b/,
      /if\s*\(\s*called\s*\)\s*return\b/,
      /\bhasRun\b/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.once(fn)' }
      ]
    },
    fpNote: 'lodash _.once caches and returns the first call\'s result on every later call; a wheel that instead becomes a no-op (returns undefined after the first call) behaves differently'
  },

  // ── async / control flow ─────────────────────────────────────────────────────
  {
    id: 'retry',
    title: 'Hand-rolled retry with backoff',
    langs: ['js'],
    category: 'async',
    namePattern: /^(retry\w*|with[_-]?retry|\w*retry)$/i,
    nameOnly: false,
    bodyHints: [
      /Math\.pow\(\s*2\b/,
      /\b2\s*\*\*\s*\w+/,
      /\bdelay\s*\*=\s*2\b/,
      /await\s+(sleep|delay|wait)\s*\(/i
    ],
    coveredBy: {
      deps: [
        { name: 'p-retry', api: 'pRetry(fn, { retries, factor, minTimeout })' },
        { name: 'async-retry', api: 'retry(fn, { retries })' }
      ]
    },
    fpNote: 'retry policy is often intentionally bespoke — jitter, per-error-code decisions, circuit-breaking, idempotency guards — so treat this as a candidate to CONFIRM, not an automatic defect; the wheel is only redundant if it is a plain exponential backoff'
  },
  {
    id: 'py-retry',
    title: 'Hand-rolled retry with backoff',
    langs: ['py'],
    category: 'async',
    namePattern: /^(retry|with[_-]?retry|retryable|retry[_-]?call|retrying)$/i,
    nameOnly: false,
    bodyHints: [
      /time\.sleep\([^)]*\*\*/,
      /\b2\s*\*\*\s*\w+/,
      /backoff\s*\*=?\s*2\b/
    ],
    coveredBy: {
      deps: [
        { name: 'tenacity', api: '@retry(wait=wait_exponential(), stop=stop_after_attempt(n))' },
        { name: 'backoff', api: '@backoff.on_exception(backoff.expo, Exception)' }
      ]
    },
    fpNote: 'the Python stdlib has no retry helper — tenacity/backoff are deps, not built-ins; and as with JS, a bespoke policy (jitter, per-exception rules) can be a deliberate choice rather than a wheel'
  },
  {
    id: 'sleep',
    title: 'Hand-rolled sleep/delay',
    langs: ['js'],
    category: 'async',
    namePattern: /^(sleep|delay|delay[_-]?ms|msleep|snooze|pause[_-]?ms)$/i,
    nameOnly: true,
    bodyHints: [/new Promise\(\s*(?:\w+|\([^)]*\))\s*=>\s*setTimeout\(/],
    coveredBy: {
      builtin: {
        name: 'node:timers/promises',
        api: "import { setTimeout as sleep } from 'node:timers/promises'; await sleep(ms)",
        since: { node: 15 },
        note: 'accepts an AbortSignal to cancel the wait; returns a promise'
      }
    },
    fpNote: 'the promisified setTimeout is a faithful replacement for a `new Promise(r => setTimeout(r, ms))` wheel; only diverges if the wheel resolves with a value or ignores unref/timer semantics'
  },
  {
    id: 'promisify',
    title: 'Hand-rolled callback-to-promise wrapper',
    langs: ['js'],
    category: 'async',
    namePattern: /^(promisify|to[_-]?promise|denodeify|thenify|as[_-]?promise|callback[_-]?to[_-]?promise)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'node:util',
        api: 'util.promisify(fn)',
        note: 'assumes a Node-style (err, value) callback as the last argument; honors a custom util.promisify.custom implementation'
      }
    },
    fpNote: 'util.promisify only works for error-first callbacks; a wheel wrapping a non-standard callback signature (no error arg, or multiple values) is not a match'
  },
  {
    id: 'deferred',
    title: 'Hand-rolled deferred (externally-resolved promise)',
    langs: ['js'],
    category: 'async',
    namePattern: /^(defer|deferred|create[_-]?deferred|make[_-]?deferred|promise[_-]?resolvers?)$/i,
    nameOnly: false,
    bodyHints: [
      /(?:let|var)\s+resolve\b[\s\S]{0,120}new Promise\(/,
      /\bresolve\s*=\s*(?:res|resolve|_resolve)\b/
    ],
    coveredBy: {
      builtin: {
        name: 'Promise.withResolvers',
        api: 'const { promise, resolve, reject } = Promise.withResolvers()',
        since: { node: 22 }
      }
    },
    fpNote: 'Promise.withResolvers needs Node >= 22 — on an older target the hand-rolled deferred is still required, so confirm the engines/runtime floor before recommending the swap'
  },
  {
    id: 'timeout',
    title: 'Hand-rolled promise timeout',
    langs: ['js'],
    category: 'async',
    namePattern: /^(timeout|with[_-]?timeout|promise[_-]?timeout|time[_-]?limit|deadline)$/i,
    nameOnly: false,
    bodyHints: [
      /Promise\.race\(/,
      /setTimeout\(\s*(?:\(\)\s*=>\s*)?rej\w*/,
      /new Promise\([^)]*rej\w*[\s\S]{0,60}setTimeout\(/
    ],
    coveredBy: {
      builtin: {
        name: 'AbortSignal.timeout',
        api: 'AbortSignal.timeout(ms) passed to a signal-aware API (fetch, etc.)',
        since: { node: '17.3' },
        note: 'only cancels operations that accept an AbortSignal'
      }
    },
    fpNote: 'this is the classic "replacement differs" case: AbortSignal.timeout aborts an abortable operation, but a Promise.race timeout wheel does NOT cancel the losing promise (the work keeps running) — they have different semantics, so verify whether the site needs true cancellation or just a rejected race before touching it'
  },

  // ── numbers ─────────────────────────────────────────────────────────────────
  {
    id: 'clamp',
    title: 'Hand-rolled clamp',
    langs: ['js'],
    category: 'numbers',
    namePattern: /^(clamp|clamp[_-]?number|clip[_-]?value|constrain)$/i,
    nameOnly: false,
    bodyHints: [
      /Math\.min\(\s*\w+\s*,\s*Math\.max\(/,
      /Math\.max\(\s*\w+\s*,\s*Math\.min\(/
    ],
    coveredBy: {
      deps: [
        { name: 'lodash', api: '_.clamp(number, lower, upper)' }
      ]
    },
    fpNote: 'a two-line Math.min(Math.max(...)) clamp is often BELOW the cost of a dependency — flag it, but the honest verdict may be "keep it, no lodash needed"; if lodash is already installed the case is stronger'
  },
  {
    id: 'random-int',
    title: 'Hand-rolled random integer',
    langs: ['js'],
    category: 'numbers',
    namePattern: /^(random[_-]?int|rand[_-]?int|random[_-]?number|random[_-]?range|random[_-]?between|get[_-]?random[_-]?int)$/i,
    nameOnly: false,
    bodyHints: [/Math\.floor\(\s*Math\.random\(\)\s*\*/],
    coveredBy: {
      builtin: {
        name: 'node:crypto',
        api: 'crypto.randomInt(min, max)',
        since: { node: '12.19' },
        note: 'cryptographically strong and unbiased; max is exclusive'
      }
    },
    fpNote: 'do NOT reflexively "upgrade" Math.floor(Math.random()*n) to crypto.randomInt — for non-security uses Math.random is correct and cheaper; crypto.randomInt matters only when the value must be unpredictable or perfectly uniform (tokens, sampling, shuffles that must not be guessable)'
  },

  // ── ids ─────────────────────────────────────────────────────────────────────
  {
    id: 'uuid',
    title: 'Hand-rolled UUID generator',
    langs: ['js'],
    category: 'ids',
    namePattern: /^(uuid|uuidv4|uuid4|gen(?:erate)?[_-]?uuid|make[_-]?uuid|new[_-]?uuid)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'node:crypto',
        api: 'crypto.randomUUID()',
        since: { node: '14.17' },
        note: 'returns a v4 UUID string; also available as the global crypto.randomUUID() on newer runtimes'
      },
      deps: [
        { name: 'uuid', api: "import { v4 as uuidv4 } from 'uuid'; uuidv4()" }
      ]
    },
    fpNote: 'crypto.randomUUID only produces v4; if the site needs a different UUID version (v1/v5/v7) or a time-sortable/shorter id (ULID, nanoid), it is not a drop-in — check the format requirement, and beware a wheel using Math.random which is not a real UUID at all'
  },
  {
    id: 'py-uuid',
    title: 'Hand-rolled UUID generator',
    langs: ['py'],
    category: 'ids',
    namePattern: /^(uuid4|gen(?:erate)?[_-]?uuid|make[_-]?uuid|new[_-]?uuid)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'uuid',
        api: 'uuid.uuid4()',
        note: 'standard-library module; returns a UUID object, str() it for the hex form'
      }
    },
    fpNote: 'uuid.uuid4 is v4 only; a different version or a sortable/short id is a separate requirement, and a Math/random-hex wheel is not a spec-compliant UUID'
  },

  // ── encoding ────────────────────────────────────────────────────────────────
  {
    id: 'base64',
    title: 'Hand-rolled base64 encode/decode',
    langs: ['js'],
    category: 'encoding',
    namePattern: /^(to[_-]?base64|from[_-]?base64|base64[_-]?encode|base64[_-]?decode|encode[_-]?base64|decode[_-]?base64|b64[_-]?encode|b64[_-]?decode)$/i,
    nameOnly: false,
    bodyHints: [
      /['"]ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\+\/=?['"]/,
      /charCodeAt\([^)]*\)[\s\S]{0,40}(?:>>|<<|&\s*0x3[fF])/
    ],
    coveredBy: {
      builtin: {
        name: 'Buffer / atob / btoa',
        api: "Buffer.from(str, 'base64') to decode, Buffer.from(bytes).toString('base64') to encode",
        note: 'the global atob/btoa exist too (Node >= 16) but are byte-string based; Buffer is the safer choice for arbitrary bytes'
      }
    },
    fpNote: 'standard base64 (+ /) differs from URL-safe base64 (- _) and from unpadded variants; if the wheel implements base64url, use Buffer with the "base64url" encoding, not plain "base64"'
  },
  {
    id: 'py-base64',
    title: 'Hand-rolled base64 encode/decode',
    langs: ['py'],
    category: 'encoding',
    namePattern: /^(to[_-]?base64|from[_-]?base64|base64[_-]?encode|base64[_-]?decode|b64[_-]?encode|b64[_-]?decode|encode[_-]?base64)$/i,
    nameOnly: false,
    bodyHints: [
      /['"]ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\+\/=?['"]/,
      /ord\(\s*\w+\s*\)[\s\S]{0,40}(?:>>|<<|&\s*0x3[fF])/
    ],
    coveredBy: {
      builtin: {
        name: 'base64',
        api: 'base64.b64encode(b) / base64.b64decode(s)',
        note: 'operates on bytes; use base64.urlsafe_b64encode for the URL-safe alphabet'
      }
    },
    fpNote: 'watch the alphabet (standard vs urlsafe) and the bytes/str boundary — b64encode wants bytes and returns bytes; a wheel operating on str may be doing its own encode/decode dance'
  },
  {
    id: 'query-string',
    title: 'Hand-rolled query-string parser',
    langs: ['js'],
    category: 'encoding',
    namePattern: /^(parse[_-]?query(?:[_-]?string)?|parse[_-]?qs|query[_-]?string[_-]?parse|parse[_-]?search)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'URLSearchParams',
        api: 'Object.fromEntries(new URLSearchParams(str)) or new URLSearchParams(str).getAll(key)',
        note: 'handles percent-decoding and + as space; repeated keys need getAll(), since fromEntries keeps only the last'
      },
      deps: [
        { name: 'qs', api: 'qs.parse(str)' },
        { name: 'query-string', api: 'queryString.parse(str)' }
      ]
    },
    fpNote: 'URLSearchParams collapses repeated keys under Object.fromEntries (use getAll) and does NOT parse nested/bracket syntax (a[b]=c); if the wheel builds nested objects or arrays from brackets, that is the qs library, not URLSearchParams'
  },
  {
    id: 'py-query-parse',
    title: 'Hand-rolled query-string parser',
    langs: ['py'],
    category: 'encoding',
    namePattern: /^(parse[_-]?query(?:[_-]?string)?|parse[_-]?qs|parse[_-]?querystring|split[_-]?query|parse[_-]?params)$/i,
    nameOnly: true,
    bodyHints: [],
    coveredBy: {
      builtin: {
        name: 'urllib.parse',
        api: 'urllib.parse.parse_qs(qs) or parse_qsl(qs) for a list of pairs',
        note: 'handles percent-decoding; parse_qs returns a list of values per key'
      }
    },
    fpNote: 'parse_qs returns {key: [values]} (always a list) and percent-decodes; a naive split on & and = mishandles encoded values, repeated keys, and blank values — but if the site truly wants a flat single-value dict, parse_qsl + dict() is the honest match'
  },

  // ── events ──────────────────────────────────────────────────────────────────
  {
    id: 'event-emitter',
    title: 'Hand-rolled event emitter / pub-sub',
    langs: ['js'],
    category: 'events',
    namePattern: /^(event[_-]?emitter|emitter|event[_-]?bus|pub[_-]?sub|create[_-]?emitter|mitt)$/i,
    nameOnly: false,
    bodyHints: [
      /this\.(?:_?listeners|_?handlers|_?events|_?subscribers)\b/,
      /(?:listeners|handlers|subscribers)\[\s*\w+\s*\]\s*(?:=|\|\||\.push\()/
    ],
    coveredBy: {
      builtin: {
        name: 'node:events',
        api: 'import { EventEmitter } from "node:events"; class X extends EventEmitter {}',
        note: 'synchronous, string/symbol event names; the browser-native EventTarget is the DOM-style alternative'
      }
    },
    fpNote: 'EventEmitter is synchronous and unordered across listeners; a wheel providing wildcard events, async emission, or typed events (mitt/nanoevents territory) offers something node:events does not — do not claim a straight swap'
  }
];

/**
 * Return the patterns that apply to a source language. The js/ts/jsx/tsx/mjs/cjs
 * family all map to 'js'; anything Python-flavored maps to 'py'. Unknown
 * languages yield an empty list (the scanner simply skips the file).
 * @param {string} lang - A language or file-extension tag, e.g. 'ts', 'py', 'jsx'.
 * @returns {Pattern[]}
 */
export function patternsForLang(lang) {
  const normalized = normalizeLang(lang);
  if (!normalized) return [];
  return PATTERNS.filter(p => p.langs.includes(normalized));
}

/**
 * Fold a language or extension tag onto one of the catalog's two families.
 * @param {string} lang
 * @returns {'js'|'py'|null}
 */
function normalizeLang(lang) {
  const l = String(lang || '').toLowerCase().replace(/^\./, '');
  if (['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'javascript', 'typescript'].includes(l)) {
    return 'js';
  }
  if (['py', 'pyi', 'python'].includes(l)) return 'py';
  return null;
}
