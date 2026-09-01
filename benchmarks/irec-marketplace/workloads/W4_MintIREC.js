'use strict';

/**
 * W4 — MintIREC
 * Maps to: TokenIrec.mintIREC(MintIrecMetadata metadata, uint256 receiptIndex)
 *
 * Analogue of W4_CreateServiceRecord (telecom): formalises the on-chain
 * issuance of an I-REC token tied to a validated PurchaseReceipt.
 * receiptIndex=0 triggers the direct-mint path (owner issues without receipt).
 * Only the contract owner (admin) can call this function.
 *
 * MintIrecMetadata fields (in order for ABI encoding):
 *   uuid, supplyCompany, originPlace, certificateIdFrom, certificateIdTo,
 *   productionPeriod, energySource, url, owner, amount
 */
const { BaseIrecWorkload, invoke } = require('./BaseIrecWorkload');
const { pick, makeIrecUUID, makeCertRange } = require('./lib/helpers');
const { loadFixtures } = require('./lib/fixtures');

class W4_MintIREC extends BaseIrecWorkload {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
    this.fx = loadFixtures(this);
  }

  async submitTransaction() {
    const tpl          = pick(this.fx.mintMetadataTemplates);
    const uuid         = makeIrecUUID(this.workerIndex);
    const { from, to } = makeCertRange(uuid);
    const receiptIndex = Number(this.roundArguments.receiptIndex || 0);
    const owner        = this.roundArguments.owner || this.fx.buyer;
    const amount       = Number(this.roundArguments.volume || this.fx.irecDefaultVolume || 100);

    // Struct is passed as a tuple array — order must match Solidity struct field order
    const metadata = [
      uuid,
      tpl.supplyCompany,
      tpl.originPlace,
      from,
      to,
      tpl.productionPeriod,
      tpl.energySource,
      tpl.url,
      owner,
      amount,
    ];

    return invoke(this.sutAdapter, 'TokenIrec', 'mintIREC', [metadata, receiptIndex], false);
  }
}

module.exports.createWorkloadModule = () => new W4_MintIREC();
