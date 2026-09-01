'use strict';

/**
 * W8 — E2E Mix
 * Probabilistic mix of all I-REC life-cycle operations in a single round.
 * Analogue of W8_Mix (telecom): exercises the full marketplace under
 * realistic concurrent load.
 *
 * Default probability weights:
 *   MintNeocoin        10% — baseline currency supply
 *   CreatePreIrec      15% — new generation batches
 *   BuyPreIrec         20% — purchase flow
 *   MintIREC           20% — issuance after purchase
 *   OpenTradeOffer     15% — secondary market listings
 *   BuyTradeOffer      10% — secondary market purchases
 *   BurnIREC           10% — certificate retirement
 */
const OperationBase = require('./utils/operation-base');
const IrecState     = require('./utils/irec-state');
const { pick, makeIrecUUID, makeCertRange } = require('./lib/helpers');
const { loadFixtures } = require('./lib/fixtures');

function weightedPick(weights) {
  const entries = Object.entries(weights);
  const total   = entries.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

class W8_Mix extends OperationBase {
  createState() {
    return new IrecState(this.workerIndex, this.roundArguments);
  }

  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.fx = loadFixtures(this);
  }

  async submitTransaction() {
    const mix = this.roundArguments.mix || {
      MintNeocoin:    0.10,
      CreatePreIrec:  0.15,
      BuyPreIrec:     0.20,
      MintIREC:       0.20,
      OpenTradeOffer: 0.15,
      BuyTradeOffer:  0.10,
      BurnIREC:       0.10,
    };

    const choice = weightedPick(mix);

    if (choice === 'MintNeocoin') {
      const buyer = this.fx.buyer;
      await this.sutAdapter.sendRequests(
        this.createConnectorRequest('TokenIrec', 'mintERC20', [buyer, 1000])
      );
      return;
    }

    if (choice === 'CreatePreIrec') {
      const id     = this.state.randId('pre-irec-mix');
      const source = Math.floor(Math.random() * 3);
      await this.sutAdapter.sendRequests(
        this.createConnectorRequest('AssetManager', 'createPreIrec', [
          id, 'Neoenergia Mix S.A.', 200, '01/2024-12/2024', source, '2025-12-31',
        ])
      );
      return;
    }

    if (choice === 'BuyPreIrec') {
      const preId = pick(this.fx.preIrecsForBuy);
      await this.sutAdapter.sendRequests(
        this.createConnectorRequest('AssetManager', 'buyPreIrec', [preId, 10, 100])
      );
      return;
    }

    if (choice === 'MintIREC') {
      const tpl   = pick(this.fx.mintMetadataTemplates);
      const uuid  = makeIrecUUID(this.workerIndex);
      const { from, to } = makeCertRange(uuid);
      const meta  = [
        uuid, tpl.supplyCompany, tpl.originPlace, from, to,
        tpl.productionPeriod, tpl.energySource, tpl.url, this.fx.buyer, 100,
      ];
      await this.sutAdapter.sendRequests(
        this.createConnectorRequest('TokenIrec', 'mintIREC', [meta, 0])
      );
      return;
    }

    if (choice === 'OpenTradeOffer') {
      const offerId = this.state.randId('offer-mix');
      await this.sutAdapter.sendRequests(
        this.createConnectorRequest('TradeTokens', 'openIrecOffer', [offerId, [2], [5], 500])
      );
      return;
    }

    if (choice === 'BuyTradeOffer') {
      const offer   = pick(this.fx.offersForBuy);
      const offerId = typeof offer === 'object' ? offer.offerId : offer;
      await this.sutAdapter.sendRequests(
        this.createConnectorRequest('TradeTokens', 'buyIrec', [offerId])
      );
      return;
    }

    // BurnIREC
    const uuid         = pick(this.fx.irecsForBurn);
    const { from, to } = makeCertRange(uuid, '-BURN');
    await this.sutAdapter.sendRequests(
      this.createConnectorRequest('TokenIrec', 'burnIREC', [
        this.fx.buyer, uuid, from, to, 5,
      ])
    );
  }
}

module.exports.createWorkloadModule = () => new W8_Mix();
