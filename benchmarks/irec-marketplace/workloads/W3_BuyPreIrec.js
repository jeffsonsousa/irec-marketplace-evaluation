'use strict';

/**
 * W3 — BuyPreIrec
 * Maps to: AssetManager.buyPreIrec(id, amount, price)
 *
 * Analogue of W2_HireAsset (telecom): the buyer acquires a volume of
 * renewable energy certificates from a registered PreIrec, paying in
 * NeoCoin. Creates a PurchaseReceipt on-chain.
 *
 * Pre-condition: fixtures must contain valid preIrecIds registered on-chain.
 */
const { loadFixtures, pickFromArray } = require('./lib/fixtures');

class W3_BuyPreIrec {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    this.workerIndex = workerIndex;
    this.numberOfWorkers = totalWorkers;
    this.roundIndex = roundIndex;
    this.sutAdapter = sutAdapter;

    this.fx = loadFixtures(this);
    this.nextPreIrec = pickFromArray(this, this.fx.preIrecsForBuy);

    this.amount = Number(roundArguments.amount || this.fx.irecDefaultVolume || 100);
    this.price  = Number(roundArguments.price  || this.fx.neocoinBalancePerBuyer ? 1000 : 1000);
  }

  async submitTransaction() {
    const preIrecId = this.nextPreIrec();

    return this.sutAdapter.sendRequests({
      contract: 'AssetManager',
      verb: 'buyPreIrec',
      args: [preIrecId, this.amount, this.price],
      readOnly: false,
    });
  }
}

module.exports.createWorkloadModule = () => new W3_BuyPreIrec();
