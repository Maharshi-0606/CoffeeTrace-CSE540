// Deploys CoffeeTrace and prints the contract address and role IDs.
//
//   Local:  npx hardhat node                                  (terminal 1)
//           npx hardhat run scripts/deploy.js --network localhost   (terminal 2)
//   Amoy:   npx hardhat run scripts/deploy.js --network amoy   (needs .env, see .env.example)
//
// The deploying account becomes the admin (DEFAULT_ADMIN_ROLE) and can grant the
// other roles with grantRole(roleId, address).
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const coffee = await ethers.deployContract("CoffeeTrace");
  await coffee.waitForDeployment();
  console.log(`\nCoffeeTrace deployed to: ${await coffee.getAddress()}\n`);

  // Role IDs to paste into grantRole (in Remix, the UI or a script)
  const roles = ["FARMER_ROLE", "EXPORTER_ROLE", "ROASTER_ROLE", "RETAILER_ROLE", "CERTIFIER_ROLE", "ORACLE_ROLE"];
  for (const role of roles) {
    console.log(`${role.padEnd(15)} ${await coffee[role]()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
