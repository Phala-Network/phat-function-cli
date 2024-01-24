import fs from 'node:fs'
import upath from 'upath'
import inquirer from 'inquirer'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { filesize } from 'filesize'
import { Args, Flags } from '@oclif/core'
import {
  getClient,
  OnChainRegistry,
  unsafeGetAbiFromGitHubRepoByCodeHash,
  PinkContractPromise,
  PinkContractQuery,
  EvmAccountMappingProvider,
  KeyringPairProvider,
  getContract,
  type PinkContractTx,
  type LiteralRpc,
  type AnyProvider
} from '@phala/sdk'
import { ApiPromise } from '@polkadot/api'
import { Abi } from '@polkadot/api-contract'
import { waitReady } from '@polkadot/wasm-crypto'
import { Keyring } from '@polkadot/keyring'
import { type KeyringPair } from '@polkadot/keyring/types'
import type { Result, Vec, u64, u8, Text, Bool, Struct } from '@polkadot/types'
import type { AccountId, ChainType, Hash } from '@polkadot/types/interfaces'
import { createPublicClient, createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts'

import {
  MAX_BUILD_SIZE,
  runWebpack,
} from '../lib/runWebpack'
import { formatWebpackMessages } from '../lib/formatWebpackMessages'
import BaseCommand from '../lib/BaseCommand'
import { add0xPrefix } from '../lib/utils'

export interface ParsedFlags {
  readonly build: boolean
  readonly webpack: string
  readonly endpoint: string
  readonly mode: string
  readonly brickProfileFactory: string
  readonly rpc: string
  readonly consumerAddress: string
  suri: string
  readonly accountFilePath: string
  readonly accountPassword: string
  privateKey: string
  readonly mnemonic: string
  readonly addressIndex: number
  readonly coreSettings: string
  readonly pruntimeUrl: string
  readonly externalAccountId: string
  readonly jsRunner: string
}

interface ParsedArgs {
  readonly script: string
}

export interface ExternalAccountCodec extends Struct {
  id: u64
  address: Vec<u8>
  rpc: Text
}

export interface WorkflowCodec extends Struct {
  id: u64
  name: Text
  enabled: Bool
  commandline: Text
}

export type BrickProfileFactoryContract = PinkContractPromise<
  {
    version: PinkContractQuery<[], u64[]>
    owner: PinkContractQuery<[], AccountId>
    userCount: PinkContractQuery<[], u64>
    profileCodeHash: PinkContractQuery<[], Hash>
    getUserProfileAddress: PinkContractQuery<[], Result<AccountId, any>>
  },
  {
    setProfileCodeHash: PinkContractTx<[string]>
    createUserProfile: PinkContractTx<[]>
  }
>

export type BrickProfileContract = PinkContractPromise<
  {
    getJsRunner: PinkContractQuery<[], Result<AccountId, any>>
    getAllEvmAccounts: PinkContractQuery<
      [],
      Result<Vec<ExternalAccountCodec>, any>
    >
    getWorkflow: PinkContractQuery<[number | u64], Result<WorkflowCodec, any>>
    workflowCount: PinkContractQuery<[], u64>
    externalAccountCount: PinkContractQuery<[], u64>
    getEvmAccountAddress: PinkContractQuery<
      [number | u64],
      Result<AccountId, any>
    >
  },
  {
    config: PinkContractTx<[string | AccountId]>
    generateEvmAccount: PinkContractTx<[string | Text]>
    addWorkflowAndAuthorize: PinkContractTx<
      [string | Text, string | Text, number | u64]
    >
  }
>

export type ActionOffChainRollupContract = PinkContractPromise<
  {
    getAttestAddress: PinkContractQuery<[], Vec<u8>, any>
  },
  {
    configCoreScript: PinkContractTx<[string]>
  }
>

export default abstract class PhatBaseCommand extends BaseCommand {
  static args = {
    script: Args.string({
      description: 'The function script file',
      require: true,
      default: 'src/index',
    }),
  }

  static flags = {
    envFilePath: Flags.string({
      char: 'e',
      description: 'Path to env file',
      required: false,
    }),
    accountFilePath: Flags.string({
      char: 'a',
      required: false,
      description: 'Path to polkadot account JSON file',
      exclusive: ['suri', 'privateKey', 'mnemonic'],
    }),
    accountPassword: Flags.string({
      char: 'p',
      required: false,
      description: 'Polkadot account password',
      exclusive: ['suri', 'privateKey', 'mnemonic'],
    }),
    suri: Flags.string({
      required: false,
      description: 'Substrate uri',
      exclusive: ['accountFilePath', 'privateKey', 'mnemonic'],
    }),
    privateKey: Flags.string({
      description: 'EVM account private key',
      required: false,
      exclusive: ['suri', 'accountFilePath', 'mnemonic'],
    }),
    mnemonic: Flags.string({
      description: 'EVM account mnemonic',
      required: false,
      exclusive: ['suri', 'accountFilePath', 'privateKey'],
    }),
    addressIndex: Flags.integer({
      description: 'EVM account address index',
      required: false,
      default: 0,
      exclusive: ['suri', 'accountFilePath', 'privateKey'],
    }),
    endpoint: Flags.string({
      description: 'Phala Blockchain RPC endpoint',
      required: false,
    }),
    rpc: Flags.string({
      description: 'EVM RPC URL',
      required: false,
    }),
    brickProfileFactory: Flags.string({
      description: 'Dashboard Profile factory contract id',
      required: false,
      default: '',
    }),
    consumerAddress: Flags.string({
      description: 'Consumer contract address',
      required: false,
    }),
    coreSettings: Flags.string({
      description: 'Core settings',
      required: false,
    }),
    pruntimeUrl: Flags.string({
      description: 'Pruntime URL',
      required: false,
    }),
    externalAccountId: Flags.string({
      description: 'External Account ID',
      required: false,
    }),
    mode: Flags.custom({
      options: ['production', 'prod', 'development', 'dev'],
      default: 'development',
    })(),
    build: Flags.boolean({
      char: 'b',
      default: true,
    }),
    jsRunner: Flags.string({
      description: 'JS runner contract id',
      required: false,
      default: '',
    }),
  }

  public parsedFlags!: ParsedFlags
  public parsedArgs!: ParsedArgs

  async init(): Promise<void> {
    const {
      flags,
      args,
    } = await this.parse(this.constructor as never)

    if (flags.envFilePath) {
      if (!fs.existsSync(flags.envFilePath)) {
        this.error(`Env file does not exist: ${flags.envFilePath}`)
      }
      dotenv.config({ path: upath.resolve(flags.envFilePath) })
    } else {
      dotenv.config()
    }

    this.parsedFlags = flags as never
    this.parsedArgs = args as never

    // temporary hijacking console.warn to ignore wrong printing
    // see: https://github.com/polkadot-js/api/issues/5760
    console.warn = function (...args: any[]) {
      if (args.length && args[0] === 'Unable to map [u8; 32] to a lookup index') {
        return
      }
      console.log(...args)
    }
  }

  getEndpoint() {
    const isDev = this.parsedFlags.mode === 'development' || this.parsedFlags.mode === 'dev'
    let endpoint
    if (this.parsedFlags.endpoint) {
      endpoint = this.parsedFlags.endpoint
    } else {
      endpoint = isDev
        ? 'wss://poc6.phala.network/ws'
        : 'wss://api.phala.network/ws'
    }
    return endpoint as LiteralRpc
  }

  async getBrickProfileFactoryContractId(endpoint: string) {
    let brickProfileFactoryContractId = this.parsedFlags.brickProfileFactory
    if (!brickProfileFactoryContractId) {
      if (endpoint === 'wss://poc6.phala.network/ws') {
        brickProfileFactoryContractId = '0x4a7861f257568a989a9c24db60981efb745d134a138203a219da051337428b49'
      } else if (endpoint === 'wss://api.phala.network/ws') {
        brickProfileFactoryContractId = '0xb59bcc4ea352f3d878874d8f496fb093bdf362fa59d6e577c075f41cd7c84924'
      } else {
        brickProfileFactoryContractId = await this.promptBrickProfileFactory()
      }
    }
    return brickProfileFactoryContractId
  }

  async getJsRunnerContractId(endpoint: string) {
    let jsRunnerContractId = this.parsedFlags.jsRunner
    if (!jsRunnerContractId) {
      if (endpoint === 'wss://poc6.phala.network/ws') {
        jsRunnerContractId = '0x15fd4cc6e96b1637d46bd896f586e5de7c6835d8922d9d43f3c1dd5b84883d79'
      } else if (endpoint === 'wss://api.phala.network/ws') {
        jsRunnerContractId = '0xd0b2ee3ac67b363734c5105a275b5de964ecc4a304d98c2cc49a8d417331ade2'
      } else {
        jsRunnerContractId = await this.promptJsRunner()
      }
    }
    return jsRunnerContractId
  }

  async getBrickProfileContractId({
    endpoint,
    registry,
    provider,
  }: {
    endpoint: string
    registry: OnChainRegistry
    provider: AnyProvider
  }) {
    const brickProfileFactoryContractId = await this.getBrickProfileFactoryContractId(endpoint)
    const brickProfileFactoryAbi = await this.loadAbiByContractId(
      registry,
      brickProfileFactoryContractId
    )
    const contract = await getContract<BrickProfileFactoryContract>({
      client: registry,
      contractId: brickProfileFactoryContractId,
      abi: brickProfileFactoryAbi,
      provider,
    })
    const { output } = await contract.q.getUserProfileAddress<Result<AccountId, any>>()

    if (!output.isOk || !output.asOk.isOk) {
      this.action.fail('You need to create the Dashboard Profile before continuing.\nPlease run the command: npx @phala/fn create-brick-profile')
      this.exit(1)
    }

    return output.asOk.asOk.toHex()
  }

  async connect({
    endpoint,
  }: {
    endpoint: LiteralRpc
  }): Promise<[ApiPromise, OnChainRegistry, ChainType]> {
    this.action.start(`Connecting to the endpoint: ${endpoint}`)
    const registry = await getClient({
      transport: endpoint,
      pruntimeURL: this.parsedFlags.pruntimeUrl,
    })
    const type = await registry.api.rpc.system.chainType()
    this.action.succeed(`Connected to the endpoint: ${endpoint}`)
    if (type.isDevelopment || type.isLocal) {
      this.log(chalk.yellow(`\nYou are connecting to a testnet.\n`))
    }
    return [registry.api, registry, type]
  }

  async getRollupAbi() {
    const rollupAbi = new Abi(
      await this.loadAbiByCodeHash('0x96ca5480eb52b8087b1e64cae52c75e6db037e1920320653584ef920db5d29d5')
    )
    return rollupAbi
  }

  async buildOrGetScriptPath() {
    if (!this.parsedFlags.build) {
      return upath.join(process.cwd(), 'dist', 'index.js')
    }

    const directory = process.cwd()
    try {
      this.action.start('Creating an optimized build')
      const stats = await runWebpack({
        clean: false,
        projectDir: directory,
        customWebpack: this.parsedFlags.webpack,
        buildEntries: {
          [upath.parse(this.parsedArgs.script).name]: this.parsedArgs.script,
        },
        outputDir: upath.resolve(directory, 'dist'),
        isDev: false,
      })
      const json = stats.toJson({
        all: false,
        warnings: true,
        assets: true,
        outputPath: true
      })
      const messages = formatWebpackMessages(json)

      if (messages.warnings && messages.warnings.length) {
        this.action.warn('Compiled with warnings.')
        this.log(messages.warnings.join('\n\n'))
      } else {
        this.action.succeed('Compiled successfully.')
      }

      if (!json.assets || !json.assets.length) {
        throw new Error('Build assets not found.')
      }

      const assetPath = upath.join(json.outputPath ?? '', json.assets[0].name)
      const { size } = fs.statSync(assetPath)

      if (size > MAX_BUILD_SIZE) {
        throw new Error(
          `The file size exceeds the limit of ${filesize(MAX_BUILD_SIZE, {
            base: 2,
            standard: 'jedec',
          })}.`
        )
      }

      return assetPath
    } catch (error) {
      this.action.fail('Failed to compile.')
      return this.error(error as Error)
    } finally {
      this.action.stop()
    }
  }

  async promptEvmAccountId({
    contract,
  }: {
    contract: BrickProfileContract,
  }) {
    if (this.parsedFlags.externalAccountId) {
      return this.parsedFlags.externalAccountId
    }
    try {
      this.action.start('Querying your external accounts')
      const { output } = await contract.q.getAllEvmAccounts<Result<Vec<ExternalAccountCodec>, any>>()

      if (output.isErr) {
        throw new Error(output.asErr.toString())
      }
      if (output.asOk.isErr) {
        throw new Error(output.asOk.asErr.toString())
      }
      const accounts = output.asOk.asOk.map((i) => {
        const obj = i.toJSON()
        return {
          id: obj.id,
          address: obj.address,
          rpcEndpoint: obj.rpc,
        }
      })
      if (accounts.length === 0) {
        this.action.fail('You need to add an EVM account before continuing.\nPlease run the command: npx @phala/fn add-evm-account')
        this.exit(1)
      }
      this.action.succeed()
      const { account } = await inquirer.prompt({
        name: 'account',
        message: 'Please select an external account:',
        type: 'list',
        choices: accounts.map(account => ({
          name: `[${account.id}] ${account.address}. ${chalk.dim(account.rpcEndpoint)}`,
          value: account.id,
        })),
      })
      return account
    } catch (error) {
      this.action.fail('Failed to query your external accounts.')
      return this.error(error as Error)
    }
  }

  async promptProjectName(
    defaultName: string
  ): Promise<string> {
    const { name } = await inquirer.prompt([
      {
        name: 'name',
        type: 'input',
        message: 'Please enter your project name',
        default: defaultName,
      },
    ])
    return name
  }

  async promptRpc(
    message = 'Please enter your EVM RPC URL'
  ): Promise<string> {
    const { rpc } = await inquirer.prompt([
      {
        name: 'rpc',
        type: 'input',
        message,
      },
    ])
    return rpc
  }

  async promptConsumerAddress(
    message = 'Please enter your consumer address'
  ): Promise<string> {
    const { consumerAddress } = await inquirer.prompt([
      {
        name: 'consumerAddress',
        type: 'input',
        message,
      },
    ])
    return consumerAddress
  }

  async promptBrickProfileFactory(
    message = 'Please enter the dashboard profile factory contract ID'
  ): Promise<string> {
    const { brickProfileFactory } = await inquirer.prompt([
      {
        name: 'brickProfileFactory',
        type: 'input',
        message,
      },
    ])
    return brickProfileFactory
  }

  async promptJsRunner(
    message = 'Please enter the js runner contract ID'
  ): Promise<string> {
    const { jsRunner } = await inquirer.prompt([
      {
        name: 'jsRunner',
        type: 'input',
        message,
      },
    ])
    return jsRunner
  }

  async getProvider({
    apiPromise,
  }: {
    apiPromise: ApiPromise
  }) {
    if (this.parsedFlags.privateKey || (process.env.PRIVATE_KEY && !this.parsedFlags.suri && !this.parsedFlags.accountFilePath)) {
      if (!apiPromise.consts?.evmAccountMapping?.eip712Name) {
        this.action.fail('The current connected chain does not support EVM wallets.')
        this.exit(1)
      }
      const privateKey = add0xPrefix(this.parsedFlags.privateKey || process.env.PRIVATE_KEY!)
      const account = privateKeyToAccount(privateKey)
      const client = createWalletClient({
        account,
        chain: mainnet,
        transport: http()
      })
      const provider = await EvmAccountMappingProvider.create(apiPromise, client, account)
      return provider
    }
    if (this.parsedFlags.mnemonic || (process.env.MNEMONIC && !this.parsedFlags.suri && !this.parsedFlags.accountFilePath)) {
      if (!apiPromise.consts?.evmAccountMapping?.eip712Name) {
        this.action.fail('The current connected chain does not support EVM wallets.')
        this.exit(1)
      }
      const account = mnemonicToAccount(this.parsedFlags.mnemonic || process.env.MNEMONIC!, {
        addressIndex: this.parsedFlags.addressIndex,
      })
      const client = createWalletClient({
        account,
        chain: mainnet,
        transport: http()
      })
      const provider = await EvmAccountMappingProvider.create(apiPromise, client, account)
      return provider
    }
    const pair = await this.getDecodedPair({
      suri: this.parsedFlags.suri || process.env.POLKADOT_WALLET_SURI,
      accountFilePath: this.parsedFlags.accountFilePath || process.env.POLKADOT_WALLET_ACCOUNT_FILE,
      accountPassword: this.parsedFlags.accountPassword || process.env.POLKADOT_WALLET_ACCOUNT_PASSWORD,
    })
    const provider = await KeyringPairProvider.create(apiPromise, pair)
    return provider
  }

  async getDecodedPair({ suri, accountFilePath, accountPassword }: { suri?: string, accountFilePath?: string, accountPassword?: string }): Promise<KeyringPair> {
    await waitReady()
    const keyring = new Keyring({ type: 'sr25519' })
    let pair: KeyringPair

    if (accountFilePath) {
      if (!fs.existsSync(accountFilePath)) {
        this.error(
          `Keypair account json file does not exist: ${accountFilePath}`
        )
      }

      if (upath.extname(accountFilePath) !== '.json') {
        this.error(
          `Keypair account json file is invalid: File extension should be .json: ${accountFilePath}`
        )
      }

      const exported = fs.readFileSync(
        upath.resolve(accountFilePath),
        'utf8'
      )
      pair = keyring.createFromJson(JSON.parse(exported))
    } else if (suri) {
      pair = keyring.addFromUri(suri)
    } else {
      pair = keyring.addFromUri((await this.promptForSuri()))
    }

    if (pair.isLocked) {
      pair = await this.requestPairDecoding(pair, {
        password: accountPassword,
      })
    }

    return pair
  }

  async requestPairDecoding(
    pair: KeyringPair,
    options: {
      password?: string,
      message?: string
    }
  ): Promise<KeyringPair> {
    if (!pair.isLocked) {
      return pair
    }

    // Try decoding using empty string
    try {
      pair.decodePkcs8(options.password || '')
      return pair
    } catch (e) {
      // Continue
    }

    let isPassValid = false
    while (!isPassValid) {
      try {
        const password = await this.promptForPassword(
          options.message ||
            `Please Enter ${
              pair.meta.name ? pair.meta.name : pair.address
            } account password`
        )
        pair.decodePkcs8(password)
        isPassValid = true
      } catch (e) {
        this.warn('Invalid password, try again.')
      }
    }
    return pair
  }

  async promptForPassword(
    message = `Please enter your account password`
  ): Promise<string> {
    const { password } = await inquirer.prompt([
      {
        name: 'password',
        type: 'password',
        message,
      },
    ])
    return password
  }

  async promptForSuri(
    message = `Please enter your substrate uri`
  ): Promise<string> {
    const { suri } = await inquirer.prompt([
      {
        name: 'suri',
        type: 'input',
        message,
      },
    ])
    return suri
  }

  async loadAbiByCodeHash(codeHash: string) {
    const dirPath = upath.join(
      process.cwd(),
      '.phat',
      'abis',
    )
    const abiPath = upath.join(
      dirPath,
      `${codeHash}.json`
    )
    if (fs.existsSync(abiPath)) {
      return fs.readFileSync(abiPath, 'utf8')
    }
    const codeHashWithPrefix =
      codeHash && codeHash.indexOf('0x') !== 0 ? `0x${codeHash}` : codeHash
    const abi = await unsafeGetAbiFromGitHubRepoByCodeHash(codeHashWithPrefix)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    fs.writeFileSync(abiPath, JSON.stringify(abi))
    return abi
  }

  async loadAbiByContractId(registry: OnChainRegistry, contractId: string) {
    const contractInfo = await registry.phactory.getContractInfo({
      contracts: [contractId],
    })
    if (!contractInfo.contracts.length || !contractInfo.contracts[0].codeHash) {
      this.error(`Contract code hash not found: Contract ID: ${contractId}`)
    }
    const codeHash = contractInfo.contracts[0].codeHash
    const codeHashWithPrefix =
      codeHash && codeHash.indexOf('0x') !== 0 ? `0x${codeHash}` : codeHash
    const abi = await this.loadAbiByCodeHash(codeHashWithPrefix)
    return abi
  }

  async verifyRpcEndpoint(endpoint: string) {
    try {
      this.action.start(`Verifying the RPC endpoint: ${endpoint}`)
      const client = createPublicClient({
        transport: http(endpoint)
      })
      await client.getChainId()
      this.action.succeed()
    } catch (error) {
      this.action.fail('Failed to verify the RPC endpoint.')
      return this.error(error as Error)
    }
  }

}
