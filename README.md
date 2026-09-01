# I-REC Marketplace — Caliper Benchmark

Hyperledger Caliper benchmark suite for the **Neoverde I-REC tokenisation platform**,
covering the complete on-chain certificate life-cycle: minting, trading, and retirement.

Adapted from the **telecom-marketplace** benchmark structure.
Target network: **Hyperledger Besu (QBFT consensus)**.

---

## Workload mapping

| Workload | Label               | Contract → Function                            | Telecom analogue       |
|----------|---------------------|------------------------------------------------|------------------------|
| W1       | MintNeocoin         | `TokenIrec.mintERC20`                          | W1_RegisterAsset       |
| W2       | CreatePreIrec       | `AssetManager.createPreIrec`                   | W1_RegisterAsset       |
| W3       | BuyPreIrec          | `AssetManager.buyPreIrec`                      | W2_HireAsset           |
| W4       | MintIREC            | `TokenIrec.mintIREC`                           | W4_CreateServiceRecord |
| W5       | OpenTradeOffer      | `TradeTokens.openIrecOffer`                    | W5_CreateService…      |
| W6       | BuyTradeOffer       | `TradeTokens.buyIrec`                          | W6_HireService         |
| W7       | BurnIREC            | `TokenIrec.burnIREC`                           | W7_PayService          |
| W8       | E2E Mix             | Probabilistic mix of all above                 | W8_Mix                 |

---

## Directory structure

```
irec-benchmark/
├── benchmarks/irec-marketplace/
│   ├── config/contracts.json          # Contract addresses and ABIs
│   ├── fixtures/fixtures.json         # Pre-seeded IDs for fixture-based workloads
│   ├── workloads/
│   │   ├── BaseIrecWorkload.js
│   │   ├── W1_MintNeocoin.js
│   │   ├── W2_CreatePreIrec.js
│   │   ├── W3_BuyPreIrec.js
│   │   ├── W4_MintIREC.js
│   │   ├── W5_OpenTradeOffer.js
│   │   ├── W6_BuyTradeOffer.js
│   │   ├── W7_BurnIREC.js
│   │   ├── W8_Mix.js
│   │   ├── lib/
│   │   │   ├── caliperInvoke.js
│   │   │   ├── fixtures.js
│   │   │   └── helpers.js
│   │   └── utils/
│   │       ├── irec-state.js
│   │       └── operation-base.js
│   ├── W1.yaml … W8.yaml             # One benchmark config per workload
├── contracts/
│   ├── abi/                           # Compiled ABIs (TokenIrec, AssetManager, TradeTokens)
│   └── definitions/
├── networks/besu-qbft.json
├── run_tps_sweep.sh                   # TPS sweep runner (5–40 TPS)
└── src/
    ├── caliper_report_plots.py
    └── reports/                       # Generated HTML reports per workload/TPS
```

---

## Setup

### 1. Deploy contracts and update addresses

After deploying `TokenIrec`, `AssetManager`, and `TradeTokens` to your Besu node,
update `benchmarks/irec-marketplace/config/contracts.json` with the deployed addresses:

```json
{
  "TokenIrec":   { "address": "0x...", "abi": "../../contracts/abi/TokenIrec.json" },
  "AssetManager":{ "address": "0x...", "abi": "../../contracts/abi/AssetManager.json" },
  "TradeTokens": { "address": "0x...", "abi": "../../contracts/abi/TradeTokens.json" }
}
```

### 2. Copy compiled ABIs

Copy the ABI JSON files from `neotk-blockchain-contracts` artifacts into `contracts/abi/`:

```bash
cp <hardhat-artifacts>/TokenIrec.json contracts/abi/
cp <hardhat-artifacts>/AssetManager.json contracts/abi/
cp <hardhat-artifacts>/TradeTokens.json contracts/abi/
```

### 3. Seed fixtures

Run the setup script to pre-register PreIRECs and issue base I-REC tokens on-chain
so that fixture-based workloads (W3, W6, W7) have valid IDs to operate on:

```bash
node scripts/setup-fixtures.js
```

### 4. Run individual workloads

```bash
npx caliper launch manager \
  --caliper-workspace . \
  --caliper-networkconfig networks/besu-qbft.json \
  --caliper-benchconfig benchmarks/irec-marketplace/W1.yaml \
  --caliper-bind-sut besu:latest \
  --caliper-flow-skip-install
```

