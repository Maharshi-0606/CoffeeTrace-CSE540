# Scripts

| Script | Status | What it does |
|---|---|---|
| `deploy.js` | Ready | Deploys CoffeeTrace and prints its address and the role IDs to grant |
| `iot-oracle.js` | Planned (Interim Demo) | Simulated IoT sensor that sends temperature/humidity readings with the `ORACLE_ROLE` account |

```bash
npx hardhat run scripts/deploy.js --network localhost   # after `npx hardhat node`
npx hardhat run scripts/deploy.js --network amoy        # after filling in .env
```
