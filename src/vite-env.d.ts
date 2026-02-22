/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROUTER_ADDRESS?: string
  readonly VITE_FACTORY_ADDRESS?: string
  readonly VITE_WETH_ADDRESS?: string
  readonly VITE_DEFAULT_TOKEN_ADDRESS?: string
  readonly VITE_SLIPPAGE_BPS?: string
  readonly VITE_DEADLINE_SECONDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
