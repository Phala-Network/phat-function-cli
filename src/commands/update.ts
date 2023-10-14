import fs from 'node:fs'
import upath from 'upath'
import { Args, Flags, ux } from '@oclif/core'
import type { Result, Struct, u16, Text, Bool } from '@polkadot/types'
import { type AccountId } from '@polkadot/types/interfaces'
import { Abi } from '@polkadot/api-contract'
import { ApiPromise, WsProvider } from '@polkadot/api'
import {
  OnChainRegistry,
  options,
  signCertificate,
  PinkContractPromise,
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

interface WorkflowCodec extends Struct {
  id: u16
  name: Text
  enabled: Bool
  commandline: Text
}

export default class Update extends PhatCommandBase {
  static description = 'Upload JS to Phat Contract'

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
      description: 'Path to account account JSON file',
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
    brickProfileFactory: Flags.string({
      description: 'Brick profile factory contract address',
      required: false,
    }),
    workflowId: Flags.integer({
      description: 'Workflow ID',
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
    } = await this.parse(Update)

    if (flags.envFilePath) {
      if (!fs.existsSync(flags.envFilePath)) {
        this.error(`Env file does not exist: ${flags.envFilePath}`)
      }
      dotenv.config({ path: upath.resolve(flags.envFilePath) })
    } else {
      dotenv.config()
    }

    const isDev = flags.mode === 'development' || flags.mode === 'dev'
    let workflowId = flags.workflowId
    if (workflowId === null || workflowId === undefined) {
      if (process.env.WORKFLOW_ID !== null && process.env.WORKFLOW_ID !== undefined) {
        workflowId = Number(process.env.WORKFLOW_ID)
      } else {
        workflowId =  await this.promptWorkflowId()
      }
    }
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
      await brickProfileFactory.query.getUserProfileAddress<
        Result<AccountId, any>
      >(pair.address, { cert })

    if (!brickProfileAddressQuery.isOk || !brickProfileAddressQuery.asOk.isOk) {
      this.error('You need create Brick Profile before continue.')
    }

    const brickProfileContractId = brickProfileAddressQuery.asOk.asOk.toHex()
    ux.action.stop()
    this.log(`Your Brick Profile contract ID: ${brickProfileContractId}`)

    // Step 3: Check current user workflow settings.
    ux.action.start('Checking your workflow settings')
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
    const { output: workflowQuery } = await brickProfile.query.getWorkflow<
      Result<WorkflowCodec, any>
    >(pair.address, { cert }, workflowId)
    if (!workflowQuery.isOk || !workflowQuery.asOk.isOk) {
      this.error('Workflow not found.')
    }
    const actions = JSON.parse(workflowQuery.asOk.asOk.commandline.toString())
    const rollupAbi = new Abi(
      await this.loadAbiByCodeHash('0x96ca5480eb52b8087b1e64cae52c75e6db037e1920320653584ef920db5d29d5')
    )
    if (actions[0].config.codeHash !== rollupAbi.info.source.wasmHash.toHex()) {
      this.error(
        `The codeHash of the workflow is not matched with the ActionOffchainRollup contract.\nExpected: ${
          actions[0].config.codeHash
        }\nActual: ${rollupAbi.info.source.wasmHash.toHex()}\n`
      )
    }
    ux.action.stop()

    // Step 4: Update the JS.
    ux.action.start('Updating')
    const actionOffchainRollupContractId = actions[0].config.callee
    const rollupContractKey = await registry.getContractKeyOrFail(
      actionOffchainRollupContractId
    )
    const rollupContract = new PinkContractPromise(
      apiPromise,
      registry,
      rollupAbi,
      actionOffchainRollupContractId,
      rollupContractKey
    )
    await rollupContract.send.configCoreScript(
      { cert, address: pair.address, pair },
      fs.readFileSync(
        buildAssets && buildAssets.length
          ? upath.join(buildAssets[0].outputPath, buildAssets[0].name)
          : upath.join(process.cwd(), 'dist', 'index.js'),
        'utf8'
      )
    )
    ux.action.stop()
    this.log(
      `The JavaScript code for workflow ${workflowId} has been updated.`
    )
    this.exit(0)
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

  async promptWorkflowId(
    message = 'Please enter your workflow ID'
  ): Promise<number> {
    const { workflowId } = await inquirer.prompt([
      {
        name: 'workflowId',
        type: 'input',
        message,
      },
    ])
    return Number(workflowId)
  }
}
