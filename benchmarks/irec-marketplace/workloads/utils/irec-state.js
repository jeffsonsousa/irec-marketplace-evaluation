'use strict';

/**
 * Shared state helper for I-REC marketplace workloads.
 * Mirrors the role of MarketplaceState in the telecom benchmark,
 * providing deterministic ID generation and fixture access.
 */
class IrecState {
  constructor(workerIndex, roundArguments) {
    this.workerIndex = workerIndex;
    this.args = roundArguments || {};
  }

  randId(prefix = 'irec') {
    const s = Math.random().toString(16).slice(2, 10);
    return `${prefix}-${Date.now()}-${this.workerIndex}-${s}`;
  }

  pick(arr, fallback) {
    if (!arr || arr.length === 0) return fallback;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // EnergySource enum: HYDRO=0, WIND=1, SOLAR=2
  randomEnergySource() {
    return Math.floor(Math.random() * 3);
  }

  makeProductionPeriod() {
    return '01/2024-12/2024';
  }

  getDefaultVolume() {
    const v = process.env.CALIPER_IREC_VOLUME || this.args.volume || 100;
    return Number(v);
  }

  getDefaultPrice() {
    const v = process.env.CALIPER_IREC_PRICE || this.args.price || 1000;
    return Number(v);
  }

  getBuyer() {
    return process.env.CALIPER_BUYER || this.args.buyer || '0x0aC77157559c7FD1595c05428C9066D48932Dc39';
  }

  getPreIrecId() {
    return process.env.CALIPER_PRE_IREC_ID || this.args.preIrecId || 'pre-irec-bench-001';
  }

  getIrecUUID() {
    return process.env.CALIPER_IREC_UUID || this.args.irecUuid || 'uuid-irec-bench-001';
  }

  getOfferId() {
    return process.env.CALIPER_OFFER_ID || this.args.offerId || 'offer-bench-001';
  }

  getReceiptIndex() {
    const v = process.env.CALIPER_RECEIPT_INDEX || this.args.receiptIndex || 1;
    return Number(v);
  }
}

module.exports = IrecState;
