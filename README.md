# @phala/fn

## Getting Started
```shell
# Starting a new project from a template
npx @phala/fn init NAME

# Install dependencies
yarn install

# Compile JS code
npx @phala/fn build

# Test your JS code
npx @phala/fn run dist/index.js

# Start a local node
yarn run node

# Deploy a contract and get the contract address
yarn run test-deploy

# Start a watching server
$px @phala/fn watch CONTRACT_ADDRESS artifacts/contracts/TestLensOracle.sol/TestLensOracle.json dist/index.js

# Push a request
CONTRACT_ADDRESS=XXX yarn run test-push-request
```
