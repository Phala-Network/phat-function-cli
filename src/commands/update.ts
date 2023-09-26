import fs from 'node:fs'
import upath from 'upath'
import { Flags, ux } from '@oclif/core'
import type { Result, Struct, u16, Text, Bool } from '@polkadot/types'
import { type AccountId } from '@polkadot/types/interfaces'
import { Abi } from '@polkadot/api-contract'
import { ApiPromise, WsProvider } from '@polkadot/api'
import {
  OnChainRegistry,
  options,
  signCertificate,
  PinkContractPromise,
  signAndSend,
} from '@phala/sdk'

import PhatCommandBase from '../lib/PhatCommandBase'

interface WorkflowCodec extends Struct {
  id: u16
  name: Text
  enabled: Bool
  commandline: Text
}

export default class Update extends PhatCommandBase {
  static description = 'Upload JS to Phat Function'

  static flags = {
    accountFilePath: Flags.string({
      char: 'a',
      required: false,
      description: 'Path to account account JSON file',
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
    workflowId: Flags.integer({
      description: 'Workflow ID',
      required: true,
    }),
    mode: Flags.custom({
      options: ['production', 'prod', 'development', 'dev'],
      default: 'development',
    })(),
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(Update)
    const isDev = flags.mode === 'development' || flags.mode === 'dev'
    const pair = await this.getDecodedPair({
      suri: flags.suri,
      accountFilePath: flags.accountFilePath,
    })

    // Step 1: Connect to the endpoint.
    let endpoint
    if (flags.endpoint) {
      endpoint = flags.endpoint
    } else {
      endpoint = isDev
        ? 'wss://poc5.phala.network/ws'
        : 'wss://api.phala.network/ws'
    }
    ux.action.start(`Connecting to the endpoint: ${endpoint}`)
    const cert = await signCertificate({ pair })
    const apiPromise = await ApiPromise.create(
      options({
        provider: new WsProvider(endpoint),
        noInitWarn: true,
      })
    )
    const registry = await OnChainRegistry.create(apiPromise)
    ux.action.stop()

    // Step 2: Query the brick profile contract id.
    ux.action.start('Querying your Brick Profile contract ID')
    const brickProfileFactoryContractId = isDev
      ? '0x489bb4fa807bbe0f877ed46be8646867a8d16ec58add141977c4bd19b0237091'
      : '0xb59bcc4ea352f3d878874d8f496fb093bdf362fa59d6e577c075f41cd7c84924'
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

    // Step 3: Check current user workflow settings.
    ux.action.start('Checking your workflow settings')
    const brickProfileAbi = await this.loadAbiByContractId(
      registry,
      brickProfileContractId,
    )
    const brickProfileContractKey = await registry.getContractKeyOrFail(brickProfileContractId)
    const brickProfile = new PinkContractPromise(apiPromise, registry, brickProfileAbi, brickProfileContractId, brickProfileContractKey)
    const { output: workflowQuery } = await brickProfile.query.getWorkflow<Result<WorkflowCodec, any>>(pair.address, { cert }, flags.workflowId)
    if (!workflowQuery.isOk || !workflowQuery.asOk.isOk) {
      this.error('Workflow not found.')
    }
    const actions = JSON.parse(workflowQuery.asOk.asOk.commandline.toString())
    const rollupAbi = new Abi((await this.loadAbiByCodeHash(isDev ? '0xe0a086ccadbac348b625e859b46175224b226d29fa842f051e49c6fcc85dee62' : '0x96ca5480eb52b8087b1e64cae52c75e6db037e1920320653584ef920db5d29d5')))
    if (actions[0].config.codeHash !== rollupAbi.info.source.wasmHash.toHex()) {
      this.error(
        `The codeHash of the workflow is not matched with the ActionOffchainRollup contract.\nExpected: ${actions[0].config.codeHash}\nActual: ${rollupAbi.info.source.wasmHash.toHex()}\n`
      )
    }
    ux.action.stop()

    // Step 4: Update the JS.
    ux.action.start('Updating')
    const actionOffchainRollupContractId = actions[0].config.callee
    const rollupContractKey = await registry.getContractKeyOrFail(actionOffchainRollupContractId)
    const rollupContract = new PinkContractPromise(apiPromise, registry, rollupAbi, actionOffchainRollupContractId, rollupContractKey)
    await signAndSend(
      rollupContract.tx.configCoreScript(
        { gasLimit: 1000000000000 },
        fs.readFileSync(
          upath.join(process.cwd(), 'dist', 'index.js'),
          'utf8'
        ),
      ),
      pair
    )
    ux.action.stop()
    this.log(`The Phat Function for workflow ${flags.workflowId} has been updated.`)

    process.exit(0)
  }
}
