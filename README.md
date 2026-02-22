# Robinhood Swap (Testnet)

## Chain
- RPC: https://rpc.testnet.chain.robinhood.com
- Chain ID: 46630
- Explorer: https://explorer.testnet.chain.robinhood.com

## Setup
1. Copy `.env.example` to `.env` and set `VITE_ROUTER_ADDRESS`.
2. Install deps and run:

```bash
npm install
npm run dev
```

## Deploy Router (Hardhat)
1. Set `PRIVATE_KEY` di `.env`.
2. Deploy Factory + WETH9 + Router:

```bash
npm run dev:contracts
npm run deploy:robinhood
```

Output akan menampilkan address `Router:`. Isi itu ke `VITE_ROUTER_ADDRESS`.

## Seed Liquidity (biar bisa swap)
Router butuh pool punya reserve. Script ini deploy token `TST`, mint ke deployer, lalu buat pool `TST/WETH` dan isi liquidity.

```bash
ROUTER_ADDRESS=0x... npm run seed:robinhood
```

## Notes
- App ini swap-only (connect wallet, quote `getAmountsOut`, approve ERC20, lalu swap).
- Router harus compatible dengan ABI UniswapV2Router02 (fungsi `getAmountsOut`, `swapExactTokensForTokens`, `swapExactETHForTokens`, `swapExactTokensForETH`).
- Token ERC20 bisa dimasukkan manual via address di UI.
