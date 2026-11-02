# Tests

`CoffeeTrace.test.js` checks the full farm-to-customer journey and each safety rule:
role restrictions, next-role-only transfers, one-step status changes, blocked ERC-721
transfers, single certification, sensor input checks, and interface support.

```bash
npx hardhat test                    # run all tests
REPORT_GAS=true npx hardhat test    # also print gas used per function
```
