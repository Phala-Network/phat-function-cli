import fs from 'node:fs'
import type { u16 } from '@polkadot/types'
import {
  PinkContractPromise,
  PinkBlueprintPromise,
} from '@phala/sdk'

import PhatBaseCommand from '../lib/PhatBaseCommand'
import type { BrickProfileContract } from '../lib/PhatBaseCommand'

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
    const pair = await this.getDecodedPair({
      suri: this.parsedFlags.suri || process.env.POLKADOT_WALLET_SURI,
      accountFilePath: this.parsedFlags.accountFilePath || process.env.POLKADOT_WALLET_ACCOUNT_FILE,
      accountPassword: this.parsedFlags.accountPassword || process.env.POLKADOT_WALLET_ACCOUNT_PASSWORD,
    })

    const buildScriptPath = await this.buildOrGetScriptPath()

    // Step 1: Connect to the endpoint.
    const endpoint = this.getEndpoint()
    const [apiPromise, registry, cert] = await this.connect({
      endpoint,
      pair,
    })

    // Step 2: Query the brick profile contract id.
    this.action.start('Querying your Brick Profile contract ID')
    const brickProfileContractId = await this.getBrickProfileContractId({
      endpoint,
      registry,
      apiPromise,
      pair,
      cert,
    })
    this.action.succeed(`Your Brick Profile contract ID: ${brickProfileContractId}`)

    // Step 3: Instantiating the ActionOffchainRollup contract.
    this.action.start('Instantiating the ActionOffchainRollup contract')
    const brickProfileAbi = await this.loadAbiByContractId(
      registry,
      brickProfileContractId
    )
    const brickProfileContractKey = await registry.getContractKeyOrFail(
      brickProfileContractId
    )
    const brickProfile: BrickProfileContract = new PinkContractPromise(
      apiPromise,
      registry,
      brickProfileAbi,
      brickProfileContractId,
      brickProfileContractKey
    )
    const rollupAbi = await this.getRollupAbi()
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
      fs.readFileSync(buildScriptPath, 'utf8'),
      this.parsedFlags.coreSettings || '',
      brickProfileContractId
    )
    await result.waitFinalized()
    const contractPromise = result.contract
    this.action.succeed(
      `The ActionOffchainRollup contract has been instantiated: ${contractPromise.address.toHex()}`,
    )

    // Step 4: Select an external account.
    const externalAccountId = await this.promptEvmAccountId({
      contract: brickProfile,
      cert,
    })


    // Step 5: Checking your settings.
    this.action.start('Checking your settings')
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
    this.action.succeed()

    const projectName = await this.promptProjectName(`My Phat Contract ${numberQuery.asOk.toNumber()}`)

    // Step 6: Setting up the actions.
    this.action.start('Setting up the actions')
    const result2 = await brickProfile.send.addWorkflowAndAuthorize(
      { cert, address: pair.address, pair },
      projectName,
      JSON.stringify(actions),
      externalAccountId
    )
    await result2.waitFinalized()
    this.action.succeed(
      `🎉 Your workflow has been added, you can check it out here: https://bricks.phala.network/workflows/${brickProfileContractId}/${num}`
    )
    this.log('Your Attestor address:', attestor)
    this.log('Your WORKFLOW_ID:', numberQuery.asOk.toNumber())
    process.exit(0)
  }
}
