import type { Address } from 'viem'

export type Token = {
  symbol: string
  address: Address | 'ETH'
  decimals: number
}

export const TOKENS: Token[] = [
  { symbol: 'ETH', address: 'ETH', decimals: 18 },
]

export const DEFAULT_ERC20_TOKEN_ADDRESSES: Address[] = [
  '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
  '0x71178BAc73cBeb415514eB542a8995b82669778d',
  '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
  '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
  '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0',
]
