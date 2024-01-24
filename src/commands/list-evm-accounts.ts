import {
  getContract,
} from '@phala/sdk'
import chalk from 'chalk'
import type { Result, Vec } from '@polkadot/types'

import PhatBaseCommand from '../lib/PhatBaseCommand'
import type { BrickProfileContract, ExternalAccountCodec } from '../lib/PhatBaseCommand'

export default class ListEvmAccounts extends PhatBaseCommand {
  static description = 'List EVM accounts'

  static args = {
    ...PhatBaseCommand.args
  }

  static flags = {
    ...PhatBaseCommand.flags
  }

  public async run(): Promise<void> {
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

    // querying your external accounts
    try {
      this.action.start('Querying your external accounts')
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
      const { output } = await brickProfile.q.getAllEvmAccounts<Result<Vec<ExternalAccountCodec>, any>>()
      if (output.isErr) {
        throw new Error(output.asErr.toString())
      }
      if (output.asOk.isErr) {
        throw new Error(output.asOk.asErr.toString())
      }
      this.action.stop()
      const accounts = output.asOk.asOk.map((i) => {
        const obj = i.toJSON()
        return {
          id: obj.id,
          address: obj.address,
          rpcEndpoint: obj.rpc,
        }
      })
      if (accounts.length === 0) {
        this.log('You have no external accounts, please call `add-evm-account` first.')
        process.exit(0)
      }
      accounts.map(account => this.log(`[${account.id}] ${account.address} ${chalk.dim(account.rpcEndpoint)}`))
      process.exit(0)
    } catch (error) {
      this.action.fail('Failed to query your external accounts.')
      return this.error(error as Error)
    }
  }
}
