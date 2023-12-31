import fs from 'node:fs'
import type { u16 } from '@polkadot/types'
import {
  getContract,
  PinkBlueprintPromise,
} from '@phala/sdk'

import PhatBaseCommand from '../lib/PhatBaseCommand'
import type { BrickProfileContract, ActionOffChainRollupContract } from '../lib/PhatBaseCommand'

export default class Upload extends PhatBaseCommand {
  static description = 'Upload JS to Phat Contract'

  static args = {
    ...PhatBaseCommand.args
  }

  static flags = {
    ...PhatBaseCommand.flags
  }

  public async run(): Promise<void> {
    const rpc = this.parsedFlags.rpc || (await this.promptRpc())
    const consumerAddress = this.parsedFlags.consumerAddress || (await this.promptConsumerAddress())

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
    const brickProfileAbi = await this.loadAbiByContractId(
      registry,
      brickProfileContractId
    )
    const brickProfile = await getContract<BrickProfileContract>({
      client: registry,
      contractId: brickProfileContractId,
      abi: brickProfileAbi,
      provider,
    })
    this.action.succeed(`Your Brick Profile contract ID: ${brickProfileContractId}`)

    // instantiating the ActionOffchainRollup contract
    this.action.start('Instantiating the ActionOffchainRollup contract')

    const rollupAbi = await this.getRollupAbi()
    const blueprint = new PinkBlueprintPromise(
      apiPromise,
      registry,
      rollupAbi,
      rollupAbi.info.source.wasmHash.toHex()
    )
    const instantiateResult = await blueprint.send.withConfiguration(
      {
        provider,
      },
      rpc,
      consumerAddress,
      fs.readFileSync(buildScriptPath, 'utf8'),
      this.parsedFlags.coreSettings || '',
      brickProfileContractId
    )
    await instantiateResult.waitFinalized()
    const { contract } = instantiateResult
    contract.provider = provider
    this.action.succeed(
      `The ActionOffchainRollup contract has been instantiated: ${contract.address.toHex()}`,
    )

    // select an external account
    const externalAccountId = await this.promptEvmAccountId({
      contract: brickProfile,
    })

    // check your settings
    this.action.start('Checking your settings')
    const { output: attestorQuery } = await (contract as ActionOffChainRollupContract).q.getAttestAddress()
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
          callee: contract.address.toHex(),
          selector,
          input: [],
        },
      },
      {
        cmd: 'log',
      },
    ]
    const { output: numberQuery } = await brickProfile.q.workflowCount<u16>()
    const num = numberQuery.asOk.toNumber()
    this.action.succeed()

    const projectName = await this.promptProjectName(`My Phat Contract ${numberQuery.asOk.toNumber()}`)

    // setting up the actions
    this.action.start('Setting up the actions')
    const result2 = await brickProfile.exec.addWorkflowAndAuthorize({
      args: [
        projectName,
        JSON.stringify(actions),
        externalAccountId
      ]
    })
    await result2.waitFinalized()
    this.action.succeed(
      `🎉 Your workflow has been added, you can check it out here: https://bricks.phala.network/workflows/${brickProfileContractId}/${num}`
    )
    this.log('Your Attestor address:', attestor)
    this.log('Your WORKFLOW_ID:', numberQuery.asOk.toNumber())
    process.exit(0)
  }
}
