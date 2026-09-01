#!/usr/bin/env node
/**
 * setup-fixtures.js (Versão Dinâmica c/ Sondagem de ID)
 * Semeia os contratos I-REC com dados aleatórios gerados sob demanda.
 * Utiliza getUUIDByTokenId para encontrar o próximo ID disponível na rede.
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const http     = require('http');
const readline = require('readline');
const crypto   = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT   = path.resolve(__dirname, '..');
const BESU_RPC       = process.env.BESU_RPC || 'http://127.0.0.1:8545';
const CONTRACTS_JSON = process.env.CONTRACTS_JSON ||
  path.join(PROJECT_ROOT, 'benchmarks', 'irec-marketplace', 'config', 'contracts.json');
const FIXTURES_JSON  = process.env.FIXTURES_JSON  ||
  path.join(PROJECT_ROOT, 'benchmarks', 'irec-marketplace', 'fixtures', 'fixtures.json');
const ADMIN_KEY      = process.env.ADMIN_KEY ||
  'YOUR_PRIVATEKEY';

// ── Prompts CLI ───────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(questionText, defaultVal) {
  return new Promise(resolve => {
    rl.question(`\x1b[36m${questionText}\x1b[0m`, answer => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

// ── JSON-RPC HTTP (porta 8545) ────────────────────────────────────────────────

let _rpcId = 1;

function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: _rpcId++, method, params });
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
        } catch (e) { reject(new Error(`Resposta inválida: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on('error', e => reject(new Error(
      `Conexão com ${BESU_RPC} falhou: ${e.message}\n` +
      '  → Besu deve rodar com --rpc-http-enabled --rpc-http-port=8545'
    )));
    req.write(body);
    req.end();
  });
}

async function checkConnection() {
  const hex = await rpc('eth_chainId');
  return parseInt(hex, 16);
}

// ── Web3 (para sign, encodeABI e calls locais) ────────────────────────────────

let Web3;
try { Web3 = require('web3'); }
catch (e) { console.error('[ERROR] npm install web3'); process.exit(1); }

// Inicia com provider para permitir o uso de .call() na sondagem
const web3 = new Web3(BESU_RPC);

async function getNonce(addr)     { return parseInt(await rpc('eth_getTransactionCount', [addr, 'pending']), 16); }
async function getGasPrice()      { return rpc('eth_gasPrice'); }
async function estimateGas(f,t,d) { return Math.round(parseInt(await rpc('eth_estimateGas',[{from:f,to:t,data:d}]),16)*1.3); }

async function waitReceipt(hash, attempts = 90, ms = 2000) {
  for (let i = 0; i < attempts; i++) {
    const r = await rpc('eth_getTransactionReceipt', [hash]);
    if (r) {
      if (r.status === '0x0') throw new Error(`Tx revertida: ${hash}`);
      return r;
    }
    await new Promise(r => setTimeout(r, ms));
  }
  throw new Error(`Timeout esperando recibo de ${hash}`);
}

async function sendTx(account, to, data) {
  const [nonce, gasPrice, gas] = await Promise.all([
    getNonce(account.address), getGasPrice(), estimateGas(account.address, to, data),
  ]);
  const signed = await web3.eth.accounts.signTransaction(
    { nonce: web3.utils.toHex(nonce), gasPrice, gas: web3.utils.toHex(gas), to, data, value: '0x0' },
    account.privateKey
  );
  const hash = await rpc('eth_sendRawTransaction', [signed.rawTransaction]);
  return waitReceipt(hash);
}

async function call(account, contract, method, args) {
  const data = contract.methods[method](...args).encodeABI();
  return sendTx(account, contract.options.address, data);
}

// ── File helpers ──────────────────────────────────────────────────────────────

function loadJson(p) {
  if (!fs.existsSync(p)) { console.error(`[ERROR] Não encontrado: ${p}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function resolveAbi(value) {
  if (path.isAbsolute(value)) return value;
  const a = path.resolve(path.dirname(CONTRACTS_JSON), value);
  if (fs.existsSync(a)) return a;
  return path.resolve(PROJECT_ROOT, value.replace(/^(\.\.\/)+/, ''));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║       I-REC Fixture Setup (Dinâmico + Sondagem)        ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`RPC : ${BESU_RPC}`);

  let chainId;
  try { chainId = await checkConnection(); }
  catch (e) { console.error(`\n[ERROR] ${e.message}`); process.exit(1); }
  console.log(`Chain ID: ${chainId}\n`);

  const cfg = loadJson(CONTRACTS_JSON);
  let fx  = loadJson(FIXTURES_JSON);

  // Instancia contratos
  const tokenIrec    = new web3.eth.Contract(loadJson(resolveAbi(cfg.TokenIrec.abi)),    cfg.TokenIrec.address);
  const assetManager = new web3.eth.Contract(loadJson(resolveAbi(cfg.AssetManager.abi)), cfg.AssetManager.address);
  const tradeTokens  = new web3.eth.Contract(loadJson(resolveAbi(cfg.TradeTokens.abi)),  cfg.TradeTokens.address);

  const admin = web3.eth.accounts.privateKeyToAccount(ADMIN_KEY);
  const buyer = web3.eth.accounts.privateKeyToAccount(process.env.BUYER_KEY || ADMIN_KEY);

  // --- SONDAGEM DO PRÓXIMO TOKEN ID (SEM REDEPLOY) ---
  let nextTokenId = 2; // ID 1 é o NeoCoin
  
  try {
    console.log('Sondando a blockchain para encontrar o próximo Token ID livre (via getUUIDByTokenId)...');
    
    while (true) {
      const uuid = await tokenIrec.methods.getUUIDByTokenId(nextTokenId).call();
      
      if (!uuid || uuid === "") {
        // Encontramos o buraco! Este é o próximo ID que o contrato usará.
        break;
      }
      nextTokenId++;
    }

    console.log(`✓ Sonda finalizada. O próximo Token I-REC será mintado no ID: ${nextTokenId}\n`);
  } catch (error) {
    console.error(`[ERRO] Falha ao sondar a rede. Verifique se o contrato está implantado e o RPC online.`);
    console.error(`Detalhe: ${error.message}`);
    process.exit(1);
  }

  // --- INTERATIVIDADE ---
  console.log('--- Configuração de Carga ---');
  const w3Count = parseInt(await ask('Quantos PreIRECs (W3) deseja gerar? [10]: ', '10'));
  const w6Count = parseInt(await ask('Quantas Ofertas (W6) deseja gerar? [10]: ', '10'));
  const w7Count = parseInt(await ask('Quantos IRECs para queima (W7) deseja gerar? [20]: ', '20'));
  rl.close();

  // --- GERAÇÃO DOS DADOS ---
  console.log('\nGerando novos UUIDs e atualizando fixtures.json...');
  fx.preIrecsForBuy = Array.from({ length: w3Count }, () => crypto.randomUUID());
  fx.irecsForSell   = Array.from({ length: w6Count }, () => crypto.randomUUID());
  fx.irecsForBurn   = Array.from({ length: w7Count }, () => crypto.randomUUID());
  
  // Montando ofertas atreladas aos IDs dinâmicos buscados da rede
  fx.offersForBuy = fx.irecsForSell.map((uuid, i) => ({
    offerId: `OFFER-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
    tokenIds: [nextTokenId + i], 
    quantities: [fx.irecDefaultVolume || 100],
    price: 10
  }));

  saveJson(FIXTURES_JSON, fx);
  console.log(`✓ ${FIXTURES_JSON} atualizado para o Caliper consumir.`);

  console.log(`\nContas:\n  Admin : ${admin.address}\n  Buyer : ${buyer.address}`);

  // ── 1. Mint NeoCoin (ERC1155 tokenId=1) para o buyer ──────────────────────
  console.log('\n[1/8] Mintando NeoCoin (tokenId=1) para o buyer...');
  await call(admin, tokenIrec, 'mintERC20', [fx.buyer, fx.neocoinBalancePerBuyer]);
  console.log(`      ✓ ${fx.neocoinBalancePerBuyer} NEO → ${fx.buyer}`);

  // ── 2. Cria PreIRECs on-chain (W3_BuyPreIrec) ─────────────────────────────
  console.log(`\n[2/8] Criando ${fx.preIrecsForBuy.length} PreIRECs (para W3)...`);
  for (const id of fx.preIrecsForBuy) {
    const tpl = fx.mintMetadataTemplates[0];
    try {
      await call(admin, assetManager, 'createPreIrec', [
        id, tpl.supplyCompany, fx.preIrecInitialVolume,
        '01/2024-12/2024', tpl.energySource, '2025-12-31',
      ]);
      console.log(`      ✓ ${id}`);
    } catch (e) { console.warn(`      ⚠ skipped ${id}: ${e.message}`); }
  }

  // ── 3. Buyer aprova AssetManager (W3_BuyPreIrec) ──────────────────────────
  console.log('\n[3/8] Buyer aprova AssetManager (necessário para W3_BuyPreIrec)...');
  await call(buyer, tokenIrec, 'setApprovalForAll', [cfg.AssetManager.address, true]);
  console.log(`      ✓ setApprovalForAll(AssetManager, true) — buyer`);

  // ── 4. Mint I-REC tokens para o ADMIN (seller) — pool para as ofertas W6 ──
  console.log(`\n[4/8] Mintando ${fx.irecsForSell.length} I-REC tokens para o ADMIN (seller das ofertas W6)...`);
  for (let i = 0; i < fx.irecsForSell.length; i++) {
    const uuid = fx.irecsForSell[i];
    const tpl  = fx.mintMetadataTemplates[i % fx.mintMetadataTemplates.length];
    const meta = [
      uuid, tpl.supplyCompany, tpl.originPlace,
      `${uuid}-FROM`, `${uuid}-TO`, tpl.productionPeriod, tpl.energySource, tpl.url,
      admin.address,
      fx.irecDefaultVolume,
    ];
    try {
      await call(admin, tokenIrec, 'mintIREC', [meta, 0]);
      console.log(`      ✓ ${uuid} → admin (ID vinculado na oferta: ${nextTokenId + i})`);
    } catch (e) { console.warn(`      ⚠ skipped ${uuid}: ${e.message}`); }
  }

  // ── 5. Admin aprova TradeTokens (para transferir I-RECs nas ofertas W6) ────
  console.log('\n[5/8] Admin aprova TradeTokens (para transferir I-RECs como seller em W6)...');
  await call(admin, tokenIrec, 'setApprovalForAll', [cfg.TradeTokens.address, true]);
  console.log(`      ✓ setApprovalForAll(TradeTokens, true) — admin`);

  // ── 6. Abre as ofertas on-chain (W6_BuyTradeOffer) ────────────────────────
  console.log(`\n[6/8] Abrindo ${fx.offersForBuy.length} ofertas on-chain (para W6)...`);
  for (const offer of fx.offersForBuy) {
    try {
      await call(admin, tradeTokens, 'openIrecOffer', [
        offer.offerId, offer.tokenIds, offer.quantities, offer.price,
      ]);
      console.log(`      ✓ ${offer.offerId}  tokenIds=[${offer.tokenIds}]  qty=[${offer.quantities}]  price=${offer.price}`);
    } catch (e) { console.warn(`      ⚠ skipped ${offer.offerId}: ${e.message}`); }
  }

  // ── 7. Buyer aprova TradeTokens (para debitar NeoCoin em W6) ──────────────
  console.log('\n[7/8] Buyer aprova TradeTokens (para debitar NeoCoin em W6_BuyTradeOffer)...');
  await call(buyer, tokenIrec, 'setApprovalForAll', [cfg.TradeTokens.address, true]);
  console.log(`      ✓ setApprovalForAll(TradeTokens, true) — buyer`);

  // ── 8. Mint I-REC tokens para o BUYER (para W7_BurnIREC) ──────────────────
  console.log(`\n[8/8] Mintando ${fx.irecsForBurn.length} I-REC tokens para o BUYER (para W7_BurnIREC)...`);
  for (let i = 0; i < fx.irecsForBurn.length; i++) {
    const uuid = fx.irecsForBurn[i];
    const tpl  = fx.mintMetadataTemplates[i % fx.mintMetadataTemplates.length];
    const meta = [
      uuid, tpl.supplyCompany, tpl.originPlace,
      `${uuid}-FROM`, `${uuid}-TO`, tpl.productionPeriod, tpl.energySource, tpl.url,
      fx.buyer,
      fx.irecDefaultVolume,
    ];
    try {
      await call(admin, tokenIrec, 'mintIREC', [meta, 0]);
      console.log(`      ✓ ${uuid} → buyer`);
    } catch (e) { console.warn(`      ⚠ skipped ${uuid}: ${e.message}`); }
  }

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     Setup concluído com sucesso ✓                      ║');
  console.log('╚════════════════════════════════════════════════════════╝');
}

main().catch(e => {
  console.error('\n[FATAL]', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});