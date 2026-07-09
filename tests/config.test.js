import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, SENSITIVITY_LEVELS, loadConfig } from '../src/core/config.js';

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

test('loadConfig reports malformed JSON via _error and never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-config-'));
  const configPath = join(dir, '.prior-art.json');
  writeFileSync(configPath, '{ not valid json');

  try {
    let cfg;
    assert.doesNotThrow(() => { cfg = loadConfig(dir); });
    assert.equal(cfg.sensitivity, DEFAULTS.sensitivity);
    assert.equal(cfg._path, null);
    assert.equal(typeof cfg._error, 'string');
    assert.ok(cfg._error.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
