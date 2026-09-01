'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

const SupportedConnectors = ['ethereum'];

class OperationBase extends WorkloadModuleBase {
  constructor() {
    super();
  }

  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.workerIndex = workerIndex;
    this.totalWorkers = totalWorkers;
    this.roundArguments = roundArguments;

    this.assertConnectorType();
    this.state = this.createState();
  }

  createState() {
    throw new Error('I-REC workload error: "createState" must be overridden in derived classes');
  }

  assertConnectorType() {
    this.connectorType = this.sutAdapter.getType();
    if (!SupportedConnectors.includes(this.connectorType)) {
      throw new Error(`Connector type ${this.connectorType} is not supported by the benchmark`);
    }
  }

  createConnectorRequest(contract, operation, args, readOnly = false) {
    switch (this.connectorType) {
      case 'ethereum':
        return { contract, verb: operation, args, readOnly };
      default:
        throw new Error(`Connector type ${this.connectorType} is not supported`);
    }
  }
}

module.exports = OperationBase;
