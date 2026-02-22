import type { Address } from 'viem'

export const ROUTER_ADDRESS = (import.meta.env.VITE_ROUTER_ADDRESS || '') as Address | ''

export const FACTORY_ADDRESS = (import.meta.env.VITE_FACTORY_ADDRESS || '') as Address | ''

export const WETH_ADDRESS = (import.meta.env.VITE_WETH_ADDRESS || '') as Address | ''

export const DEFAULT_TOKEN_ADDRESS = (import.meta.env.VITE_DEFAULT_TOKEN_ADDRESS || '') as Address | ''

export const DEFAULT_SLIPPAGE_BPS = Number(import.meta.env.VITE_SLIPPAGE_BPS || '50')

export const DEADLINE_SECONDS = Number(import.meta.env.VITE_DEADLINE_SECONDS || '1200')
