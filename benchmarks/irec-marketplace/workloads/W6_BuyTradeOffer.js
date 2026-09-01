'use strict';

/**
 * W6 — BuyTradeOffer
 * Maps to: TradeTokens.buyIrec(offerId)
 *
 * Analogue of W6_HireService (telecom): executes a peer-to-peer I-REC trade,
 * atomically transferring tokens from seller to buyer and NeoCoin in reverse.
 * Models the secondary market described in Section 4.3 of the paper.
 *
 * Pre-condition: offersForBuy in fixtures must be open (not finished) on-chain.
 */
const { loadFixtures, pickFromArray } = require('./lib/fixtures');

class W6_BuyTradeOffer {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    this.workerIndex = workerIndex;
    this.numberOfWorkers = totalWorkers;
    this.roundIndex = roundIndex;
    this.sutAdapter = sutAdapter;

    this.fx = loadFixtures(this);
    this.nextOffer = pickFromArray(this, this.fx.offersForBuy);
  }

  async submitTransaction() {
    const offer    = this.nextOffer();
    const offerId  = typeof offer === 'object' ? offer.offerId : offer;

    return this.sutAdapter.sendRequests({
      contract: 'TradeTokens',
      verb: 'buyIrec',
      args: [offerId],
      readOnly: false,
    });
  }
}

module.exports.createWorkloadModule = () => new W6_BuyTradeOffer();
