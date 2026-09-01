'use strict';

/**
 * W2 — CreatePreIrec
 * Maps to: AssetManager.createPreIrec(id, enterprise, volume, generationPeriod, energySource, expirationDate)
 *
 * Analogue of W1_RegisterAsset (telecom): registers a batch of renewable
 * energy generation eligible for I-REC issuance.
 * This is the first step in the I-REC life-cycle (pre-certification).
 * Only the contract owner (admin) can call this function.
 */
const { BaseIrecWorkload, invoke } = require('./BaseIrecWorkload');
const { pick } = require('./lib/helpers');

const ENTERPRISES = [
  'Neoenergia Renovável S.A.',
  'Canoas Energia Renovável S.A.',
  'Chapada Energia Renovável S.A.',
  'Ventos de Arapuá Energia Renovável S.A.',
];

// TokenIrecLib.EnergySource: HYDRO=0, WIND=1, SOLAR=2
const ENERGY_SOURCES = [0, 1, 2];

class W2_CreatePreIrec extends BaseIrecWorkload {
  async submitTransaction() {
    const volumes    = this.roundArguments.volumes    || [100, 200, 500];
    const periods    = this.roundArguments.periods    || ['01/2024-12/2024', '01/2025-06/2025'];
    const expDates   = this.roundArguments.expDates   || ['2025-12-31'];

    const id               = `pre-irec-${this.workerIndex}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const enterprise       = pick(ENTERPRISES);
    const volume           = pick(volumes);
    const generationPeriod = pick(periods);
    const energySource     = pick(ENERGY_SOURCES);
    const expirationDate   = pick(expDates);

    return invoke(
      this.sutAdapter,
      'AssetManager',
      'createPreIrec',
      [id, enterprise, volume, generationPeriod, energySource, expirationDate],
      false
    );
  }
}

module.exports.createWorkloadModule = () => new W2_CreatePreIrec();
