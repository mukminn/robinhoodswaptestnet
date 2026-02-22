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

function pickAddr(keys: string[]) {
  for (const k of keys) {
    const v = process.env[k]
    if (v && v.trim()) return v.trim()
  }
  return ''
}

async function tryVerify(
  name: string,
  address: string,
  constructorArguments: any[] = [],
  contract?: string,
) {
  if (!address) {
    console.log(`[skip] ${name}: address empty`)
    return
  }

  console.log(`\n[verify] ${name}: ${address}`)
  try {
    await hre.run('verify:verify', {
      address,
      constructorArguments,
      contract,
    })
    console.log(`[ok] ${name}`)
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e)
    if (msg.toLowerCase().includes('already verified')) {
      console.log(`[ok] ${name}: already verified`)
      return
    }
    console.log(`[err] ${name}: ${msg}`)
  }
}

async function main() {
  const { ethers } = hre

  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    throw new Error('PRIVATE_KEY env is required (used to derive Factory feeToSetter for verification)')
  }

  const deployer = new ethers.Wallet(pk)
  const deployerAddr = await deployer.getAddress()

  const weth = pickAddr(['WETH_ADDRESS', 'VITE_WETH_ADDRESS'])
  const factory = pickAddr(['FACTORY_ADDRESS', 'VITE_FACTORY_ADDRESS'])
  const router = pickAddr(['ROUTER_ADDRESS', 'VITE_ROUTER_ADDRESS'])
  const token = pickAddr(['DEFAULT_TOKEN_ADDRESS', 'TOKEN_ADDRESS', 'VITE_DEFAULT_TOKEN_ADDRESS'])

  // WETH9: no constructor args
  await tryVerify('WETH9', weth, [])

  // UniswapV2Factory(address feeToSetter)
  await tryVerify('UniswapV2Factory', factory, [deployerAddr])

  // UniswapV2Router02(address factory, address WETH)
  await tryVerify('UniswapV2Router02', router, [factory, weth])

  // TestToken(string name, string symbol, uint8 decimals)
  await tryVerify('TestToken', token, ['Test Token', 'TST', 18])

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
