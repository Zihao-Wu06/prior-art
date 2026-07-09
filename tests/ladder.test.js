import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNGS, INTEGRATION_MODES, isValidRung, formatDecisionNote, parseDecisionNote } from '../src/core/ladder.js';

test('RUNGS has the exact contract order and ids', () => {
  const ids = RUNGS.map(r => r.id);
  assert.deepEqual(ids, [
    'do-nothing',
    'built-in',
    'native-platform',
    'installed-capability',
    'existing-solution',
    'open-source',
    'commercial',
    'in-house'
  ]);
});

test('every rung has a non-empty label and summary', () => {
  for (const rung of RUNGS) {
    assert.equal(typeof rung.label, 'string');
    assert.ok(rung.label.length > 0, `${rung.id} should have a label`);
    assert.equal(typeof rung.summary, 'string');
    assert.ok(rung.summary.length > 0, `${rung.id} should have a summary`);
  }
});

test('INTEGRATION_MODES contract', () => {
  assert.deepEqual(INTEGRATION_MODES, ['adopt', 'extend', 'compose', 'build']);
});

test('isValidRung', () => {
  assert.equal(isValidRung('built-in'), true);
  assert.equal(isValidRung('in-house'), true);
  assert.equal(isValidRung('nope'), false);
  assert.equal(isValidRung(''), false);
  assert.equal(isValidRung(undefined), false);
});

test('formatDecisionNote renders the exact template and round-trips without a mode', () => {
  const decision = {
    rung: 'built-in',
    option: 'crypto.randomUUID',
    tradeoff: 'zero deps',
    rejected: 'uuid because built-in covers it',
    revisit: 'we need v1-v5 formats'
  };
  const note = formatDecisionNote(decision);
  assert.equal(
    note,
    'Decision: use built-in: crypto.randomUUID. Tradeoff: zero deps. Rejected: uuid because built-in covers it. Revisit if we need v1-v5 formats.'
  );

  const parsed = parseDecisionNote(note);
  assert.deepEqual(parsed, { ...decision, mode: null });
});

test('formatDecisionNote renders the exact template and round-trips with a mode', () => {
  const decision = {
    rung: 'existing-solution',
    option: 'acme-starter-template',
    mode: 'adopt',
    tradeoff: 'saves two weeks of setup',
    rejected: 'building the scaffold from scratch',
    revisit: 'requirements diverge from the template shape'
  };
  const note = formatDecisionNote(decision);
  assert.equal(
    note,
    'Decision: use existing-solution: acme-starter-template [mode: adopt]. Tradeoff: saves two weeks of setup. Rejected: building the scaffold from scratch. Revisit if requirements diverge from the template shape.'
  );

  const parsed = parseDecisionNote(note);
  assert.deepEqual(parsed, decision);
});

test('formatDecisionNote throws on an invalid rung', () => {
  assert.throws(() => formatDecisionNote({
    rung: 'not-a-rung', option: 'x', tradeoff: 'x', rejected: 'x', revisit: 'x'
  }), Error);
});

test('formatDecisionNote throws on an invalid mode', () => {
  assert.throws(() => formatDecisionNote({
    rung: 'built-in', option: 'x', mode: 'bogus', tradeoff: 'x', rejected: 'x', revisit: 'x'
  }), Error);
});

test('parseDecisionNote returns null (never throws) on non-matching text', () => {
  assert.equal(parseDecisionNote('not a decision note at all'), null);
  assert.equal(parseDecisionNote(''), null);
});

test('parseDecisionNote returns null (never throws) on an invalid rung', () => {
  const text = 'Decision: use not-a-rung: something. Tradeoff: x. Rejected: y. Revisit if z.';
  assert.doesNotThrow(() => parseDecisionNote(text));
  assert.equal(parseDecisionNote(text), null);
});
