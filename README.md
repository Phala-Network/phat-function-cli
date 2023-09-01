# phala-sls

## Getting Started
```shell
# Starting a new project from a template
npx phala-sls init NAME

# Install dependencies
yarn install

# Compile JS code
npx phala-sls build

# Test your JS code
npx phala-sls run dist/index.js

# Start a local node
yarn run node

# Deploy a contract and get the contract address
yarn run test-deploy

# Start a watching server
npx phala-sls watch CONTRACT_ADDRESS artifacts/contracts/TestLensOracle.sol/TestLensOracle.json dist/index.js

# Push a request
CONTRACT_ADDRESS=XXX yarn run test-push-request
```
