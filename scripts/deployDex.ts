import hre from 'hardhat'
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

const { ethers } = hre

const envPathPrimary = path.join(process.cwd(), 'i.env', '.env')
const envPathFallback = path.join(process.cwd(), 'i.env', 'a.env')

if (fs.existsSync(envPathPrimary)) {
  dotenv.config({ path: envPathPrimary })
} else if (fs.existsSync(envPathFallback)) {
  dotenv.config({ path: envPathFallback })
} else {
  dotenv.config()
}

async function main() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY env is required')

  const deployer = new ethers.Wallet(pk, ethers.provider)

  const WETH9 = await ethers.getContractFactory('WETH9', deployer)
  const weth = await WETH9.deploy()
  await weth.waitForDeployment()

  const UniswapV2Factory = await ethers.getContractFactory('UniswapV2Factory', deployer)
  const factory = await UniswapV2Factory.deploy(await deployer.getAddress())
  await factory.waitForDeployment()

  const UniswapV2Router02 = await ethers.getContractFactory('UniswapV2Router02', deployer)
  const router = await UniswapV2Router02.deploy(await factory.getAddress(), await weth.getAddress())
  await router.waitForDeployment()

  console.log('Deployer:', await deployer.getAddress())
  console.log('WETH9:', await weth.getAddress())
  console.log('Factory:', await factory.getAddress())
  console.log('Router:', await router.getAddress())
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
