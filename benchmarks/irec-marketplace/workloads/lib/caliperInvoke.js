'use strict';

/**
 * Thin wrapper over sutAdapter.sendRequests.
 * Keeps workload modules free of connector boilerplate.
 */
function buildInvokeRequest(contract, verb, args, readOnly = false) {
  return { contract, verb, args, readOnly };
}

async function invoke(sutAdapter, contract, verb, args, readOnly = false) {
  return sutAdapter.sendRequests(buildInvokeRequest(contract, verb, args, readOnly));
}

module.exports = { invoke, buildInvokeRequest };
