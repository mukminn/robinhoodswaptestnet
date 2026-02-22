require('@nomicfoundation/hardhat-toolbox')
const fs = require('node:fs')
const dotenv = require('dotenv')

const envPathPrimary = 'i.env/.env'
const envPathFallback = 'i.env/a.env'

if (fs.existsSync(envPathPrimary)) {
  dotenv.config({ path: envPathPrimary })
} else if (fs.existsSync(envPathFallback)) {
  dotenv.config({ path: envPathFallback })
} else {
  dotenv.config()
}

const PRIVATE_KEY = process.env.PRIVATE_KEY || ''
const BLOCKSCOUT_API_KEY = process.env.BLOCKSCOUT_API_KEY || process.env.ETHERSCAN_API_KEY || ''

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  etherscan: {
    // Blockscout also uses the Etherscan-compatible API.
    apiKey: {
      robinhood: BLOCKSCOUT_API_KEY,
    },
    customChains: [
      {
        network: 'robinhood',
        chainId: 46630,
        urls: {
          apiURL: 'https://explorer.testnet.chain.robinhood.com/api',
          browserURL: 'https://explorer.testnet.chain.robinhood.com',
        },
      },
    ],
  },
  networks: {
    robinhood: {
      url: 'https://rpc.testnet.chain.robinhood.com',
      chainId: 46630,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
}
