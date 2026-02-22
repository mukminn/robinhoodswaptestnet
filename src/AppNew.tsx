import React, { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { createPublicClient, createWalletClient, custom, formatUnits, http, isAddress, parseUnits } from 'viem'
import { erc20Abi, uniswapV2RouterAbi } from './abi'
import { robinhoodTestnet } from './robinhoodChain'
import { DEADLINE_SECONDS, DEFAULT_SLIPPAGE_BPS, DEFAULT_TOKEN_ADDRESS, ROUTER_ADDRESS } from './swapConfig'
import { DEFAULT_ERC20_TOKEN_ADDRESSES } from './tokens'

type Token =
  | {
      kind: 'native'
      symbol: 'ETH'
      decimals: 18
    }
  | {
      kind: 'erc20'
      address: Address
      symbol: string
      decimals: number
    }

type QuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; amountOut: bigint; path: Address[] }
  | { status: 'error'; message: string }

const NATIVE_TOKEN: Token = { kind: 'native', symbol: 'ETH', decimals: 18 }

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(' ')
}

function tokenLabel(token: Token) {
  if (token.kind === 'native') return 'ETH'
  return token.symbol || 'ERC20'
}

function tokenDecimals(token: Token) {
  return token.kind === 'native' ? 18 : token.decimals
}

function tokenAddress(token: Token): Address {
  if (token.kind === 'native') throw new Error('Native has no address')
  return token.address
}

function isSameToken(a: Token, b: Token) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'native') return true
  return a.address.toLowerCase() === (b as any).address.toLowerCase()
}

function formatCompact(value: bigint | null, decimals: number) {
  if (value === null) return '-'
  const txt = formatUnits(value, decimals)
  const num = Number(txt)
  if (!Number.isFinite(num)) return txt
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

function bpsToPct(bps: number) {
  return (bps / 100).toFixed(2)
}

function pctToBps(pctText: string) {
  const pct = Number(pctText)
  if (!Number.isFinite(pct)) return 0
  return Math.max(0, Math.round(pct * 100))
}

const LS_TRACKED_TOKENS_KEY = 'trackedErc20Tokens'
const LS_SWAP_HISTORY_PREFIX = 'swapHistory:'

type SwapHistoryItem = {
  ts: number
  txHash: `0x${string}`
  fromSymbol: string
  toSymbol: string
  amountInText: string
  amountOutText: string
}

function loadTrackedTokens(): Address[] {
  try {
    const raw = window.localStorage.getItem(LS_TRACKED_TOKENS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x) => typeof x === 'string' && isAddress(x)) as Address[]
  } catch {
    return []
  }
}

function saveTrackedTokens(tokens: Address[]) {
  window.localStorage.setItem(LS_TRACKED_TOKENS_KEY, JSON.stringify(tokens))
}

function historyKey(address: Address) {
  return `${LS_SWAP_HISTORY_PREFIX}${address.toLowerCase()}`
}

function loadHistory(address: Address): SwapHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(historyKey(address))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x) => x && typeof x === 'object' && typeof x.txHash === 'string' && typeof x.ts === 'number')
      .slice(0, 50) as SwapHistoryItem[]
  } catch {
    return []
  }
}

