// Hardhat configuration for compiling, testing and deploying CoffeeTrace.
// Remix also works (see README); Hardhat is used for automated tests and scripted deploys.
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config(); // reads AMOY_RPC_URL and PRIVATE_KEY from .env (never commit .env)

const { AMOY_RPC_URL, PRIVATE_KEY } = process.env;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun", // required by OpenZeppelin 5.x
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Polygon Amoy testnet (chain ID 80002). Only enabled when .env is filled in.
    ...(AMOY_RPC_URL && PRIVATE_KEY
      ? { amoy: { url: AMOY_RPC_URL, accounts: [PRIVATE_KEY], chainId: 80002 } }
      : {}),
  },
  // Gas cost per function, used later for the gas analysis: REPORT_GAS=true npx hardhat test
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};
