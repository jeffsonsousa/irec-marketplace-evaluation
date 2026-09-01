'use strict';

const fs = require('fs');
const path = require('path');

function loadFixtures(ctx) {
  const workspace = process.env.CALIPER_WORKSPACE || process.cwd();
  const rel =
    process.env.CALIPER_FIXTURES ||
    path.join('benchmarks', 'irec-marketplace', 'fixtures', 'fixtures.json');

  const p = path.resolve(workspace, rel);
  if (!fs.existsSync(p)) {
    throw new Error(`fixtures.json not found at: ${p}`);
  }

  const data = JSON.parse(fs.readFileSync(p, 'utf8'));

  const mustArrays = [
    'preIrecsForBuy',
    'irecsForBurn',
    'offersForBuy',
    'mintMetadataTemplates',
  ];

  for (const k of mustArrays) {
    if (!Array.isArray(data[k])) {
      throw new Error(`fixtures.${k} must be an array`);
    }
  }

  return data;
}

/**
 * Deterministic round-robin picker distributed across workers and rounds.
 * Avoids tx collisions between workers.
 */
function makePicker(ctx, arrLen) {
  const wid = Number(ctx.workerIndex || 0);
  const rid = Number(ctx.roundIndex || 0);
  let cursor = 0;

  return () => {
    if (arrLen <= 0) throw new Error('Empty fixtures list');
    const totalWorkers = Number(ctx.numberOfWorkers || 1);
    const base = (rid * totalWorkers + wid) % arrLen;
    const idx = (base + cursor * totalWorkers) % arrLen;
    cursor++;
    return idx;
  };
}

function pickFromArray(ctx, arr) {
  const nextIndex = makePicker(ctx, arr.length);
  return () => arr[nextIndex()];
}

module.exports = { loadFixtures, pickFromArray };
