import fs from 'node:fs'
import { Flags } from '@oclif/core'
import type { Result, Struct, u16, Text, Bool } from '@polkadot/types'
import { getContract } from '@phala/sdk'
import inquirer from 'inquirer'

import PhatBaseCommand, { type ParsedFlags, type BrickProfileContract, type ActionOffChainRollupContract } from '../lib/PhatBaseCommand'

interface WorkflowCodec extends Struct {
  id: u16
  name: Text
  enabled: Bool
  commandline: Text
}

export default class Update extends PhatBaseCommand {
  static description = 'Update Phat Contract JS'

  static args = {
    ...PhatBaseCommand.args
  }

  static flags = {
    ...PhatBaseCommand.flags,
    workflowId: Flags.integer({
      description: 'Workflow ID',
      required: false,
    }),
  }

  public async run(): Promise<void> {
    const workflowId = await this.getWorkflowId()
    const buildScriptPath = await this.buildOrGetScriptPath()

    // connect to the endpoint
    const endpoint = this.getEndpoint()
    const [apiPromise, registry] = await this.connect({ endpoint })
    const provider = await this.getProvider({ apiPromise })

    // query the brick profile contract id
    this.action.start('Querying your Brick Profile contract ID')
    const brickProfileContractId = await this.getBrickProfileContractId({
      endpoint,
      registry,
      provider,
    })
    this.action.succeed(`Your Brick Profile contract ID: ${brickProfileContractId}`)

    // check current user workflow settings
    this.action.start('Checking your workflow settings')
    const brickProfileAbi = await this.loadAbiByContractId(
      registry,
      brickProfileContractId
    )
    const brickProfile = await getContract({
      client: registry,
      contractId: brickProfileContractId,
      abi: brickProfileAbi,
      provider,
    }) as BrickProfileContract
    const { output: workflowQuery } = await brickProfile.q.getWorkflow<Result<WorkflowCodec, any>>({
      args: [workflowId]
    })
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
    this.action.stop()

    // Step 4: Update the JS.
    this.action.start('Updating')
    const actionOffchainRollupContractId = actions[0].config.callee
    const rollupContract = await getContract({
      client: registry,
      contractId: actionOffchainRollupContractId,
      abi: rollupAbi,
      provider,
    }) as ActionOffChainRollupContract
    await rollupContract.exec.configCoreScript({
      args: [fs.readFileSync(buildScriptPath, 'utf8')]
    })
    this.action.succeed(
      `The JavaScript code for workflow ${workflowId} has been updated.`
    )
    process.exit(0)
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
