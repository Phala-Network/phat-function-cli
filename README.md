# @phala/fn

## Getting Started
```shell
# Starting a new project from a template
# Choose template `lensapi-oracle-consumer-contract`
npx @phala/fn init <your project name>

# Install dependencies
cd <your project name>
yarn install

# Compile JS code
npx @phala/fn build src/index.ts

# Test your JS code
npx @phala/fn run dist/index.js
# Test your JS code with multiple arguments
npx @phala/fn run dist/index.js -a 1 2 3

# Start a local hardhat node
yarn hardhat node

# Run the e2e test
yarn hardhat test --network localhost

# Deploy and get the contract address
yarn localhost-deploy

# Start a watching server
yarn localhost-watch <your deployed contract address> artifacts/contracts/TestLensApiConsumerContract.sol/TestLensApiConsumerContract.json dist/index.js -a https://api-mumbai.lens.dev/

# Push a request
LOCALHOST_CONSUMER_CONTRACT_ADDRESS=<your deployed contract address> yarn localhost-push-request
```
