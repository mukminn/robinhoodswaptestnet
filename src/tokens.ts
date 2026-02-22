import type { Address } from 'viem'

export type Token = {
  symbol: string
  address: Address | 'ETH'
  decimals: number
}

export const TOKENS: Token[] = [
  { symbol: 'ETH', address: 'ETH', decimals: 18 },
]
