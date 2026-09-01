'use strict';

/**
 * W1 — MintNeocoin
 * Maps to: TokenIrec.mintERC20(address to, uint256 amount)
 *
 * Analogue of W1_RegisterAsset (telecom): creates the foundational fungible
 * token that is used as payment currency across the I-REC marketplace.
 * Only the contract owner (admin) can call this function.
 */
const { BaseIrecWorkload, invoke } = require('./BaseIrecWorkload');
const { pick } = require('./lib/helpers');

class W1_MintNeocoin extends BaseIrecWorkload {
  async submitTransaction() {
    const to     = this.roundArguments.to     || '0x0aC77157559c7FD1595c05428C9066D48932Dc39';
    const amounts = this.roundArguments.amounts || [100, 500, 1000];
    const amount  = pick(amounts);

    return invoke(this.sutAdapter, 'TokenIrec', 'mintERC20', [to, amount], false);
  }
}

module.exports.createWorkloadModule = () => new W1_MintNeocoin();
