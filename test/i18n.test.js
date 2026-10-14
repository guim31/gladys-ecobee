// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish), is not empty, fits where it is shown,
// and the German one says "du", never the polite "Sie". The four docs have
// the same sections.
//
// The manifest is walked whole; the code texts all live in src/i18n.js, and
// a scan of the sources makes sure none is written anywhere else.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { HOLD_TEXT, LABELS, MESSAGES, NAMES, TEXT, formatWhen } from '../src/i18n.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));

const LANGS = ['en', 'fr', 'de', 'es'];
const LANGUAGE_KEYS = new Set([...LANGS, 'it', 'nl', 'pt', 'pl']);
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;
const sorted = (keys) => [...keys].sort();

/** The problems of one multi-language object. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** The bound of a manifest text, from where it sits. */
function manifestBound(path) {
  if (path === 'description') return 100;
  if (/^widgets\[\d+\]\.label$/.test(path)) return 30;
  if (/^widgets\[\d+\]\.description$/.test(path)) return 100;
  if (/\.label$/.test(path)) return 60;
  return 300;
}

/** Every multi-language object of a JSON tree, with its path. */
function* multiLanguageObjects(node, path = '') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      yield* multiLanguageObjects(item, `${path}[${index}]`);
    }
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (Object.keys(node).some((key) => LANGUAGE_KEYS.has(key))) {
    yield [path, node];
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    yield* multiLanguageObjects(value, path ? `${path}.${key}` : key);
  }
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  assert.deepEqual(Object.keys(LABELS), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const found = [...multiLanguageObjects(manifest)];
  assert.ok(found.length >= 90, `only ${found.length} texts found in the manifest`);
  const issues = found.flatMap(([path, text]) => problems(text, path, manifestBound(path)));
  assert.deepEqual(issues, []);
  // The brand is not translated.
  assert.equal(manifest.name, 'ecobee');
});

// Shown in a widget tile, a status row or a button: 24 characters at most.
const SHORT = new Set([
  'temperature',
  'setpoint',
  'humidity',
  'mode',
  'state',
  'comfort',
  'hold',
  'connection',
  'online',
  'offline',
  'heating',
  'cooling',
  'fanOnly',
  'idle',
  'lower',
  'raise',
  'modeButton',
  'comfortButton',
  'heatTo',
  'coolTo',
]);

test('every fixed text of the code has the four languages', () => {
  assert.ok(Object.keys(TEXT).length >= 40, 'the TEXT table is read whole');
  const issues = Object.entries(TEXT).flatMap(([key, value]) =>
    problems(value, `TEXT.${key}`, SHORT.has(key) ? 24 : 200),
  );
  issues.push(
    ...Object.entries(HOLD_TEXT).flatMap(([key, value]) => problems(value, `HOLD_TEXT.${key}`, 40)),
  );
  assert.deepEqual(issues, []);
});

// Every message builder, called with values as long as real ones.
const SAMPLES = {
  signedIn: [12],
  pinIssued: ['ab12', 9],
  unavailable: ['token exchange failed (HTTP 503)'],
  setpointSet: ['21.5 °C'],
  holdUntil: ['Oct 15, 10:30 PM'],
  vacationUntil: ['Oct 15, 10:30 PM'],
};
const MESSAGE_MAX = { setpointSet: 24, holdUntil: 40, vacationUntil: 40 };

test('every message builder has the four languages', () => {
  assert.deepEqual(sorted(Object.keys(MESSAGES)), sorted(Object.keys(SAMPLES)), 'a sample each');
  const issues = Object.entries(MESSAGES).flatMap(([key, build]) =>
    problems(build(...SAMPLES[key]), `MESSAGES.${key}`, MESSAGE_MAX[key] ?? 200),
  );
  assert.deepEqual(issues, []);
});

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(value, `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the feature names and option labels exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', 40), []);
  assert.deepEqual(tableProblems(LABELS, 'LABELS', 24), []);
  // Distinct within one language: Gladys shows them side by side.
  for (const lang of LANGS) {
    const names = Object.values(NAMES[lang]);
    assert.equal(new Set(names).size, names.length, `NAMES.${lang} has duplicates`);
  }
});

test('a hold end reads the way each language writes the time', () => {
  assert.equal(formatWhen('2026-10-14', '18:00:00', 'en', '2026-10-14'), '6:00 PM');
  assert.equal(formatWhen('2026-10-14', '18:00:00', 'fr', '2026-10-14'), '18:00');
  assert.equal(formatWhen('2026-10-14', '18:00:00', 'de', '2026-10-14'), '18:00');
  assert.match(formatWhen('2026-10-15', '08:30:00', 'en', '2026-10-14'), /^Oct 15.*8:30 AM$/);
  assert.match(formatWhen('2026-10-15', '08:30:00', 'fr', '2026-10-14'), /^15 oct\.? 0?8:30$/);
});

test('no multi-language text is written outside src/i18n.js', async () => {
  const sources = ['../index.js'];
  for (const dir of ['../src/', '../src/ecobee/']) {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'i18n.js') {
        sources.push(`${dir}${entry.name}`);
      }
    }
  }
  assert.ok(sources.length >= 14, `every source file is scanned (${sources.length})`);
  for (const path of sources) {
    assert.doesNotMatch(
      await read(path),
      /\b(en|fr|de|es)\s*:\s*['"`]/,
      `${path} writes a text by hand: move it to src/i18n.js`,
    );
  }
});

/** The level-2 headings of a doc, in order. */
const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());

test('the four docs exist and have the same sections, in the same order', async () => {
  const docs = Object.fromEntries(
    await Promise.all(LANGS.map(async (lang) => [lang, await read(`../docs/${lang}.md`)])),
  );
  const count = headings(docs.en).length;
  assert.ok(count >= 9, `docs/en.md has ${count} sections`);
  for (const lang of LANGS) {
    assert.equal(
      headings(docs[lang]).length,
      count,
      `docs/${lang}.md has ${headings(docs[lang]).length} sections, en has ${count}`,
    );
    assert.ok(docs[lang].length >= 3000, `docs/${lang}.md is too short`);
    assert.match(docs[lang], /ecobee/);
    // Every doc names the same feature, action and trigger keys.
    for (const key of ['home_occupied', 'home_vacant', 'alert', 'start_vacation', 'set_comfort']) {
      assert.ok(
        docs[lang].includes(key) || docs[lang].includes(key.replace('_', ' ')),
        `docs/${lang}.md mentions ${key}`,
      );
    }
  }
  // Sections are numbered alike: "1. Overview" / "1. Présentation"...
  const numbers = (lang) => headings(docs[lang]).map((heading) => heading.split(' ')[0]);
  for (const lang of LANGS) {
    assert.deepEqual(numbers(lang), numbers('en'), `docs/${lang}.md numbering`);
  }
  assert.ok(!POLITE_GERMAN.test(docs.de), 'docs/de.md says "du"');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Heat', fr: 'Chauffage', de: 'Heizen' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Geben Sie',
    'Ihr Konto',
    'Ihre E-Mail',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].label.de;
  const issues = [...multiLanguageObjects(forgotten)].flatMap(([path, text]) =>
    problems(text, path, manifestBound(path)),
  );
  assert.deepEqual(issues, [
    'scene_actions[0].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});
