#!/usr/bin/env node
/**
 * gas-profile.js
 * Mede o consumo de gás de cada função de escrita dos contratos I-REC.
 *
 * DOIS MODOS:
 *
 *   1. estimate  (default, não requer txs on-chain)
 *      Usa eth_estimateGas para cada função com argumentos realistas.
 *      Rápido, sem side-effects, mas é um limite superior (pode divergir
 *      ~5–10% do gás real dependendo do estado).
 *
 *   2. receipts  (requer benchmark já executado)
 *      Percorre os últimos N blocos via eth_getLogs / eth_getBlockByNumber
 *      e coleta gasUsed dos recibos de transações reais enviadas aos
 *      contratos conhecidos. Gás exato — reflete o custo médio / p95 real.
 *
 * Saída:
 *   - Tabela formatada no terminal (stdout)
 *   - JSON com estatísticas completas  → gas_profile_<timestamp>.json
 *   - CSV para importar em planilha    → gas_profile_<timestamp>.csv
 *
 * Uso:
 *   node scripts/gas-profile.js                    # estimate, modo padrão
 *   node scripts/gas-profile.js --mode receipts    # lê txs reais
 *   node scripts/gas-profile.js --mode both        # os dois juntos
 *   node scripts/gas-profile.js --blocks 5000      # janela de blocos (receipts)
 *   node scripts/gas-profile.js --out results/     # pasta de saída
 *
 * Variáveis de ambiente:
 *   BESU_RPC       (default: http://127.0.0.1:8545)
 *   CONTRACTS_JSON (default: benchmarks/irec-marketplace/config/contracts.json)
 *   FIXTURES_JSON  (default: benchmarks/irec-marketplace/fixtures/fixtures.json)
 *   ADMIN_KEY      chave privada do admin (necessária apenas para estimate)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = f => args.includes(f);

const MODE       = getArg('--mode', 'estimate');          // estimate | receipts | both
const BLOCKS     = parseInt(getArg('--blocks', '10000')); // janela para receipts
const OUT_DIR    = getArg('--out', path.resolve(__dirname, '..', 'src', 'gas'));

// ── Config ────────────────────────────────────────────────────────────────────
const PROJECT_ROOT   = path.resolve(__dirname, '..');
const BESU_RPC       = process.env.BESU_RPC || 'http://127.0.0.1:8545';
const CONTRACTS_JSON = process.env.CONTRACTS_JSON ||
  path.join(PROJECT_ROOT, 'benchmarks', 'irec-marketplace', 'config', 'contracts.json');
const FIXTURES_JSON  = process.env.FIXTURES_JSON  ||
  path.join(PROJECT_ROOT, 'benchmarks', 'irec-marketplace', 'fixtures', 'fixtures.json');
const ADMIN_KEY      = process.env.ADMIN_KEY ||
  '0xd48018e87c7f29fb441de1e0b7dc160f9fdb7efd542556c11e245e24f37eb102';

// ── JSON-RPC HTTP ─────────────────────────────────────────────────────────────
let _id = 1;
function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: _id++, method, params });
    const url  = new URL(BESU_RPC);
    const opts = {
      hostname: url.hostname,
      port:     parseInt(url.port || '8545', 10),
      path:     url.pathname || '/',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          if (j.error) return reject(new Error(`RPC ${method}: ${j.error.message}`));
          resolve(j.result);
        } catch (e) { reject(new Error(`Resposta inválida: ${raw.slice(0, 300)}`)); }
      });
    });
    req.on('error', e => reject(new Error(
      `Conexão com ${BESU_RPC} falhou: ${e.message}\n` +
      '  → Besu deve estar rodando com --rpc-http-enabled --rpc-http-port=8545'
    )));
    req.write(body); req.end();
  });
}

// ── Web3 mínimo (sem provider) ────────────────────────────────────────────────
let Web3;
try { Web3 = require('web3'); }
catch (e) { console.error('[ERROR] npm install'); process.exit(1); }
const web3 = new Web3();

// ── File helpers ──────────────────────────────────────────────────────────────
function loadJson(p) {
  if (!fs.existsSync(p)) { console.error(`[ERROR] Não encontrado: ${p}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function resolveAbi(value) {
  if (path.isAbsolute(value)) return value;
  const a = path.resolve(path.dirname(CONTRACTS_JSON), value);
  return fs.existsSync(a) ? a : path.resolve(PROJECT_ROOT, value.replace(/^(\.\.\/)+/, ''));
}

// ── Estatísticas descritivas ──────────────────────────────────────────────────
function stats(arr) {
  if (!arr.length) return { n: 0, min: null, max: null, mean: null, median: null, p95: null, stddev: null };
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const mean   = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0 ? (s[n/2-1] + s[n/2]) / 2 : s[Math.floor(n/2)];
  const p95    = s[Math.floor(n * 0.95)];
  const stddev = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, min: s[0], max: s[n-1], mean: Math.round(mean), median: Math.round(median),
           p95: Math.round(p95), stddev: Math.round(stddev) };
}

// ── Definição das funções a medir ─────────────────────────────────────────────
// Cada entrada descreve: contrato, função, e como construir os args
// a partir do estado atual (cfg + fx + contas).
function buildFunctionDefs(cfg, fx, admin, buyer) {
  const tpl = fx.mintMetadataTemplates[0];

  return [
    // ── TokenIrec ─────────────────────────────────────────────────────────────
    {
      workload: 'W1', label: 'mintERC20',
      contract: 'TokenIrec', method: 'mintERC20',
      caller: admin.address,
      args: () => [buyer.address, 1000],
      description: 'Minta NeoCoin (ERC1155 tokenId=1) para um endereço',
    },
    {
      workload: 'W4', label: 'mintIREC',
      contract: 'TokenIrec', method: 'mintIREC',
      caller: admin.address,
      args: () => [[
        `uuid-gas-probe-${Date.now()}`,
        tpl.supplyCompany, tpl.originPlace,
        'NE-GAS-001', 'NE-GAS-100',
        tpl.productionPeriod, tpl.energySource,
        tpl.url, buyer.address, 100,
      ], 0],
      description: 'Minta token I-REC ERC1155 com metadados completos',
    },
    {
      workload: '-', label: 'burnERC20',
      contract: 'TokenIrec', method: 'burnERC20',
      caller: admin.address,
      args: () => [buyer.address, 1],
      description: 'Queima NeoCoin de um endereço (owner only)',
    },
    {
      workload: 'W7', label: 'burnIREC',
      contract: 'TokenIrec', method: 'burnIREC',
      caller: admin.address,
      args: () => [
        buyer.address,
        fx.irecsForBurn[0],
        `${fx.irecsForBurn[0]}-FROM`,
        `${fx.irecsForBurn[0]}-TO`,
        10,
      ],
      description: 'Aposenta (burn) um certificado I-REC com certificado de origem',
    },
    {
      workload: '-', label: 'setApprovalForAll',
      contract: 'TokenIrec', method: 'setApprovalForAll',
      caller: buyer.address,
      args: () => [cfg.AssetManager.address, true],
      description: 'Aprova operador para todos os tokens ERC1155 do caller',
    },
    {
      workload: '-', label: 'ERC20Transfer',
      contract: 'TokenIrec', method: 'ERC20Transfer',
      caller: admin.address,
      args: () => [buyer.address, 100],
      description: 'Transfere NeoCoin (ERC1155 tokenId=1) entre endereços',
    },
    {
      workload: '-', label: 'safeTransferFrom',
      contract: 'TokenIrec', method: 'safeTransferFrom',
      caller: admin.address,
      args: () => [admin.address, buyer.address, 1, 10, '0x'],
      description: 'Transfere um token ERC1155 (ERC1155 padrão)',
    },

    // ── AssetManager ──────────────────────────────────────────────────────────
    {
      workload: 'W2', label: 'createPreIrec',
      contract: 'AssetManager', method: 'createPreIrec',
      caller: admin.address,
      args: () => [
        `pre-gas-probe-${Date.now()}`,
        tpl.supplyCompany, 500,
        '01/2024-12/2024', tpl.energySource,
        '2025-12-31',
      ],
      description: 'Registra um PreIREC no AssetManager',
    },
    {
      workload: 'W3', label: 'buyPreIrec',
      contract: 'AssetManager', method: 'buyPreIrec',
      caller: buyer.address,
      args: () => [fx.preIrecsForBuy[0], 10, 1000],
      description: 'Compra volume de um PreIREC, transferindo NeoCoin',
    },
    {
      workload: '-', label: 'expirePreIrec',
      contract: 'AssetManager', method: 'expirePreIrec',
      caller: admin.address,
      args: () => ['2024-01-01'],
      description: 'Expira PreIRECs com data anterior à informada',
    },
    {
      workload: 'W8', label: 'markReceiptAsIssued',
      contract: 'AssetManager', method: 'markReceiptAsIssued',
      caller: admin.address,
      args: () => [
        buyer.address, 0,
        '0x' + 'ab'.repeat(32),  // bytes32 hash simulado
      ],
      description: 'Marca recibo de compra como emitido (W8 — compliance)',
    },

    // ── TradeTokens ───────────────────────────────────────────────────────────
    {
      workload: 'W5', label: 'openIrecOffer',
      contract: 'TradeTokens', method: 'openIrecOffer',
      caller: admin.address,
      args: () => [
        `offer-gas-probe-${Date.now()}`,
        [2], [50], 500,
      ],
      description: 'Abre oferta de venda de tokens I-REC no mercado secundário',
    },
    {
      workload: 'W6', label: 'buyIrec',
      contract: 'TradeTokens', method: 'buyIrec',
      caller: buyer.address,
      args: () => [fx.offersForBuy[0].offerId],
      description: 'Executa compra P2P de tokens I-REC via oferta aberta',
    },
  ];
}

// ── MODO 1: eth_estimateGas ───────────────────────────────────────────────────
async function runEstimates(contracts, fnDefs) {
  console.log('\n━━━ MODO: eth_estimateGas ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  const results = [];

  for (const def of fnDefs) {
    const contract = contracts[def.contract];
    if (!contract) {
      console.warn(`  [SKIP] Contrato ${def.contract} não encontrado`);
      continue;
    }

    let gasEstimate = null;
    let error = null;

    try {
      const args = def.args();
      const data = contract.methods[def.method](...args).encodeABI();
      const hexGas = await rpc('eth_estimateGas', [{
        from: def.caller,
        to:   contract.options.address,
        data,
      }]);
      gasEstimate = parseInt(hexGas, 16);
    } catch (e) {
      // Muitas funções revertem na estimativa se o estado on-chain não existe
      // (ex: buyPreIrec sem PreIREC criado). Capturamos e marcamos como N/A.
      error = e.message.split('\n')[0].slice(0, 80);
    }

    const row = {
      workload:    def.workload,
      contract:    def.contract,
      function:    def.method,
      label:       def.label,
      description: def.description,
      caller:      def.caller,
      mode:        'estimate',
      gas_estimate: gasEstimate,
      error,
    };
    results.push(row);

    const status = gasEstimate != null
      ? `\x1b[32m${gasEstimate.toLocaleString()}\x1b[0m gas`
      : `\x1b[33mN/A\x1b[0m (${error})`;
    console.log(`  ${def.workload.padEnd(3)} ${def.contract}.${def.method.padEnd(22)} → ${status}`);
  }

  return results;
}

// ── MODO 2: gasUsed real dos recibos ─────────────────────────────────────────
async function runReceipts(contracts, fnDefs) {
  console.log('\n━━━ MODO: gasUsed real (últimos blocos) ━━━━━━━━━━━━━━━━━━━━━\n');

  // Mapeia seletor de 4 bytes → { contractName, method }
  // IMPORTANTE: tuples precisam ser expandidas para os tipos internos.
  // Ex: mintIREC(tuple,uint256) → mintIREC((string,string,...,address,uint256),uint256)
  // Sem expansão o keccak256 gera seletor errado e a tx nunca é reconhecida.
  function expandType(input) {
    if (input.type === 'tuple' && input.components) {
      return '(' + input.components.map(expandType).join(',') + ')';
    }
    if (input.type === 'tuple[]' && input.components) {
      return '(' + input.components.map(expandType).join(',') + ')[]';
    }
    return input.type;
  }

  const selectorMap = {};
  for (const [name, c] of Object.entries(contracts)) {
    const abi = c.options.jsonInterface || [];
    for (const entry of abi) {
      if (entry.type !== 'function') continue;
      try {
        const sig = `${entry.name}(${entry.inputs.map(expandType).join(',')})`;
        const sel = web3.utils.keccak256(sig).slice(0, 10); // 0x + 4 bytes hex
        selectorMap[sel] = { contractName: name, method: entry.name };
      } catch (_) {}
    }
  }

  // Log de verificação: mostra seletor real de cada função write (DEBUG=1)
  if (process.env.DEBUG) {
    console.log('  [DEBUG] Seletores registrados:');
    for (const [sel, info] of Object.entries(selectorMap)) {
      console.log(`    ${sel}  ${info.contractName}.${info.method}`);
    }
  }

  // Descobre o bloco atual
  const latestHex = await rpc('eth_blockNumber');
  const latest    = parseInt(latestHex, 16);
  const fromBlock  = Math.max(0, latest - BLOCKS);

  console.log(`  Varrendo blocos ${fromBlock} → ${latest} (${latest - fromBlock} blocos)`);

  // Endereços dos contratos (lowercase para comparação)
  const contractAddrs = new Set(
    Object.values(contracts).map(c => c.options.address.toLowerCase())
  );

  // Coleta gas de transações reais
  const gasMap = {}; // "Contract.method" → [gasUsed]
  let txCount = 0;

  for (let b = fromBlock; b <= latest; b++) {
    let block;
    try {
      block = await rpc('eth_getBlockByNumber', [`0x${b.toString(16)}`, true]);
    } catch (_) { continue; }
    if (!block || !block.transactions) continue;

    for (const tx of block.transactions) {
      if (!tx.to || !contractAddrs.has(tx.to.toLowerCase())) continue;
      if (!tx.input || tx.input.length < 10) continue;

      const sel = tx.input.slice(0, 10).toLowerCase();
      const info = selectorMap[sel];
      if (!info) continue;

      try {
        const receipt = await rpc('eth_getTransactionReceipt', [tx.hash]);
        if (!receipt || receipt.status === '0x0') continue; // ignora reverts

        const gasUsed = parseInt(receipt.gasUsed, 16);
        const key     = `${info.contractName}.${info.method}`;
        if (!gasMap[key]) gasMap[key] = [];
        gasMap[key].push(gasUsed);
        txCount++;
      } catch (_) {}
    }

    // Progresso a cada 500 blocos
    if ((b - fromBlock) % 500 === 0 && b > fromBlock) {
      process.stdout.write(`  bloco ${b}/${latest} — ${txCount} txs coletadas\r`);
    }
  }
  console.log(`\n  Total de transações coletadas: ${txCount}`);

  // Monta resultados
  const results = [];
  for (const def of fnDefs) {
    const key    = `${def.contract}.${def.method}`;
    const values = gasMap[key] || [];
    const s      = stats(values);

    results.push({
      workload:    def.workload,
      contract:    def.contract,
      function:    def.method,
      label:       def.label,
      description: def.description,
      mode:        'receipts',
      ...s,
    });

    const line = s.n > 0
      ? `n=${s.n}  min=${s.min?.toLocaleString()}  med=${s.median?.toLocaleString()}  max=${s.max?.toLocaleString()}  p95=${s.p95?.toLocaleString()}`
      : 'sem transações reais neste intervalo';
    console.log(`  ${def.workload.padEnd(3)} ${def.contract}.${def.method.padEnd(22)} → ${line}`);
  }

  return results;
}

// ── Formatação de tabela no terminal ──────────────────────────────────────────
function printTable(rows, mode) {
  console.log(`\n${'═'.repeat(100)}`);
  console.log(` GÁS POR FUNÇÃO — modo: ${mode.toUpperCase()}`);
  console.log(`${'═'.repeat(100)}`);

  if (mode === 'estimate') {
    const fmt = (r) => [
      r.workload.padEnd(4),
      r.contract.padEnd(14),
      r.function.padEnd(24),
      r.gas_estimate != null ? r.gas_estimate.toLocaleString().padStart(10) : '       N/A',
      r.error ? `  ← ${r.error.slice(0, 50)}` : '',
    ].join(' ');
    console.log('  WL   Contrato       Função                     Gas Estimado');
    console.log('  ' + '─'.repeat(80));
    rows.forEach(r => console.log('  ' + fmt(r)));
  } else {
    const fmt = (r) => [
      r.workload.padEnd(4),
      r.contract.padEnd(14),
      r.function.padEnd(24),
      String(r.n ?? 0).padStart(5),
      r.min    != null ? r.min.toLocaleString().padStart(10)    : '       N/A',
      r.median != null ? r.median.toLocaleString().padStart(10) : '       N/A',
      r.max    != null ? r.max.toLocaleString().padStart(10)    : '       N/A',
      r.p95    != null ? r.p95.toLocaleString().padStart(10)    : '       N/A',
    ].join(' ');
    console.log('  WL   Contrato       Função                        n        Min     Mediana        Max        P95');
    console.log('  ' + '─'.repeat(97));
    rows.forEach(r => console.log('  ' + fmt(r)));
  }
  console.log(`${'═'.repeat(100)}\n`);
}

// ── Exportação ────────────────────────────────────────────────────────────────
function exportJson(allResults, timestamp) {
  const p = path.join(OUT_DIR, `gas_profile_${timestamp}.json`);
  fs.writeFileSync(p, JSON.stringify({ generated: timestamp, results: allResults }, null, 2));
  console.log(`  JSON → ${p}`);
  return p;
}

function exportCsv(allResults, timestamp) {
  const cols = [
    'workload','contract','function','description','mode',
    'gas_estimate',          // estimate only
    'n','min','median','max','p95','stddev','mean',  // receipts only
    'error',
  ];
  const lines = [cols.join(',')];
  for (const r of allResults) {
    lines.push(cols.map(c => {
      const v = r[c] ?? '';
      return String(v).includes(',') ? `"${v}"` : v;
    }).join(','));
  }
  const p = path.join(OUT_DIR, `gas_profile_${timestamp}.csv`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  console.log(`  CSV  → ${p}`);
  return p;
}

// ── Verificação de conectividade ──────────────────────────────────────────────
async function checkConnection() {
  try {
    const hex = await rpc('eth_chainId');
    return parseInt(hex, 16);
  } catch (e) {
    console.error(`\n[ERROR] ${e.message}`);
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════╗');
  console.log('║       I-REC Gas Profiler                 ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`RPC  : ${BESU_RPC}`);
  console.log(`Modo : ${MODE}   Blocos: ±${BLOCKS}`);
  console.log(`Saída: ${OUT_DIR}\n`);

  const chainId = await checkConnection();
  console.log(`Chain ID: ${chainId}`);

  const cfg = loadJson(CONTRACTS_JSON);
  const fx  = loadJson(FIXTURES_JSON);

  const admin = web3.eth.accounts.privateKeyToAccount(ADMIN_KEY);
  const buyer = web3.eth.accounts.privateKeyToAccount(
    process.env.BUYER_KEY || ADMIN_KEY
  );
  console.log(`Admin : ${admin.address}`);
  console.log(`Buyer : ${buyer.address}`);

  // Instancia contratos com ABI (sem provider — só para encodeABI e seletor)
  const contracts = {};
  for (const [name, entry] of Object.entries({
    TokenIrec:    cfg.TokenIrec,
    AssetManager: cfg.AssetManager,
    TradeTokens:  cfg.TradeTokens,
  })) {
    const abi = loadJson(resolveAbi(entry.abi));
    const addr = entry.address;
    if (!addr || addr === '0x' + '0'.repeat(40)) {
      console.warn(`[WARN] ${name}: endereço zerado em contracts.json — estimativas podem falhar`);
    }
    const c = new web3.eth.Contract(abi, addr);
    c.options.jsonInterface = abi; // guarda para seletor lookup
    contracts[name] = c;
  }

  const fnDefs = buildFunctionDefs(cfg, fx, admin, buyer);

  // ── Executa modos solicitados ──────────────────────────────────────────────
  let allResults = [];

  if (MODE === 'estimate' || MODE === 'both') {
    const rows = await runEstimates(contracts, fnDefs);
    printTable(rows, 'estimate');
    allResults.push(...rows);
  }

  if (MODE === 'receipts' || MODE === 'both') {
    const rows = await runReceipts(contracts, fnDefs);
    printTable(rows, 'receipts');
    allResults.push(...rows);
  }

  // ── Exporta resultados ─────────────────────────────────────────────────────
  console.log('\n[Exportando resultados...]');
  exportJson(allResults, timestamp);
  exportCsv(allResults, timestamp);

  // ── Resumo para seção de avaliação ────────────────────────────────────────
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  RESUMO PARA SEÇÃO DE AVALIAÇÃO                             │');
  console.log('│  (funções mapeadas nos workloads W1–W8)                     │');
  console.log('├────┬──────────────┬──────────────────────┬──────────────────┤');
  console.log('│ WL │ Contrato     │ Função               │ Gás (estimativa) │');
  console.log('├────┼──────────────┼──────────────────────┼──────────────────┤');

  const evalRows = allResults.filter(r =>
    r.mode === 'estimate' && r.workload !== '-' && r.gas_estimate != null
  );
  for (const r of evalRows) {
    const wl  = r.workload.padEnd(2);
    const ct  = r.contract.slice(0, 12).padEnd(12);
    const fn  = r.function.slice(0, 20).padEnd(20);
    const gas = r.gas_estimate.toLocaleString().padStart(14);
    console.log(`│ ${wl} │ ${ct} │ ${fn} │ ${gas}   │`);
  }

  if (MODE === 'both' || MODE === 'receipts') {
    const recRows = allResults.filter(r => r.mode === 'receipts' && r.n > 0 && r.workload !== '-');
    if (recRows.length) {
      console.log('├────┼──────────────┼──────────────────────┼──────────────────┤');
      console.log('│ WL │ Contrato     │ Função               │ Mediana real     │');
      console.log('├────┼──────────────┼──────────────────────┼──────────────────┤');
      for (const r of recRows) {
        const wl  = r.workload.padEnd(2);
        const ct  = r.contract.slice(0, 12).padEnd(12);
        const fn  = r.function.slice(0, 20).padEnd(20);
        const gas = r.median.toLocaleString().padStart(14);
        console.log(`│ ${wl} │ ${ct} │ ${fn} │ ${gas}   │`);
      }
    }
  }

  console.log('└────┴──────────────┴──────────────────────┴──────────────────┘');
  console.log('\n[OK] Profiling concluído.');
}

main().catch(e => {
  console.error('\n[FATAL]', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});