import type { Address } from 'viem'

const FALLBACK_ROUTER_ADDRESS = '0x489529be9C39ad97B6280582bDFBC9cC229C2DFD' as Address
const FALLBACK_FACTORY_ADDRESS = '0x99B351731EA5e6AF35de869692823534F9ddF0B0' as Address
const FALLBACK_WETH_ADDRESS = '0x943bEeD917DF421A79172A04EeDa4d9FC5B7cca0' as Address
const FALLBACK_DEFAULT_TOKEN_ADDRESS = '0x2F8e1341Da4383Fc6DDa1c97D0DF12450C1a233f' as Address

export const ROUTER_ADDRESS = ((import.meta.env.VITE_ROUTER_ADDRESS as string) || FALLBACK_ROUTER_ADDRESS) as Address

export const FACTORY_ADDRESS = ((import.meta.env.VITE_FACTORY_ADDRESS as string) || FALLBACK_FACTORY_ADDRESS) as Address

export const WETH_ADDRESS = ((import.meta.env.VITE_WETH_ADDRESS as string) || FALLBACK_WETH_ADDRESS) as Address

export const DEFAULT_TOKEN_ADDRESS = ((import.meta.env.VITE_DEFAULT_TOKEN_ADDRESS as string) || FALLBACK_DEFAULT_TOKEN_ADDRESS) as Address

export const DEFAULT_SLIPPAGE_BPS = Number(import.meta.env.VITE_SLIPPAGE_BPS || '50')

export const DEADLINE_SECONDS = Number(import.meta.env.VITE_DEADLINE_SECONDS || '1200')
