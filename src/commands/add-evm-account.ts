import { Flags } from '@oclif/core'
import { PinkContractPromise } from '@phala/sdk'

import PhatBaseCommand, { type ParsedFlags, type BrickProfileContract } from '../lib/PhatBaseCommand'
import { bindWaitPRuntimeFinalized } from '../lib/utils'

export default class AddEvmAccount extends PhatBaseCommand {
  static description = 'Add EVM accounts'

  static args = {
    ...PhatBaseCommand.args
  }

  static flags = {
    ...PhatBaseCommand.flags,
    evmRpcEndpoint: Flags.string({
      description: 'EVM RPC endpoint',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const { evmRpcEndpoint } = this.parsedFlags as ParsedFlags & {
      evmRpcEndpoint: string
    }
    console.info(evmRpcEndpoint)
    const pair = await this.getDecodedPair({
      suri: this.parsedFlags.suri || process.env.POLKADOT_WALLET_SURI,
      accountFilePath: this.parsedFlags.accountFilePath || process.env.POLKADOT_WALLET_ACCOUNT_FILE,
      accountPassword: this.parsedFlags.accountPassword || process.env.POLKADOT_WALLET_ACCOUNT_PASSWORD,
    })

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

    // Step 3: generate evm account
    try {
      this.action.start('Adding evm account')
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
      const { output } = await brickProfile.query.externalAccountCount(cert.address, {
        cert,
      })
      if (output.isErr) {
        throw new Error(output.asErr.toString())
      }
      const externalAccountCount = output.asOk.toNumber()
      const waitForPRuntimeFinalized = bindWaitPRuntimeFinalized(registry)
      await waitForPRuntimeFinalized(
        brickProfile.send.generateEvmAccount(
          { cert, address: pair.address, pair },
          evmRpcEndpoint
        ),
        async function () {
          const { output } = await brickProfile.query.externalAccountCount(cert.address, {
            cert,
          })
          return output.isOk && output.asOk.toNumber() === externalAccountCount + 1
        }
      )
      const { output: evmAccountAddressOutput } = await brickProfile.query.getEvmAccountAddress(
        cert.address,
        { cert },
        externalAccountCount
      )
      if (evmAccountAddressOutput.isErr) {
        throw new Error(evmAccountAddressOutput.asErr.toString())
      }
      const evmAddress = evmAccountAddressOutput.asOk.asOk.toHex()
      this.action.succeed(`Added successfully, your evm address is: ${evmAddress}`)
      process.exit(0)
    } catch (error) {
      this.action.fail('Failed to add evm account.')
      return this.error(error as Error)
    }
  }
}
