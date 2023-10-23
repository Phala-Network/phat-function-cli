import fs from 'node:fs'
import { ux, Flags } from '@oclif/core'
import type { Result, Struct, u16, Text, Bool } from '@polkadot/types'
import {
  PinkContractPromise,
} from '@phala/sdk'
import inquirer from 'inquirer'

import PhatCommandBase, { type ParsedFlags } from '../lib/PhatCommandBase'

interface WorkflowCodec extends Struct {
  id: u16
  name: Text
  enabled: Bool
  commandline: Text
}

export default class Update extends PhatCommandBase {
  static description = 'Update Phat Contract JS'

  static args = {
    ...PhatCommandBase.args
  }

  static flags = {
    ...PhatCommandBase.flags,
    workflowId: Flags.integer({
      description: 'Workflow ID',
      required: false,
    }),
  }

  public async run(): Promise<void> {
    const workflowId = await this.getWorkflowId()
    const pair = await this.getDecodedPair({
      suri: this.parsedFlags.suri || process.env.POLKADOT_WALLET_SURI,
      accountFilePath: this.parsedFlags.accountFilePath || process.env.POLKADOT_WALLET_ACCOUNT_FILE,
      accountPassword: this.parsedFlags.accountPassword || process.env.POLKADOT_WALLET_ACCOUNT_PASSWORD,
    })

    const buildScriptPath = await this.buildOrGetScriptPath()

    // Step 1: Connect to the endpoint.
    const endpoint = this.getEndpoint()
    ux.action.start(`Connecting to the endpoint: ${endpoint}`)
    const [apiPromise, registry, cert] = await this.connect({
      endpoint,
      pair,
    })
    ux.action.stop()

    // Step 2: Query the brick profile contract id.
    ux.action.start('Querying your Brick Profile contract ID')
    const brickProfileContractId = await this.getBrickProfileContractId({
      endpoint,
      registry,
      apiPromise,
      pair,
      cert,
    })
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
    const rollupAbi = await this.getRollupAbi()
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
      fs.readFileSync(buildScriptPath, 'utf8'),
    )
    ux.action.stop()
    this.log(
      `The JavaScript code for workflow ${workflowId} has been updated.`
    )
    this.exit(0)
  }

  async getWorkflowId() {
    let { workflowId } = this.parsedFlags as ParsedFlags & {
      workflowId?: number
    }

    if (workflowId === undefined) {
      if (process.env.WORKFLOW_ID !== undefined && !isNaN(parseFloat(process.env.WORKFLOW_ID))) {
        workflowId = Number(process.env.WORKFLOW_ID)
      } else {
        workflowId =  await this.promptWorkflowId()
      }
    }

    if (isNaN(workflowId)) {
      return this.error('Invalid workflow ID: Must be a number or numeric string.')
    }

    return workflowId
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
