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
  const [deployer] = await ethers.getSigners()

  const routerAddress = process.env.ROUTER_ADDRESS
  if (!routerAddress) throw new Error('ROUTER_ADDRESS env is required')

  const TestToken = await ethers.getContractFactory('TestToken')
  const token = await TestToken.deploy('Test Token', 'TST', 18)
  await token.waitForDeployment()

  const mintAmount = ethers.parseUnits('1000000', 18)
  await (await token.mint(await deployer.getAddress(), mintAmount)).wait()

  const router = await ethers.getContractAt('UniswapV2Router02', routerAddress)

  const approveAmount = ethers.MaxUint256
  await (await token.approve(routerAddress, approveAmount)).wait()

  const tokenAmount = ethers.parseUnits('100000', 18)
  const ethAmount = ethers.parseEther(process.env.SEED_ETH || '0.001')

  const tx = await router.addLiquidityETH(token.getAddress(), tokenAmount, await deployer.getAddress(), {
    value: ethAmount,
  })
  await tx.wait()

  console.log('Deployer:', await deployer.getAddress())
  console.log('Token:', await token.getAddress())
  console.log('Router:', routerAddress)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
