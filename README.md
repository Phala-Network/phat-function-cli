# @phala/fn
Phat Function CLI toolkit

## Requirements

Node.js >= 18

## Install

Depending on how you manage your projects you can:

1. Add `@phala/fn` to your project dependencies (`yarn` / `npm`):

```shell
yarn add -D @phala/fn

yarn phat-fn --help
```

2. Install it globally and use `npx` to call it:

```shell
npm install -g @phala/fn

npx @phala/fn --help
```

## Commands

### Global flags
```shell
--help                      # Prints the help for the command
```

### Commands index
* [`phat-fn init`](#phat-fn-init)
* [`phat-fn build`](#phat-fn-build)
* [`phat-fn run`](#phat-fn-run)
* [`phat-fn upload`](#phat-fn-upload)
* [`phat-fn update`](#phat-fn-update)
* [`phat-fn watch`](#phat-fn-update)

## `phat-fn init`

Create a new project from template

```shell
USAGE
  $ phat-fn init NAME [-t <value>] [-d <value>] [-r]

FLAGS
  -d, --dir=<value>       The target location for the project. If omitted, a new folder NAME is created.
  -r, --remove            Clean up the target directory if it exists
  -t, --template=<value>  Choose one of the templates:
                          - phat-contract-starter-kit The Phat Contract Starter Kit
                          - lensapi-oracle-consumer-contract Polygon Consumer Contract for LensAPI Oracle
```

## `phat-fn build`

Build a production bundle of the function script

```
USAGE
  $ phat-fn build [SCRIPT] [-d <value>] [-o <value>] [-w <value>] [--mode production|prod|development|dev]

ARGUMENTS
  SCRIPT  [default: src/index] The function script file

FLAGS
  -d, --location=<value>  Location directory
  -o, --output=<value>    Output directory
  -w, --webpack=<value>   Custom webpack config
  --mode=<option>         [default: production]
                          <options: production|prod|development|dev>
```

## `phat-fn run`

Run the script in PhatJS runtime

```
USAGE
  $ phat-fn run SCRIPT [--json] [-a <value>]

ARGUMENTS
  SCRIPT  The location of the JS file

FLAGS
  -a, --scriptArgs=<value>...  Script arguments

GLOBAL FLAGS
  --json  Format output as json.
```

## `phat-fn upload`

Upload JS to Phat Contract

```
USAGE
  $ phat-fn upload [SCRIPT] [-e <value>] [-a <value> | --suri <value>] [-p <value> | ] [--endpoint <value>] [--rpc <value>]
    [--brickProfileFactory <value>] [--consumerAddress <value>] [--coreSettings <value>] [--mode production|prod|development|dev] [-b]

ARGUMENTS
  SCRIPT  [default: src/index] The function script file

FLAGS
  -a, --accountFilePath=<value>  Path to polkadot account JSON file
  -b, --build
  -e, --envFilePath=<value>      Path to env file
  -p, --accountPassword=<value>  Polkadot account password
  --brickProfileFactory=<value>  Brick profile factory contract address
  --consumerAddress=<value>      Consumer contract address
  --coreSettings=<value>         Core settings
  --endpoint=<value>             Phala Blockchain RPC endpoint
  --mode=<option>                [default: development]
                                 <options: production|prod|development|dev>
  --rpc=<value>                  Client RPC URL
  --suri=<value>                 Substrate uri
```

## `phat-fn update`

```
USAGE
  $ phat-fn update [SCRIPT] [-e <value>] [-a <value> | --suri <value>] [-p <value> | ] [--endpoint <value>] [--brickProfileFactory <value>]
    [--workflowId <value>] [--mode production|prod|development|dev] [-b]

ARGUMENTS
  SCRIPT  [default: src/index] The function script file

FLAGS
  -a, --accountFilePath=<value>  Path to account account JSON file
  -b, --build
  -e, --envFilePath=<value>      Path to env file
  -p, --accountPassword=<value>  Polkadot account password
  --brickProfileFactory=<value>  Brick profile factory contract address
  --endpoint=<value>             Phala Blockchain RPC endpoint
  --mode=<option>                [default: development]
                                 <options: production|prod|development|dev>
  --suri=<value>                 Substrate uri
  --workflowId=<value>           Workflow ID

```

## `phat-fn watch`

Watch contract events and run Phat Function

```
USAGE
  $ @phala/fn watch ADDRESS CONTRACT JS [--rpc <value>] [-a <value>] [--once]

ARGUMENTS
  ADDRESS   The contract address
  CONTRACT  The location of the contract JSON file
  JS        The location of the JS file

FLAGS
  -a, --scriptArgs=<value>...  [default: ] Script arguments
  --once                       Process events once only
  --rpc=<value>                RPC endpoint
```


## Getting Started

### Quick Start

Create a new project With NPX:

```shell
npx @phala/fn init my-phat-function
```

Then follow the prompts.

You can also directly specify the template you want to use via additional command line options.
For example, to scaffold a project from `phat-contract-starter-kit` template, run:

```shell
npx @phala/fn init my-phat-function -t phat-contract-starter-kit
```

## Building your first Phat Function script

### Installing dependencies

```shell
cd my-phat-function
yarn install
# or
npm install
```

### Building the script

```shell
npx @phala/fn build src/index.ts
```

### Testing the build script

```shell
npx @phala/fn run dist/index.js
```

Also, your can specify the script input parameters via `-a` flag:

```shell
npx @phala/fn run dist/index.js -a foo -a bar
```

## Uploading the script to the Phat Contract

### Prerequisites
- Active Phala Profile with version `>= 1.0.1` via [Phat Contract 2.0 UI](https://bricks.phala.network)
- RPC Endpoint for EVM Chain Mainnet & EVM Chain Testnet
  - [Alchemy](https://alchemy.com) - This repo example uses Alchemy's API Key.
  - [Infura](https://infura.io)
  - Personal RPC Node (Ex. [ProjectPi](https://hub.projectpi.xyz/))


### Create a Phala Profile
This step requires you to have a Polkadot account. You can get an account from one of the following:
- [Polkadot.js Wallet Extension](https://polkadot.js.org/extension/)
- [Talisman Wallet](https://www.talisman.xyz/)
- [SubWallet](https://www.subwallet.app/) (**Support for iOS/Android**)

Then, create your Phala Profile account on the [Phala Testnet](https://bricks.phala.network) or [Phala Mainnet](https://bricks.phala.network). Here is a quick 1 minute [YouTube video](https://youtu.be/z1MR48NYtYc) on setting up from scratch.

### Option 1: Upload the script via exported Polkadot account file

Go to your browser and click on the polkadot.js extension. Select your account and click "Export Account".

Next, you will be prompted for your password before saving the file to your project directory as `polkadot-account.json` .

Run the upload command:

```shell
npx @phala/fn upload -a polkadot-account.json
```

Then follow the prompts.

### Option 2: Upload the script via mnemonic phrase

You can also upload the script via your Polkadot account mnemonic phrase.

```shell
npx @phala/fn upload --suri="raven valley laugh wait grid typical deny output discover situate bleak scare"
```

### Option 3: Upload the script via environment variables

You can create a `.env` file in your project directory and define `POLKADOT_WALLET_SURI="this is a mnemonic phrase"`.

Then run the `upload` command and follow the prompts:

```shell
npx @phala/fn upload
```

## Updating your Phat Contract script

The `update` command is similar to the `upload` command. You can both update your script via account file or mnemonic phrase.

```shell
npx @phala/fn update -a polkadot-account.json

# or

npx @phala/fn update --suri="raven valley laugh wait grid typical deny output discover situate bleak scare"
```

## Advance Usage

### Testing the Phat Contract script via `watch` command

You can start a watching server via `watch` command, to watch the requests that are pushed and see how the Phat Contract transforms the data.

```shell
npx @phala/fn watch <Your Contract Address> <Your Contract JSON File> dist/index.js --rpc=<Your RPC Endpoint>
```

<details>
  <summary>Example output</summary>

    npx @phala/fn watch 0x0165878A594ca255338adfa4d48449f69242Eb8F artifacts/contracts/TestLensApiConsumerContract.sol.sol/TestLensApiConsumerContract.sol.json dist/index.js --rpc="http://127.0.0.1:8545/"

    Listening for TestLensApiConsumerContract MessageQueued events...
    Received event [MessageQueued]: {
      tail: 0n,
      data: '0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000043078303100000000000000000000000000000000000000000000000000000000'
    }
    handle req: 0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000043078303100000000000000000000000000000000000000000000000000000000
    Request received for profile 0x01
    response: 0,1,1597
    JS Execution output: 0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000063d

</details>

## Phat Function Script Examples

- [HTTP Request](examples/http-request/index.ts)
- [Batch HTTP Request](examples/batch-http-request/index.ts)
- [VIEM ABI Codec](examples/viem-abi-codec/index.ts)
- [SCALE Codec](examples/scale-codec/index.ts)
- [Call pink.invokeContract](examples/scale-codec/index.ts)
- [Chainlink compatible VRF](examples/randomness-fullfillrandomwords)
- [Randrange](examples/randomness-randrange)
