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
  signCertificate,
  unsafeGetAbiFromGitHubRepoByCodeHash,
  PinkContractPromise,
  PinkContractQuery,
  type CertificateData,
} from '@phala/sdk'
import { ApiPromise } from '@polkadot/api'
import { Abi } from '@polkadot/api-contract'
import { waitReady } from '@polkadot/wasm-crypto'
import { Keyring } from '@polkadot/keyring'
import { type KeyringPair } from '@polkadot/keyring/types'
import type { Result, Vec, u64, u8, Text, Struct } from '@polkadot/types'
import type { AccountId } from '@polkadot/types/interfaces'

import {
  MAX_BUILD_SIZE,
  runWebpack,
} from '../lib/runWebpack'
import { formatWebpackMessages } from '../lib/formatWebpackMessages'
import BaseCommand from '../lib/BaseCommand'

export interface ParsedFlags {
  readonly build: boolean
  readonly webpack: string
  readonly endpoint: string
  readonly mode: string
  readonly brickProfileFactory: string
  readonly rpc: string
  readonly consumerAddress: string
  readonly suri: string
  readonly accountFilePath: string
  readonly accountPassword: string
  readonly coreSettings: string
  readonly pruntimeUrl: string
  readonly externalAccountId: string
}

interface ParsedArgs {
  readonly script: string
}

export interface ExternalAccountCodec extends Struct {
  id: u64
  address: Vec<u8>
  rpc: Text
}

export type BrickProfileContract = PinkContractPromise<
  {
    getAllEvmAccounts: PinkContractQuery<
      [],
      Result<Vec<ExternalAccountCodec>, any>
    >
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
      exclusive: ['suri'],
    }),
    accountPassword: Flags.string({
      char: 'p',
      required: false,
      description: 'Polkadot account password',
      exclusive: ['suri'],
    }),
    suri: Flags.string({
      required: false,
      description: 'Substrate uri',
      exclusive: ['accountFilePath'],
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
      description: 'Brick profile factory contract address',
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
    return endpoint
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

  async getBrickProfileContractId({
    endpoint,
    registry,
    apiPromise,
    pair,
    cert,
  }: {
    endpoint: string
    registry: OnChainRegistry
    apiPromise: ApiPromise
    pair: KeyringPair
    cert: CertificateData
  }) {
    const brickProfileFactoryContractId = await this.getBrickProfileFactoryContractId(endpoint)
    const brickProfileFactoryAbi = await this.loadAbiByContractId(
      registry,
      brickProfileFactoryContractId
    )
    const brickProfileFactoryContractKey = await registry.getContractKeyOrFail(
      brickProfileFactoryContractId
    )
    const brickProfileFactory = new PinkContractPromise(
      apiPromise,
      registry,
      brickProfileFactoryAbi,
      brickProfileFactoryContractId,
      brickProfileFactoryContractKey
    )
    const { output: brickProfileAddressQuery } =
      await brickProfileFactory.query.getUserProfileAddress<Result<AccountId, any>>(pair.address, { cert })

    if (!brickProfileAddressQuery.isOk || !brickProfileAddressQuery.asOk.isOk) {
      this.error('You need create Brick Profile before continue.')
    }

    const brickProfileContractId = brickProfileAddressQuery.asOk.asOk.toHex()
    return brickProfileContractId
  }

  async connect({
    endpoint,
    pair,
  }: {
    endpoint: string
    pair: KeyringPair
  }): Promise<[ApiPromise, OnChainRegistry, CertificateData]> {
    this.action.start(`Connecting to the endpoint: ${endpoint}`)
    const registry = await getClient({
      transport: endpoint,
      pruntimeURL: this.parsedFlags.pruntimeUrl,
    })
    const cert = await signCertificate({ pair })
    this.action.succeed(`Connected to the endpoint: ${endpoint}`)
    const type = await registry.api.rpc.system.chainType()
    if (type.isDevelopment || type.isLocal) {
      this.log(chalk.yellow(`\nYou are connecting to a testnet.\n`))
    }
    return [registry.api, registry, cert]
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
    cert,
  }: {
    contract: BrickProfileContract,
    cert: CertificateData,
  }) {
    if (this.parsedFlags.externalAccountId) {
      return this.parsedFlags.externalAccountId
    }
    try {
      this.action.start('Querying your external accounts')
      const { output } = await contract.query.getAllEvmAccounts(cert.address, {
        cert,
      })

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
      this.action.stop()
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
    message = 'Please enter your client RPC URL'
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
    message = 'Please enter the brick profile factory contract ID'
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

}
