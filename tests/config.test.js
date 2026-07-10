import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, SENSITIVITY_LEVELS, loadConfig, findProjectRoot } from '../src/core/config.js';

test('DEFAULTS contract', () => {
  assert.deepEqual(DEFAULTS, {
    sensitivity: 'light',
    priorities: [],
    alwaysBuild: [],
    alwaysReuse: []
  });
});

test('SENSITIVITY_LEVELS contract', () => {
  assert.deepEqual(SENSITIVITY_LEVELS, ['off', 'light', 'standard', 'strict']);
});

test('loadConfig returns defaults with a null _path when no file is found', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-config-'));
  try {
    const cfg = loadConfig(dir);
    assert.deepEqual(cfg, { ...DEFAULTS, _path: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig walks up from a nested dir and merges the found file over defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-config-'));
  const nested = join(dir, 'a', 'b', 'c');
  mkdirSync(nested, { recursive: true });
  const configPath = join(dir, '.prior-art.json');
  writeFileSync(configPath, JSON.stringify({ sensitivity: 'strict', priorities: ['speed'] }));

  try {
    const cfg = loadConfig(nested);
    assert.equal(cfg.sensitivity, 'strict');
    assert.deepEqual(cfg.priorities, ['speed']);
    assert.deepEqual(cfg.alwaysBuild, []); // untouched default
    assert.equal(cfg._path, configPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig finds a file in startDir itself, not only ancestors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-config-'));
  const configPath = join(dir, '.prior-art.json');
  writeFileSync(configPath, JSON.stringify({ sensitivity: 'off' }));

  try {
    const cfg = loadConfig(dir);
    assert.equal(cfg.sensitivity, 'off');
    assert.equal(cfg._path, configPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('full-review: sensitivity is normalized and validated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-config-'));
  try {
    writeFileSync(join(dir, '.prior-art.json'), JSON.stringify({ sensitivity: 'Strict' }));
    assert.equal(loadConfig(dir).sensitivity, 'strict');
    writeFileSync(join(dir, '.prior-art.json'), JSON.stringify({ sensitivity: 'aggressive' }));
    const cfg = loadConfig(dir);
    assert.equal(cfg.sensitivity, DEFAULTS.sensitivity);
    assert.match(cfg._warning, /invalid sensitivity/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('full-review: findProjectRoot resolves to the config owner from a subdir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-root-'));
  try {
    const nested = join(dir, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, '.prior-art.json'), '{}');
    assert.equal(findProjectRoot(nested), dir);
    const bare = mkdtempSync(join(tmpdir(), 'priorart-bare-'));
    assert.equal(findProjectRoot(bare), bare);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig reports malformed JSON via _error and never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-config-'));
  const configPath = join(dir, '.prior-art.json');
  writeFileSync(configPath, '{ not valid json');

  try {
    let cfg;
    assert.doesNotThrow(() => { cfg = loadConfig(dir); });
    assert.equal(cfg.sensitivity, DEFAULTS.sensitivity);
    // The discovered path survives a parse failure so the project root stays
    // anchored (third review: corrupt config must not split the ledger).
    assert.equal(cfg._path, configPath);
    assert.equal(typeof cfg._error, 'string');
    assert.ok(cfg._error.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
