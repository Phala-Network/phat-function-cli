import fs from 'node:fs'
import upath from 'upath'
import { Args, Flags, ux } from '@oclif/core'
import type { Result, u16 } from '@polkadot/types'
import { type AccountId } from '@polkadot/types/interfaces'
import { Abi } from '@polkadot/api-contract'
import { ApiPromise, WsProvider } from '@polkadot/api'
import {
  OnChainRegistry,
  options,
  signCertificate,
  PinkContractPromise,
  PinkBlueprintPromise,
} from '@phala/sdk'
import chalk from 'chalk'
import { filesize } from 'filesize'
import inquirer from 'inquirer'
import * as dotenv from 'dotenv'

import PhatCommandBase from '../lib/PhatCommandBase'
import {
  MAX_BUILD_SIZE,
  runWebpack,
  printFileSizesAfterBuild,
} from '../lib/runWebpack'

export default class Upload extends PhatCommandBase {
  static description = 'Upload JS to Phat Function'

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
      description: 'Phala provider endpoint',
      required: false,
    }),
    rpc: Flags.string({
      description: 'Client RPC URL',
      required: false,
    }),
    brickProfileFactory: Flags.string({
      description: 'Brick profile factory contract address',
      required: false,
    }),
    consumerAddress: Flags.string({
      description: 'Consumer contract address',
      required: false,
    }),
    coreSettings: Flags.string({
      description: 'Core settings',
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

  public async run(): Promise<void> {
    const {
      flags,
      args: { script },
    } = await this.parse(Upload)

    if (flags.envFilePath) {
      if (!fs.existsSync(flags.envFilePath)) {
        this.error(`Env file does not exist: ${flags.envFilePath}`)
      }
      dotenv.config({ path: upath.resolve(flags.envFilePath) })
    } else {
      dotenv.config()
    }

    const isDev = flags.mode === 'development' || flags.mode === 'dev'
    const rpc = flags.rpc || (await this.promptRpc())
    const consumerAddress = flags.consumerAddress || (await this.promptConsumerAddress())
    const pair = await this.getDecodedPair({
      suri: flags.suri || process.env.POLKADOT_WALLET_SURI,
      accountFilePath: flags.accountFilePath || process.env.POLKADOT_WALLET_ACCOUNT_FILE,
      accountPassword: flags.accountPassword || process.env.POLKADOT_WALLET_ACCOUNT_PASSWORD,
    })

    let buildAssets
    if (flags.build) {
      const directory = process.cwd()
      try {
        ux.action.start('Creating an optimized build')
        const stats = await runWebpack({
          clean: true,
          projectDir: directory,
          customWebpack: flags.webpack,
          buildEntries: {
            [upath.parse(script).name]: script,
          },
          outputDir: upath.resolve(directory, 'dist'),
          isDev: false,
        })
        ux.action.stop()
        buildAssets = printFileSizesAfterBuild(stats)
      } catch (error: any) {
        ux.action.stop(chalk.red('Failed to compile.\n'))
        return this.error(error)
      }

      if (
        buildAssets &&
        buildAssets.length &&
        buildAssets[0].size > MAX_BUILD_SIZE
      ) {
        this.error(
          `The file size exceeds the limit of ${filesize(MAX_BUILD_SIZE, {
            base: 2,
            standard: 'jedec',
          })}.`
        )
      }
    }

    // Step 1: Connect to the endpoint.
    let endpoint
    if (flags.endpoint) {
      endpoint = flags.endpoint
    } else {
      endpoint = isDev
        ? 'wss://poc6.phala.network/ws'
        : 'wss://api.phala.network/ws'
    }
    ux.action.start(`Connecting to the endpoint: ${endpoint}`)
    const apiPromise = await ApiPromise.create(
      options({
        provider: new WsProvider(endpoint),
        noInitWarn: true,
      })
    )
    const registry = await OnChainRegistry.create(apiPromise)
    const cert = await signCertificate({ pair })
    ux.action.stop()

    // Step 2: Query the brick profile contract id.
    ux.action.start('Querying your Brick Profile contract ID')
    let brickProfileFactoryContractId = flags.brickProfileFactory
    if (!brickProfileFactoryContractId) {
      brickProfileFactoryContractId = isDev
        ? '0x489bb4fa807bbe0f877ed46be8646867a8d16ec58add141977c4bd19b0237091'
        : '0xb59bcc4ea352f3d878874d8f496fb093bdf362fa59d6e577c075f41cd7c84924'
    }
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
    ux.action.stop()
    this.log(`Your Brick Profile contract ID: ${brickProfileContractId}`)

    // Step 3: Instantiating the ActionOffchainRollup contract.
    ux.action.start('Instantiating the ActionOffchainRollup contract')
    const brickProfileAbi = await this.loadAbiByContractId(
      registry,
      brickProfileContractId
    )
    const brickProfileContractKey = await registry.getContractKeyOrFail(
      brickProfileContractId
    )
    const brickProfile = new PinkContractPromise(
      apiPromise,
      registry,
      brickProfileAbi,
      brickProfileContractId,
      brickProfileContractKey
    )
    const rollupAbi = new Abi(
      await this.loadAbiByCodeHash('0x96ca5480eb52b8087b1e64cae52c75e6db037e1920320653584ef920db5d29d5')
    )
    const blueprint = new PinkBlueprintPromise(
      apiPromise,
      registry,
      rollupAbi,
      rollupAbi.info.source.wasmHash.toHex()
    )

    const result = await blueprint.send.withConfiguration(
      { cert, address: pair.address, pair },
      rpc,
      consumerAddress,
      fs.readFileSync(
        buildAssets && buildAssets.length
          ? upath.join(buildAssets[0].outputPath, buildAssets[0].name)
          : upath.join(process.cwd(), 'dist', 'index.js'),
        'utf8'
      ),
      flags.coreSettings || '',
      brickProfileContractId
    )
    await result.waitFinalized()
    const contractPromise = result.contract
    ux.action.stop()
    this.log(
      'The ActionOffchainRollup contract has been instantiated:',
      contractPromise.address.toHex()
    )

    // Step 4: Setting up the actions.
    ux.action.start('Setting up the actions')
    const { output: attestorQuery } =
      await contractPromise.query.getAttestAddress(cert.address, { cert })
    const attestor = attestorQuery.asOk.toHex()
    const selectorUint8Array = rollupAbi.messages
      .find((i) => i.identifier === 'answer_request')
      ?.selector.toU8a()
    const selector = Buffer.from(selectorUint8Array!).readUIntBE(
      0,
      selectorUint8Array!.length
    )
    const actions = [
      {
        cmd: 'call',
        config: {
          codeHash: rollupAbi.info.source.wasmHash.toHex(),
          callee: contractPromise.address.toHex(),
          selector,
          input: [],
        },
      },
      {
        cmd: 'log',
      },
    ]
    const { output: numberQuery } = await brickProfile.query.workflowCount<u16>(
      pair.address,
      { cert }
    )
    const num = numberQuery.asOk.toNumber()

    const externalAccountId = 0
    const result2 = await brickProfile.send.addWorkflowAndAuthorize(
      { cert, address: pair.address, pair },
      `My PhatContract Oracle ${numberQuery.asOk.toNumber()}`,
      JSON.stringify(actions),
      externalAccountId
    )
    await result2.waitFinalized()
    ux.action.stop()
    this.log(
      `🎉 Your workflow has been added, you can check it out here: https://bricks-poc5.phala.network/workflows/${brickProfileContractId}/${num}`
    )
    this.log('Your Attestor address:', attestor)
    this.log('Your WORKFLOW_ID:', numberQuery.asOk.toNumber())
    process.exit(0)
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
}