### 5. TPS sweep

```bash
./run_tps_sweep.sh W4          # sweeps W4 at 5,10,15,20,25,30,35,40 TPS
./run_tps_sweep.sh W7 "5 10 20 40"   # custom TPS list
./run_tps_sweep.sh W2 "5 5 5 5 5"
./run_tps_sweep.sh W2 "10 10 10 10 10"
./run_tps_sweep.sh W2 "15 15 15 15 15"
./run_tps_sweep.sh W2 "20 20 20 20 20"
./run_tps_sweep.sh W2 "25 25 25 25 25"
./run_tps_sweep.sh W2 "30 30 30 30 30"
./run_tps_sweep.sh W2 "35 35 35 35 35"
./run_tps_sweep.sh W2 "40 40 40 40 40"

./run_tps_sweep.sh W3 "5"
./run_tps_sweep.sh W3 "10"
./run_tps_sweep.sh W3 "15"
./run_tps_sweep.sh W3 "20"
./run_tps_sweep.sh W3 "25"
./run_tps_sweep.sh W3 "30"
./run_tps_sweep.sh W3 "35"
./run_tps_sweep.sh W3 "40"


./run_tps_sweep.sh W4 "5 5 5 5 5"
./run_tps_sweep.sh W4 "10 10 10 10 10"
TX_NUMBER=200 ./run_tps_sweep.sh W4 "15 15 15 15 15"
TX_NUMBER=200 ./run_tps_sweep.sh W4 "20 20 20 20 20"
TX_NUMBER=200 ./run_tps_sweep.sh W4 "25 25 25 25 25"
TX_NUMBER=200 ./run_tps_sweep.sh W4 "30 30 30 30 30"
TX_NUMBER=200 ./run_tps_sweep.sh W4 "35 35 35 35 35"
TX_NUMBER=200 ./run_tps_sweep.sh W4 "40 40 40 40 40"

./run_tps_sweep.sh W5 "5 5 5 5 5"
./run_tps_sweep.sh W5 "10 10 10 10 10"
TX_NUMBER=200 ./run_tps_sweep.sh W5 "15 15 15 15 15"
TX_NUMBER=200 ./run_tps_sweep.sh W5 "20 20 20 20 20"
TX_NUMBER=200 ./run_tps_sweep.sh W5 "25 25 25 25 25"
TX_NUMBER=200 ./run_tps_sweep.sh W5 "30 30 30 30 30"
TX_NUMBER=200 ./run_tps_sweep.sh W5 "35 35 35 35 35"
TX_NUMBER=200 ./run_tps_sweep.sh W5 "40 40 40 40 40"

./run_tps_sweep.sh W6 "5"
./run_tps_sweep.sh W6 "10"
./run_tps_sweep.sh W6 "15"
./run_tps_sweep.sh W6 "20"
./run_tps_sweep.sh W6 "25"
./run_tps_sweep.sh W6 "30"
./run_tps_sweep.sh W6 "35"
./run_tps_sweep.sh W6 "40"

./run_tps_sweep.sh W7 "5"
./run_tps_sweep.sh W7 "10"
./run_tps_sweep.sh W7 "15"
./run_tps_sweep.sh W7 "20"
./run_tps_sweep.sh W7 "25"
./run_tps_sweep.sh W7 "30"
./run_tps_sweep.sh W7 "35"
./run_tps_sweep.sh W7 "40"

```

---

## Fixture pre-conditions

| Workload | Requires on-chain state                                     |
|----------|-------------------------------------------------------------|
| W3       | `preIrecsForBuy` IDs created via W2 and with volume > 0    |
| W6       | `offersForBuy` offers opened via W5 and not yet finished   |
| W7       | `irecsForBurn` UUIDs minted via W4 with remaining balance  |
| W8 Mix   | All of the above (run setup-fixtures.js first)             |

---

## Key metrics

The sweep produces per-round data for:

- **Throughput** (TPS achieved vs. TPS requested)
- **Send rate** (tx/s injected)
- **Latency** — min, max, avg, p50, p99 (ms)
- **Failure count** and failure rate (%)

Use `src/caliper_report_plots.py` to generate 2D/3D plots from the HTML reports.
