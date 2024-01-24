import { Flags } from '@oclif/core'
import { getContract } from '@phala/sdk'
import type { u64, Result } from '@polkadot/types'
import type { AccountId } from '@polkadot/types/interfaces'

import PhatBaseCommand, { type ParsedFlags, type BrickProfileContract } from '../lib/PhatBaseCommand'

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

    // verify the RPC endpoint
    await this.verifyRpcEndpoint(evmRpcEndpoint)

    // connect to the endpoint
    const endpoint = this.getEndpoint()
    const [apiPromise, registry] = await this.connect({ endpoint })
    const provider = await this.getProvider({ apiPromise })

    // query the brick profile contract id
    this.action.start('Querying your Dashboard Profile contract ID')
    const brickProfileContractId = await this.getBrickProfileContractId({
      endpoint,
      registry,
      provider,
    })
    this.action.succeed(`Your Dashboard Profile contract ID: ${brickProfileContractId}`)

    // generate evm account
    try {
      this.action.start('Adding EVM account')
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
      const { output } = await brickProfile.q.externalAccountCount<u64>()
      if (output.isErr) {
        throw new Error(output.asErr.toString())
      }
      const externalAccountCount = output.asOk.toNumber()

      await brickProfile.exec.generateEvmAccount({
        args: [evmRpcEndpoint],
        waitFinalized: async () => {
          const { output } = await brickProfile.q.externalAccountCount<u64>()
          return output.isOk && output.asOk.toNumber() === externalAccountCount + 1
        }
      })

      const { output: evmAccountAddressOutput } = await brickProfile.q.getEvmAccountAddress<Result<AccountId, any>>({
        args: [externalAccountCount]
      })
      if (evmAccountAddressOutput.isErr) {
        throw new Error(evmAccountAddressOutput.asErr.toString())
      }
      const evmAddress = evmAccountAddressOutput.asOk.asOk.toHex()
      this.action.succeed(`Added successfully, your new EVM account address is: [${externalAccountCount}] ${evmAddress}`)
      process.exit(0)
    } catch (error) {
      this.action.fail('Failed to add EVM account.')
      return this.error(error as Error)
    }
  }
}
