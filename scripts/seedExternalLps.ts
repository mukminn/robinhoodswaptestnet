import hre from 'hardhat'
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

const envPathPrimary = path.join(process.cwd(), 'i.env', '.env')
const envPathFallback = path.join(process.cwd(), 'i.env', 'a.env')

if (fs.existsSync(envPathPrimary)) {
  dotenv.config({ path: envPathPrimary })
} else if (fs.existsSync(envPathFallback)) {
  dotenv.config({ path: envPathFallback })
} else {
  dotenv.config()
}

const TOKENS = [
  '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
  '0x71178BAc73cBeb415514eB542a8995b82669778d',
  '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
  '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
  '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0',
] as const

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
] as const

async function main() {
  const { ethers } = hre

  const routerAddress = process.env.ROUTER_ADDRESS
  if (!routerAddress) throw new Error('ROUTER_ADDRESS env is required')

  const ethPerToken = process.env.LP_ETH_PER_TOKEN || '0.0001'
  const skipIfNoBalance = String(process.env.LP_SKIP_IF_NO_BALANCE || '').toLowerCase() === 'true'

  const [deployer] = await ethers.getSigners()
  const deployerAddr = await deployer.getAddress()

  const router = await ethers.getContractAt('UniswapV2Router02', routerAddress)

  console.log('Deployer:', deployerAddr)
  console.log('Router:', routerAddress)
  console.log('LP per token: 1 token +', ethPerToken, 'ETH')
  console.log('Skip if no balance:', skipIfNoBalance)

  for (const tokenAddr of TOKENS) {
    console.log('\n[token]', tokenAddr)

    const token = new ethers.Contract(tokenAddr, ERC20_ABI, deployer)

    let symbol = 'ERC20'
    let decimals = 18
    try {
      symbol = await token.symbol()
    } catch {
      // ignore
    }
    try {
      decimals = Number(await token.decimals())
    } catch {
      // ignore
    }

    const tokenAmount = 1n * 10n ** BigInt(decimals)
    const ethAmount = ethers.parseEther(ethPerToken)

    const bal: bigint = await token.balanceOf(deployerAddr)
    console.log('Symbol:', symbol)
    console.log('Decimals:', decimals)
    console.log('Balance:', ethers.formatUnits(bal, decimals), symbol)

    if (bal < tokenAmount) {
      const msg = `Not enough ${symbol} balance to add LP (need 1 ${symbol}).` 
      if (skipIfNoBalance) {
        console.log('[skip]', msg)
        continue
      }
      throw new Error(msg)
    }

    const allowance: bigint = await token.allowance(deployerAddr, routerAddress)
    if (allowance < tokenAmount) {
      console.log('Approving router...')
      await (await token.approve(routerAddress, ethers.MaxUint256)).wait()
    }

    console.log('Adding liquidity...')
    const tx = await router.addLiquidityETH(tokenAddr, tokenAmount, deployerAddr, { value: ethAmount })
    const receipt = await tx.wait()

    console.log('LP added:', receipt?.hash || '')
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
