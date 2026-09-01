'use strict';

/**
 * W5 — OpenTradeOffer
 * Maps to: TradeTokens.openIrecOffer(offerId, tokenIdsSold[], tokenQuantities[], amount)
 *
 * Analogue of W5_CreateServiceRecordWithAssets (telecom): a token holder
 * lists one or more I-REC tokens on the secondary marketplace.
 * Models the decentralised trading layer described in Section 4.3 of the paper.
 *
 * Pre-condition: seller must hold the listed token IDs (enforced on-chain).
 */
const { BaseIrecWorkload, invoke } = require('./BaseIrecWorkload');
const { pick } = require('./lib/helpers');

class W5_OpenTradeOffer extends BaseIrecWorkload {
  async submitTransaction() {
    const offerId  = `offer-${this.workerIndex}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // tokenIdsSold and tokenQuantities: configurable from benchmark yaml
    const tokenIds  = this.roundArguments.tokenIds  || [2];
    const quantities = this.roundArguments.quantities || [10];
    const prices    = this.roundArguments.prices    || [500, 1000, 1500];
    const amount    = pick(prices);

    return invoke(
      this.sutAdapter,
      'TradeTokens',
      'openIrecOffer',
      [offerId, tokenIds, quantities, amount],
      false
    );
  }
}

module.exports.createWorkloadModule = () => new W5_OpenTradeOffer();
