#!/usr/bin/env bash
# run_tps_sweep.sh
# Executa um sweep de TPS para um workload I-REC (W1–W8), gerando um
# relatório Caliper separado por nível de TPS.
#
# A cada iteração o YAML é copiado para um arquivo temporário e os campos
# txNumber e tps são substituídos antes de passar para o Caliper — o YAML
# original nunca é modificado.
#
# Uso:
#   ./run_tps_sweep.sh <workload>              # ex: W1 (usa TPS_LIST default)
#   ./run_tps_sweep.sh W3 "5 10 15 20 25 30"  # lista customizada
#
# Variáveis de ambiente:
#   TX_NUMBER         transações por rodada         (default: 200)
#   CALIPER_WORKSPACE caminho do workspace           (default: pwd)
#   CALIPER_NETWORK   network config                 (default: networks/besu-qbft.json)
#   REPORT_DIR        onde salvar os relatórios      (default: src/reports/<workload>)

set -euo pipefail

# ── Argumentos ────────────────────────────────────────────────────────────────
WORKLOAD="${1:-W1}"
TPS_LIST="${2:-5 10 15 20 25 30 35 40}"

# ── Config ────────────────────────────────────────────────────────────────────
TX_NUMBER="${TX_NUMBER:-50}"
WORKSPACE="${CALIPER_WORKSPACE:-$(pwd)}"
NETWORK="${CALIPER_NETWORK:-networks/besu-qbft.json}"
REPORT_DIR="${REPORT_DIR:-src/reports/${WORKLOAD}}"
BENCHMARK_YAML="${WORKSPACE}/benchmarks/irec-marketplace/${WORKLOAD}.yaml"
TEMP_YAML="${WORKSPACE}/benchmarks/irec-marketplace/.${WORKLOAD}_sweep_tmp.yaml"

# ── Validações ────────────────────────────────────────────────────────────────
if [[ ! -f "${BENCHMARK_YAML}" ]]; then
  echo "[ERROR] YAML não encontrado: ${BENCHMARK_YAML}"
  exit 1
fi

mkdir -p "${REPORT_DIR}"

# Garante remoção do temp mesmo em caso de erro ou Ctrl+C
trap 'rm -f "${TEMP_YAML}"' EXIT

echo "========================================"
echo " I-REC Benchmark TPS Sweep"
echo " Workload   : ${WORKLOAD}"
echo " TPS list   : ${TPS_LIST}"
echo " TX por run : ${TX_NUMBER}"
echo " Workspace  : ${WORKSPACE}"
echo " Network    : ${NETWORK}"
echo " Reports    : ${REPORT_DIR}"
echo " YAML orig  : ${BENCHMARK_YAML}"
echo "========================================"

# ── Sweep ─────────────────────────────────────────────────────────────────────
for TPS in ${TPS_LIST}; do
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  REPORT_FILE="${REPORT_DIR}/report_${TPS}TPS_${TIMESTAMP}.html"

  echo ""
  echo "──────────────────────────────────────"
  echo "[$(date '+%H:%M:%S')] ${WORKLOAD} @ ${TPS} TPS  (txNumber=${TX_NUMBER})"
  echo "──────────────────────────────────────"

  # Copia o YAML original e substitui txNumber e tps no arquivo temporário.
  # Suporta tanto o formato inline:
  #   rateControl: { type: fixed-rate, opts: { tps: 10 } }
  # quanto formato multilinha (tps: em linha própria dentro de opts).
  sed \
    -e "s/txNumber:[[:space:]]*[0-9]*/txNumber: ${TX_NUMBER}/" \
    -e "s/\(rateControl:.*tps:\)[[:space:]]*[0-9]*/\1 ${TPS}/" \
    -e "/opts:/{ n; s/tps:[[:space:]]*[0-9]*/tps: ${TPS}/ }" \
    "${BENCHMARK_YAML}" > "${TEMP_YAML}"

  # Confirmação visual do que foi injetado
  echo "[INFO] YAML patched:"
  grep -E "txNumber|tps:" "${TEMP_YAML}" | sed 's/^/         /'

  npx caliper launch manager \
    --caliper-workspace     "${WORKSPACE}" \
    --caliper-networkconfig "${NETWORK}" \
    --caliper-benchconfig   "${TEMP_YAML}" \
    --caliper-report-path   "${REPORT_FILE}" \
    --caliper-bind-sut      besu:latest \
    --caliper-flow-only-test

  echo "[$(date '+%H:%M:%S')] ✓ Relatório salvo: ${REPORT_FILE}"
done

echo ""
echo "========================================"
echo " Sweep concluído. Relatórios em: ${REPORT_DIR}"
echo "========================================"