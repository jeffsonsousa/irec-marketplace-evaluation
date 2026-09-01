'use strict';

/**
 * W7 — BurnIREC (Retirement)
 * Maps to: TokenIrec.burnIREC(account, uuid, certificateIdFrom, certificateIdTo, value)
 *
 * Analogue of W7_PayService (telecom): the terminal operation in the I-REC
 * life-cycle. Permanently retires a certificate, recording the finalBeneficiary
 * and environmental claim on-chain.
 * Models Section 4.3 "Retirement" and Section 4.4 compliance deadline enforcement.
 *
 * Pre-condition: irecsForBurn in fixtures must be issued (mintIREC called) on-chain.
 */
const { loadFixtures, pickFromArray } = require('./lib/fixtures');
const { makeCertRange } = require('./lib/helpers');

class W7_BurnIREC {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    this.workerIndex = workerIndex;
    this.numberOfWorkers = totalWorkers;
    this.roundIndex = roundIndex;
    this.sutAdapter = sutAdapter;

    this.fx = loadFixtures(this);
    this.nextIrec = pickFromArray(this, this.fx.irecsForBurn);

    this.account = roundArguments.account || this.fx.buyer;
    this.value   = Number(roundArguments.value || 10);
  }

  async submitTransaction() {
    const uuid            = this.nextIrec();
    const { from, to }    = makeCertRange(uuid, '-BURN');

    return this.sutAdapter.sendRequests({
      contract: 'TokenIrec',
      verb: 'burnIREC',
      args: [this.account, uuid, from, to, this.value],
      readOnly: false,
    });
  }
}

module.exports.createWorkloadModule = () => new W7_BurnIREC();