function saveHistory(address: Address, items: SwapHistoryItem[]) {
  window.localStorage.setItem(historyKey(address), JSON.stringify(items.slice(0, 50)))
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1629] shadow-card">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="text-sm font-semibold text-white">{title}</div>
            <button className="rounded-lg px-2 py-1 text-sm text-white/70 hover:text-white" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function App() {
  const publicClient = useMemo(() => {
    return createPublicClient({
      chain: robinhoodTestnet,
      transport: http(robinhoodTestnet.rpcUrls.default.http[0]),
    })
  }, [])
  const [address, setAddress] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [connectError, setConnectError] = useState<string>('')

  const walletClient = useMemo(() => {
    const eth = (globalThis as any).ethereum
    if (!eth) return null
    return createWalletClient({
      chain: robinhoodTestnet,
      transport: custom(eth),
    })
  }, [])

  useEffect(() => {
    if (!address) {
      setHistory([])
      return
    }
    setHistory(loadHistory(address))
  }, [address])

  useEffect(() => {
    const eth = (globalThis as any).ethereum
    if (!eth?.request) return

    let cancelled = false

    async function init() {
      try {
        const cid = (await eth.request({ method: 'eth_chainId' })) as string
        if (!cancelled) setChainId(parseInt(cid, 16))
      } catch {
        // ignore
      }

      try {
        const accounts = (await eth.request({ method: 'eth_accounts' })) as string[]
        const acc = accounts?.[0]
        if (!cancelled) setAddress(acc ? (acc as Address) : null)
      } catch {
        // ignore
      }
    }

    function onAccountsChanged(accounts: string[]) {
      const acc = accounts?.[0]
      setAddress(acc ? (acc as Address) : null)
    }

    function onChainChanged(cidHex: string) {
      setChainId(parseInt(cidHex, 16))
    }

    void init()

    eth.on?.('accountsChanged', onAccountsChanged)
    eth.on?.('chainChanged', onChainChanged)

    return () => {
      cancelled = true
      eth.removeListener?.('accountsChanged', onAccountsChanged)
      eth.removeListener?.('chainChanged', onChainChanged)
    }
  }, [])

  const [tokenIn, setTokenIn] = useState<Token>(NATIVE_TOKEN)
  const [tokenOut, setTokenOut] = useState<Token>(() => {
    if (DEFAULT_TOKEN_ADDRESS && isAddress(DEFAULT_TOKEN_ADDRESS)) {
      return { kind: 'erc20', address: DEFAULT_TOKEN_ADDRESS as Address, symbol: 'TST', decimals: 18 }
    }
    return NATIVE_TOKEN
  })

  const [amountInText, setAmountInText] = useState('')
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)

  const [quote, setQuote] = useState<QuoteState>({ status: 'idle' })
  const [txStatus, setTxStatus] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | ''>('')

  const [balanceIn, setBalanceIn] = useState<bigint | null>(null)
  const [balanceOut, setBalanceOut] = useState<bigint | null>(null)

  const [selectSide, setSelectSide] = useState<'in' | 'out' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [customAddressText, setCustomAddressText] = useState('')
  const [customError, setCustomError] = useState('')

  const [autoSwitchTried, setAutoSwitchTried] = useState(false)

  const [approvalsOpen, setApprovalsOpen] = useState(false)
  const [trackedTokens, setTrackedTokens] = useState<Address[]>([])
  const [allowances, setAllowances] = useState<Record<string, bigint>>({})
  const [tokenMeta, setTokenMeta] = useState<Record<string, { symbol: string; decimals: number }>>({})
  const [revokeError, setRevokeError] = useState('')
  const [manualRevokeAddressText, setManualRevokeAddressText] = useState('')

  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<SwapHistoryItem[]>([])

  const chainMismatch = Boolean(chainId && chainId !== robinhoodTestnet.id)

  const swapDisabledReason = useMemo(() => {
    if (!address) return ''
    if (chainMismatch) return 'Wrong network'
    if (!ROUTER_ADDRESS || !isAddress(ROUTER_ADDRESS)) return 'Router not set'
    if (!amountInText.trim()) return 'Enter amount'
    if (quote.status === 'loading') return 'Fetching quote'
    if (quote.status === 'error') return 'Quote error'
    if (quote.status !== 'ready') return 'Quote not ready'
    return ''
  }, [address, chainMismatch, amountInText, quote.status])

  const canSwap = Boolean(address && !swapDisabledReason)

  const canConnect = Boolean(walletClient)

  const canPrimaryAction = !address ? canConnect : walletClient ? canSwap : canConnect

  const explorerBaseUrl = 'https://explorer.testnet.chain.robinhood.com'

  const routerOk = Boolean(ROUTER_ADDRESS && isAddress(ROUTER_ADDRESS))

  function trackToken(addr: Address) {
    setTrackedTokens((prev) => {
      const lower = addr.toLowerCase()
      const next = prev.some((t) => t.toLowerCase() === lower) ? prev : [...prev, addr]
      try {
        saveTrackedTokens(next)
      } catch {
        // ignore
      }
      return next
    })
  }

  useEffect(() => {
    // initial scan: tokens previously approved/used in this app
    const initial = loadTrackedTokens()
    const extras: Address[] = []
    if (DEFAULT_TOKEN_ADDRESS && isAddress(DEFAULT_TOKEN_ADDRESS)) extras.push(DEFAULT_TOKEN_ADDRESS as Address)
    extras.push(...DEFAULT_ERC20_TOKEN_ADDRESSES)
    if (tokenIn.kind === 'erc20') extras.push(tokenIn.address)
    if (tokenOut.kind === 'erc20') extras.push(tokenOut.address)
    const all = [...initial, ...extras]
    const uniq: Address[] = []
    for (const a of all) {
      const lower = a.toLowerCase()
      if (!uniq.some((x) => x.toLowerCase() === lower)) uniq.push(a)
    }
    setTrackedTokens(uniq)
    try {
      saveTrackedTokens(uniq)
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadDefaultTokenMeta() {
      if (!publicClient) return

      const targets: Address[] = []
      if (DEFAULT_TOKEN_ADDRESS && isAddress(DEFAULT_TOKEN_ADDRESS)) targets.push(DEFAULT_TOKEN_ADDRESS as Address)
      targets.push(...DEFAULT_ERC20_TOKEN_ADDRESSES)

      const nextMeta: Record<string, { symbol: string; decimals: number }> = {}

      await Promise.all(
        targets.map(async (tokenAddr) => {
          try {
            const [symbol, decimals] = await Promise.all([
              publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'symbol' }) as Promise<string>,
              publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'decimals' }) as Promise<number>,
            ])
            nextMeta[tokenAddr.toLowerCase()] = { symbol, decimals }
          } catch {
            // ignore
          }
        }),
      )

      if (cancelled) return
      setTokenMeta((prev) => ({ ...prev, ...nextMeta }))
    }

    void loadDefaultTokenMeta()
    return () => {
      cancelled = true
    }
  }, [publicClient])

  useEffect(() => {
    let cancelled = false

    async function loadMetaAndAllowances() {
      if (!publicClient) return
      if (!address) return
      if (!routerOk) return

      const owner = address as Address
      const router = ROUTER_ADDRESS as Address
      const nextAllowances: Record<string, bigint> = {}
      const nextMeta: Record<string, { symbol: string; decimals: number }> = {}

      await Promise.all(
        trackedTokens.map(async (tokenAddr) => {
          try {
            const [symbol, decimals, allowance] = await Promise.all([
              publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'symbol' }) as Promise<string>,
              publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'decimals' }) as Promise<number>,
              publicClient.readContract({
                address: tokenAddr,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [owner, router],
              }) as Promise<bigint>,
            ])

            nextAllowances[tokenAddr.toLowerCase()] = allowance
            nextMeta[tokenAddr.toLowerCase()] = { symbol, decimals }
          } catch {
            // ignore token
          }
        }),
      )

      if (cancelled) return
      setAllowances(nextAllowances)
      setTokenMeta((prev) => ({ ...prev, ...nextMeta }))
    }

    void loadMetaAndAllowances()
    return () => {
      cancelled = true
    }
  }, [publicClient, address, routerOk, trackedTokens])

  useEffect(() => {
    if (!approvalsOpen) return
    if (!address || !routerOk) return

    setRevokeError('')
    // re-read allowances when modal opens (fresh state)
    let cancelled = false

    async function refresh() {
      try {
        const owner = address as Address
        const router = ROUTER_ADDRESS as Address
        const nextAllowances: Record<string, bigint> = {}
        await Promise.all(
          trackedTokens.map(async (tokenAddr) => {
            try {
              const allowance = (await publicClient.readContract({
                address: tokenAddr,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [owner, router],
              })) as bigint
              nextAllowances[tokenAddr.toLowerCase()] = allowance
            } catch {
              // ignore
            }
          }),
        )
        if (cancelled) return
        setAllowances((prev) => ({ ...prev, ...nextAllowances }))
      } catch {
        // ignore
      }
    }

    void refresh()
    return () => {
      cancelled = true
    }
  }, [approvalsOpen, address, routerOk, trackedTokens, publicClient])

  async function switchToRobinhoodChain() {
    const eth = (globalThis as any).ethereum
    if (!eth) throw new Error('No injected wallet found')
    const chainIdHex = `0x${robinhoodTestnet.id.toString(16)}`
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
    } catch (e: any) {
      const code = e?.code
      if (code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chainIdHex,
              chainName: robinhoodTestnet.name,
              nativeCurrency: robinhoodTestnet.nativeCurrency,
              rpcUrls: robinhoodTestnet.rpcUrls.default.http,
              blockExplorerUrls: [robinhoodTestnet.blockExplorers.default.url],
            },
          ],
        })
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
        return
      }
      throw e
    }
  }

  useEffect(() => {
    if (!address) return
    if (!chainMismatch) return
    if (autoSwitchTried) return

    const eth = (globalThis as any).ethereum
    if (!eth?.request) return

    setAutoSwitchTried(true)
    void switchToRobinhoodChain().catch(() => {
      // ignore - user may reject
    })
  }, [address, chainMismatch, autoSwitchTried])

  async function connectWallet() {
    try {
      setConnectError('')
      const eth = (globalThis as any).ethereum
      if (!eth) throw new Error('No injected wallet found')
      await switchToRobinhoodChain()
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
      const acc = accounts?.[0]
      if (!acc) throw new Error('No account')
      setAddress(acc as Address)
      const cid = (await eth.request({ method: 'eth_chainId' })) as string
      setChainId(parseInt(cid, 16))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setConnectError(msg)
    }
  }

  async function disconnectWallet() {
    setAddress(null)
    setTxStatus('')
    setTxHash('')
  }

  function onPrimaryAction() {
    if (!address) {
      if (!canConnect) return
      void connectWallet()
      return
    }

    if (!walletClient) {
      if (!canConnect) return
      void connectWallet()
      return
    }

    if (!canSwap) return
    void onSwap()
  }

  useEffect(() => {
    let cancelled = false

    async function hydrateErc20Meta(token: Token, setter: (t: Token) => void) {
      if (!publicClient) return
      if (token.kind !== 'erc20') return
      try {
        const [symbol, decimals] = await Promise.all([
          publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'symbol' }) as Promise<string>,
          publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'decimals' }) as Promise<number>,
        ])
        if (cancelled) return
        setter({ ...token, symbol, decimals })
      } catch {
        // keep defaults
      }
    }

    void hydrateErc20Meta(tokenIn, setTokenIn)
    void hydrateErc20Meta(tokenOut, setTokenOut)

    return () => {
      cancelled = true
    }
  }, [publicClient, tokenIn.kind === 'erc20' ? tokenIn.address : tokenIn.kind, tokenOut.kind === 'erc20' ? tokenOut.address : tokenOut.kind])

  useEffect(() => {
    let cancelled = false

    async function loadBalances() {
      if (!publicClient || !address) {
        setBalanceIn(null)
        setBalanceOut(null)
        return
      }

      try {
        const [bin, bout] = await Promise.all([
          (async () => {
            if (tokenIn.kind === 'native') return publicClient.getBalance({ address })
            return (await publicClient.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] })) as bigint
          })(),
          (async () => {
            if (tokenOut.kind === 'native') return publicClient.getBalance({ address })
            return (await publicClient.readContract({ address: tokenOut.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] })) as bigint
          })(),
        ])

        if (cancelled) return
        setBalanceIn(bin)
        setBalanceOut(bout)
      } catch {
        if (cancelled) return
        setBalanceIn(null)
        setBalanceOut(null)
      }
    }

    void loadBalances()
    const id = window.setInterval(() => void loadBalances(), 10_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [publicClient, address, tokenIn.kind === 'erc20' ? tokenIn.address : tokenIn.kind, tokenOut.kind === 'erc20' ? tokenOut.address : tokenOut.kind])

  useEffect(() => {
    let cancelled = false

    async function runQuote() {
      setTxStatus('')

      if (!publicClient) return
      if (!ROUTER_ADDRESS || !isAddress(ROUTER_ADDRESS)) {
        setQuote({ status: 'error', message: 'Router address belum diset (VITE_ROUTER_ADDRESS)' })
        return
      }
      if (!amountInText) {
        setQuote({ status: 'idle' })
        return
      }
      if (isSameToken(tokenIn, tokenOut)) {
        setQuote({ status: 'error', message: 'Token input dan output tidak boleh sama' })
        return
      }

      try {
        setQuote({ status: 'loading' })

        const trimmed = amountInText.trim()
        if (!trimmed || trimmed === '.' || trimmed === '0' || trimmed === '0.' || trimmed === '0.0') {
          setQuote({ status: 'idle' })
          return
        }

        let amountIn: bigint
        try {
          amountIn = parseUnits(trimmed, tokenDecimals(tokenIn))
        } catch {
          setQuote({ status: 'error', message: 'Invalid amount' })
          return
        }

        if (amountIn === 0n) {
          setQuote({ status: 'idle' })
          return
        }

        if (tokenIn.kind === 'native' || tokenOut.kind === 'native') {
          const weth = (await publicClient.readContract({ address: ROUTER_ADDRESS as Address, abi: uniswapV2RouterAbi, functionName: 'WETH' })) as Address
          const path: Address[] =
            tokenIn.kind === 'native'
              ? [weth, tokenAddress(tokenOut)]
              : [tokenAddress(tokenIn), weth]

          const amounts = (await publicClient.readContract({
            address: ROUTER_ADDRESS as Address,
            abi: uniswapV2RouterAbi,
            functionName: 'getAmountsOut',
            args: [amountIn, path],
          })) as readonly bigint[]

          const amountOut = amounts[amounts.length - 1]!
          if (!cancelled) setQuote({ status: 'ready', amountOut, path })
          return
        }

        const path: Address[] = [tokenAddress(tokenIn), tokenAddress(tokenOut)]
        const amounts = (await publicClient.readContract({
          address: ROUTER_ADDRESS as Address,
          abi: uniswapV2RouterAbi,
          functionName: 'getAmountsOut',
          args: [amountIn, path],
        })) as readonly bigint[]

        const amountOut = amounts[amounts.length - 1]!
        if (!cancelled) setQuote({ status: 'ready', amountOut, path })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!cancelled) setQuote({ status: 'error', message: msg })
      }
    }

    void runQuote()

    return () => {
      cancelled = true
    }
  }, [publicClient, tokenIn, tokenOut, amountInText])

  function setPctAmount(pct: number) {
    if (balanceIn === null) return
    const amount = (balanceIn * BigInt(pct)) / 100n
    setAmountInText(formatUnits(amount, tokenDecimals(tokenIn)))
  }

  const amountOutText = useMemo(() => {
    if (quote.status !== 'ready') return ''
    return formatUnits(quote.amountOut, tokenDecimals(tokenOut))
  }, [quote, tokenOut])

  const minReceivedText = useMemo(() => {
    if (quote.status !== 'ready') return ''
    const minOut = (quote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n
    const txt = formatUnits(minOut, tokenDecimals(tokenOut))
    const num = Number(txt)
    if (!Number.isFinite(num)) return txt
    return num.toLocaleString(undefined, { maximumFractionDigits: 6 })
  }, [quote, slippageBps, tokenOut])

  async function ensureAllowance(amountIn: bigint) {
    if (!address || !walletClient) throw new Error('Wallet not connected')
    if (!publicClient) throw new Error('No public client')
    if (!ROUTER_ADDRESS || !isAddress(ROUTER_ADDRESS)) throw new Error('Router not set')
    if (tokenIn.kind === 'native') return

    trackToken(tokenIn.address)

    const allowance = (await publicClient.readContract({
      address: tokenIn.address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, ROUTER_ADDRESS as Address],
    })) as bigint

    if (allowance >= amountIn) return

    setTxStatus('Approving...')
    const hash = await walletClient.writeContract({
      address: tokenIn.address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ROUTER_ADDRESS as Address, amountIn],
      account: address,
      chain: robinhoodTestnet,
    })

    setTxHash(hash)
    await publicClient.waitForTransactionReceipt({ hash })

    // refresh allowance cache
    try {
      const refreshed = (await publicClient.readContract({
        address: tokenIn.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, ROUTER_ADDRESS as Address],
      })) as bigint
      setAllowances((prev) => ({ ...prev, [tokenIn.address.toLowerCase()]: refreshed }))
    } catch {
      // ignore
    }
  }

  async function revokeToken(tokenAddr: Address) {
    try {
      setRevokeError('')
      if (!address || !walletClient) throw new Error('Connect wallet dulu')
      if (!routerOk) throw new Error('Router not set')

      setTxStatus('Revoking...')
      setTxHash('')

      const hash = await walletClient.writeContract({
        address: tokenAddr,
        abi: erc20Abi,
        functionName: 'approve',
        args: [ROUTER_ADDRESS as Address, 0n],
        account: address,
        chain: robinhoodTestnet,
      })

      setTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      setTxStatus(`Revoked: ${tokenAddr}`)

      try {
        const refreshed = (await publicClient.readContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, ROUTER_ADDRESS as Address],
        })) as bigint
        setAllowances((prev) => ({ ...prev, [tokenAddr.toLowerCase()]: refreshed }))
      } catch {
        // ignore
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setRevokeError(msg)
    }
  }

  async function onSwap() {
    try {
      if (!address || !walletClient) throw new Error('Connect wallet dulu')
      if (!publicClient) throw new Error('No public client')
      if (!ROUTER_ADDRESS || !isAddress(ROUTER_ADDRESS)) throw new Error('Router not set')
      if (quote.status !== 'ready') throw new Error('Quote belum siap')
      if (chainMismatch) throw new Error('Wrong network: switch ke Robinhood Chain Testnet (chainId 46630)')

      const amountIn = parseUnits(amountInText, tokenDecimals(tokenIn))
      const minOut = (quote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)

      await ensureAllowance(amountIn)
      setTxStatus('Swapping...')
      setTxHash('')

      if (tokenIn.kind === 'native') {
        const hash = await walletClient.writeContract({
          address: ROUTER_ADDRESS as Address,
          abi: uniswapV2RouterAbi,
          functionName: 'swapExactETHForTokens',
          args: [minOut, quote.path, address, deadline],
          value: amountIn,
          account: address,
          chain: robinhoodTestnet,
        })
        setTxHash(hash)
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        setTxStatus(`Success: ${receipt.transactionHash}`)

        const item: SwapHistoryItem = {
          ts: Date.now(),
          txHash: receipt.transactionHash,
          fromSymbol: tokenLabel(tokenIn),
          toSymbol: tokenLabel(tokenOut),
          amountInText: amountInText.trim(),
          amountOutText,
        }
        setHistory((prev) => {
          const next = [item, ...prev].slice(0, 50)
          saveHistory(address, next)
          return next
        })
        return
      }

      if (tokenOut.kind === 'native') {
        const hash = await walletClient.writeContract({
          address: ROUTER_ADDRESS as Address,
          abi: uniswapV2RouterAbi,
          functionName: 'swapExactTokensForETH',
          args: [amountIn, minOut, quote.path, address, deadline],
          account: address,
          chain: robinhoodTestnet,
        })
        setTxHash(hash)
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        setTxStatus(`Success: ${receipt.transactionHash}`)
        return
      }

      const hash = await walletClient.writeContract({
        address: ROUTER_ADDRESS as Address,
        abi: uniswapV2RouterAbi,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, minOut, quote.path, address, deadline],
        account: address,
        chain: robinhoodTestnet,
      })

      setTxHash(hash)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      setTxStatus(`Success: ${receipt.transactionHash}`)

      const item: SwapHistoryItem = {
        ts: Date.now(),
        txHash: receipt.transactionHash,
        fromSymbol: tokenLabel(tokenIn),
        toSymbol: tokenLabel(tokenOut),
        amountInText: amountInText.trim(),
        amountOutText,
      }
      setHistory((prev) => {
        const next = [item, ...prev].slice(0, 50)
        saveHistory(address, next)
        return next
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTxStatus(`Error: ${msg}`)
    }
  }

  function onSwitch() {
    const prevIn = tokenIn
    const prevOut = tokenOut
    setTokenIn(prevOut)
    setTokenOut(prevIn)
    setAmountInText(amountOutText || '')
    setTxStatus('')
  }

  function openTokenSelect(side: 'in' | 'out') {
    setCustomError('')
    setCustomAddressText('')
    setSelectSide(side)
  }

  function pickToken(token: Token) {
    if (selectSide === 'in') setTokenIn(token)
    if (selectSide === 'out') setTokenOut(token)
    setSelectSide(null)
  }

  async function onPickCustom() {
    setCustomError('')
    if (!isAddress(customAddressText)) {
      setCustomError('Address tidak valid')
      return
    }
    const addr = customAddressText as Address

    const token: Token = { kind: 'erc20', address: addr, symbol: 'ERC20', decimals: 18 }
    trackToken(addr)
    pickToken(token)
  }

  const commonTokens: Array<{ name: string; token: Token; subtitle?: string }> = useMemo(() => {
    const items: Array<{ name: string; token: Token; subtitle?: string }> = [{ name: 'ETH', token: NATIVE_TOKEN, subtitle: 'Native token' }]
    if (DEFAULT_TOKEN_ADDRESS && isAddress(DEFAULT_TOKEN_ADDRESS)) {
      items.push({
        name: 'Default token',
        token: { kind: 'erc20', address: DEFAULT_TOKEN_ADDRESS as Address, symbol: 'TST', decimals: 18 },
        subtitle: DEFAULT_TOKEN_ADDRESS,
      })
    }

    for (const addr of DEFAULT_ERC20_TOKEN_ADDRESSES) {
      const lower = addr.toLowerCase()
      const meta = tokenMeta[lower]
      const symbol = meta?.symbol || 'ERC20'
      const decimals = meta?.decimals ?? 18
      items.push({
        name: symbol,
        token: { kind: 'erc20', address: addr, symbol, decimals },
        subtitle: addr,
      })
    }
    return items
  }, [tokenMeta])

  return (
    <div className="min-h-screen text-white">
      <div className="mx-auto w-full max-w-[480px] px-4 py-10">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold tracking-tight">Swap</div>
            <div className="text-xs text-white/60">Robinhood Chain Testnet</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </button>
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-60"
              onClick={() => setHistoryOpen(true)}
              disabled={!address}
            >
              History
            </button>
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-60"
              onClick={() => setApprovalsOpen(true)}
              disabled={!address}
            >
              Revoke
            </button>
            {address ? (
              walletClient ? (
                <button
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                  onClick={() => disconnectWallet()}
                >
                  {address.slice(0, 6)}...{address.slice(-4)}
                </button>
              ) : (
                <button
                  className="rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-700 px-3 py-2 text-xs font-semibold hover:brightness-110 disabled:opacity-60"
                  onClick={() => connectWallet()}
                  disabled={!canConnect}
                >
                  Reconnect
                </button>
              )
            ) : (
              <button
                className="rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-700 px-3 py-2 text-xs font-semibold hover:brightness-110 disabled:opacity-60"
                onClick={() => connectWallet()}
                disabled={!canConnect}
              >
                Connect
              </button>
            )}
          </div>
        </div>

        {chainMismatch ? (
          <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <div>
              Wrong network. Switch wallet ke <span className="font-semibold">Robinhood Chain Testnet</span> (chainId 46630).
            </div>
            <button
              className="mt-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/15"
              type="button"
              onClick={() => void switchToRobinhoodChain()}
            >
              Switch network
            </button>
          </div>
        ) : null}

        {connectError ? <div className="mb-3 text-sm text-rose-300">{connectError}</div> : null}

        <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-card backdrop-blur">
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/60">You pay</div>
                <div className="text-xs text-white/60">
                  Balance: {formatCompact(balanceIn, tokenDecimals(tokenIn))} {tokenLabel(tokenIn)}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-white/30"
                  placeholder="0"
                  value={amountInText}
                  onChange={(e) => setAmountInText(e.target.value)}
                  inputMode="decimal"
                />
                <button
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10"
                  onClick={() => openTokenSelect('in')}
                  type="button"
                >
                  {tokenLabel(tokenIn)}
                </button>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
                  type="button"
                  onClick={() => setPctAmount(10)}
                  disabled={balanceIn === null}
                >
                  10%
                </button>
                <button
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
                  type="button"
                  onClick={() => setPctAmount(25)}
                  disabled={balanceIn === null}
                >
                  25%
                </button>
                <button
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
                  type="button"
                  onClick={() => setPctAmount(50)}
                  disabled={balanceIn === null}
                >
                  50%
                </button>
                <button
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
                  type="button"
                  onClick={() => setPctAmount(100)}
                  disabled={balanceIn === null}
                >
                  Max
                </button>
              </div>
            </div>

            <div className="flex justify-center">
              <button
                className="-my-2 rounded-xl border border-white/10 bg-[#0f1629] px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                type="button"
                onClick={onSwitch}
              >
                Switch
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/60">You receive</div>
                <div className="text-xs text-white/60">
                  Balance: {formatCompact(balanceOut, tokenDecimals(tokenOut))} {tokenLabel(tokenOut)}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="w-full text-2xl font-semibold">
                  {quote.status === 'loading' ? <span className="text-white/40">...</span> : amountOutText ? Number(amountOutText).toLocaleString(undefined, { maximumFractionDigits: 6 }) : <span className="text-white/40">0</span>}
                </div>
                <button
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10"
                  onClick={() => openTokenSelect('out')}
                  type="button"
                >
                  {tokenLabel(tokenOut)}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-white/60">Slippage</div>
                <div className="mt-1 font-semibold text-white">{bpsToPct(slippageBps)}%</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-white/60">Min received</div>
                <div className="mt-1 font-semibold text-white">{minReceivedText || '-'}</div>
              </div>
            </div>

            {quote.status === 'error' ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{quote.message}</div> : null}

            <button
              className={cx(
                'w-full rounded-2xl py-3 text-sm font-semibold',
                canPrimaryAction
                  ? 'bg-gradient-to-b from-indigo-500 to-indigo-700 hover:brightness-110'
                  : 'cursor-not-allowed bg-white/10 text-white/40',
              )}
              onClick={onPrimaryAction}
              disabled={!canPrimaryAction}
            >
              {!address
                ? 'Connect wallet'
                : !walletClient
                  ? 'Reconnect wallet'
                  : swapDisabledReason
                    ? swapDisabledReason
                    : 'Swap'}
            </button>

            {txStatus ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/80">
                <div>{txStatus}</div>
                {txHash ? (
                  <a className="mt-2 inline-block text-indigo-300 hover:text-indigo-200" href={`${explorerBaseUrl}/tx/${txHash}`} target="_blank" rel="noreferrer">
                    View on explorer
                  </a>
                ) : null}
              </div>
            ) : null}

            <div className="text-[11px] text-white/40">Router: {ROUTER_ADDRESS || '-'}</div>
          </div>
        </div>
      </div>

      <Modal open={selectSide !== null} onClose={() => setSelectSide(null)} title="Select a token">
        <div className="space-y-3">
          <div className="space-y-2">
            {commonTokens.map((it) => (
              <button
                key={it.name}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
                onClick={() => pickToken(it.token)}
              >
                <div>
                  <div className="text-sm font-semibold">{it.token.kind === 'native' ? 'ETH' : it.token.symbol}</div>
                  <div className="text-xs text-white/50">{it.subtitle || (it.token.kind === 'native' ? 'Native token' : it.token.address)}</div>
                </div>
                <div className="text-xs text-white/60">Select</div>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-xs text-white/60">Custom token address</div>
            <input
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
              placeholder="0x..."
              value={customAddressText}
              onChange={(e) => setCustomAddressText(e.target.value.trim())}
            />
            {customError ? <div className="mt-2 text-xs text-rose-300">{customError}</div> : null}
            <button
              className="mt-3 w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/15"
              type="button"
              onClick={onPickCustom}
            >
              Use custom token
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Swap settings">
        <div className="space-y-3">
          <div className="text-xs text-white/60">Slippage tolerance</div>
          <div className="flex items-center gap-2">
            <input
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
              value={bpsToPct(slippageBps)}
              onChange={(e) => setSlippageBps(pctToBps(e.target.value))}
              inputMode="decimal"
            />
            <div className="text-sm text-white/70">%</div>
          </div>
          <div className="text-xs text-white/50">Default: {(DEFAULT_SLIPPAGE_BPS / 100).toFixed(2)}%</div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
            Deadline: {Math.floor(DEADLINE_SECONDS / 60)} min
          </div>
        </div>
      </Modal>

      <Modal open={approvalsOpen} onClose={() => setApprovalsOpen(false)} title="Revoke approvals">
        {!address ? (
          <div className="text-sm text-white/70">Connect wallet dulu.</div>
        ) : !routerOk ? (
          <div className="text-sm text-white/70">Router belum diset (`VITE_ROUTER_ADDRESS`).</div>
        ) : trackedTokens.length === 0 ? (
          <div className="text-sm text-white/70">Belum ada token yang ter-scan.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-white/50">Auto scan mengambil token ERC20 yang pernah kamu approve / input di app ini (tersimpan di browser).</div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Manual revoke (token address)</div>
              <div className="mt-2 flex gap-2">
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                  placeholder="0x..."
                  value={manualRevokeAddressText}
                  onChange={(e) => setManualRevokeAddressText(e.target.value.trim())}
                />
                <button
                  className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-60"
                  disabled={!isAddress(manualRevokeAddressText)}
                  onClick={() => void revokeToken(manualRevokeAddressText as Address)}
                >
                  Revoke
                </button>
              </div>
            </div>

            {revokeError ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{revokeError}</div> : null}
            {trackedTokens.map((t) => {
              const key = t.toLowerCase()
              const meta = tokenMeta[key]
              const allowance = allowances[key] ?? 0n
              const pretty = meta ? formatCompact(allowance, meta.decimals) : allowance.toString()
              return (
                <div key={key} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{meta?.symbol || 'ERC20'}</div>
                    <div className="truncate text-xs text-white/50">{t}</div>
                    <div className="mt-1 text-xs text-white/70">Allowance: {pretty}</div>
                  </div>
                  <button
                    className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-60"
                    onClick={() => void revokeToken(t)}
                  >
                    Revoke
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Swap history">
        {!address ? (
          <div className="text-sm text-white/70">Connect wallet dulu.</div>
        ) : history.length === 0 ? (
          <div className="text-sm text-white/70">Belum ada riwayat swap.</div>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={`${h.txHash}-${h.ts}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {h.amountInText} {h.fromSymbol} → {h.amountOutText ? Number(h.amountOutText).toLocaleString(undefined, { maximumFractionDigits: 6 }) : ''} {h.toSymbol}
                  </div>
                  <a
                    className="text-xs text-indigo-300 hover:text-indigo-200"
                    href={`${explorerBaseUrl}/tx/${h.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Explorer
                  </a>
                </div>
                <div className="mt-1 text-xs text-white/50">{new Date(h.ts).toLocaleString()}</div>
                <div className="mt-1 truncate text-[11px] text-white/40">{h.txHash}</div>
              </div>
            ))}
            <button
              className="w-full rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/15"
              onClick={() => {
                setHistory([])
                saveHistory(address, [])
              }}
              type="button"
            >
              Clear history
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
