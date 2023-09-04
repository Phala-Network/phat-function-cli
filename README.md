# @phala/fn

## Getting Started
```shell
# Starting a new project from a template
npx @phala/fn init <your project name>

# Install dependencies
cd <your project name>
yarn install

# Compile JS code
npx @phala/fn build src/index.ts

# Test your JS code
npx @phala/fn run dist/index.js

# Start a local node
yarn run node

# Deploy a contract and get the contract address
yarn run test-deploy

# Start a watching server
npx @phala/fn watch <your deployed contract address> artifacts/contracts/TestLensOracle.sol/TestLensOracle.json dist/index.js

# Push a request
CONTRACT_ADDRESS=<your deployed contract address> yarn run test-push-request
```
