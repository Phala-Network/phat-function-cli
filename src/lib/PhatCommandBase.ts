import fs from 'node:fs'
import upath from 'upath'
import inquirer from 'inquirer'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { filesize } from 'filesize'
import { Command, Args, Flags, ux } from '@oclif/core'
import {
  getClient,
  OnChainRegistry,
  signCertificate,
  unsafeGetAbiFromGitHubRepoByCodeHash,
  PinkContractPromise,
  type CertificateData,
} from '@phala/sdk'
import { ApiPromise } from '@polkadot/api'
import { Abi } from '@polkadot/api-contract'
import { waitReady } from '@polkadot/wasm-crypto'
import { Keyring } from '@polkadot/keyring'
import { type KeyringPair } from '@polkadot/keyring/types'
import type { Result } from '@polkadot/types'
import { type AccountId } from '@polkadot/types/interfaces'

import {
  MAX_BUILD_SIZE,
  runWebpack,
  printFileSizesAfterBuild,
} from '../lib/runWebpack'

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
}

interface ParsedArgs {
  readonly script: string
}

export default abstract class PhatCommandBase extends Command {
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
      description: 'Client RPC URL',
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
      } else if (endpoint === 'wss://poc5.phala.network/ws') {
        brickProfileFactoryContractId = '0x489bb4fa807bbe0f877ed46be8646867a8d16ec58add141977c4bd19b0237091'
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
    const registry = await getClient({
      transport: endpoint,
      pruntimeURL: this.parsedFlags.pruntimeUrl,
    })
    const cert = await signCertificate({ pair })
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
      ux.action.start('Creating an optimized build')
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
      ux.action.stop()
      const buildAssets = printFileSizesAfterBuild(stats)

      if (!buildAssets || !buildAssets.length) {
        return this.error('Build assets not found')
      }

      if (buildAssets[0].size > MAX_BUILD_SIZE) {
        this.error(
          `The file size exceeds the limit of ${filesize(MAX_BUILD_SIZE, {
            base: 2,
            standard: 'jedec',
          })}.`
        )
      }

      return upath.join(buildAssets[0].outputPath, buildAssets[0].name)

    } catch (error: any) {
      ux.action.stop(chalk.red('Failed to compile.\n'))
      return this.error(error)
    }
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
