'use strict';

function randId(prefix = 'irec') {
  const s = Math.random().toString(16).slice(2, 10);
  return `${prefix}-${Date.now()}-${s}`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generates a deterministic UUID for I-REC tokens.
 * Format: irec-<workerIndex>-<timestamp>-<random>
 */
function makeIrecUUID(workerIndex) {
  const s = Math.random().toString(16).slice(2, 10);
  return `irec-${workerIndex}-${Date.now()}-${s}`;
}

/**
 * Maps integer energySource to enum index expected by the Solidity contract.
 * TokenIrecLib.EnergySource: HYDRO=0, WIND=1, SOLAR=2
 */
function energySourceIndex(name) {
  const map = { HYDRO: 0, WIND: 1, SOLAR: 2 };
  return map[name] !== undefined ? map[name] : 0;
}

/**
 * Returns a certificate range pair deterministic from a UUID.
 */
function makeCertRange(uuid, suffix = '') {
  return {
    from: `${uuid}-FROM${suffix}`,
    to: `${uuid}-TO${suffix}`,
  };
}

module.exports = { randId, pick, makeIrecUUID, energySourceIndex, makeCertRange };
