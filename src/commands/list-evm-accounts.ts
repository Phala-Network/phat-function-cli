import {
  PinkContractPromise,
} from '@phala/sdk'
import chalk from 'chalk'

import PhatBaseCommand from '../lib/PhatBaseCommand'
import type { BrickProfileContract } from '../lib/PhatBaseCommand'

export default class ListEvmAccounts extends PhatBaseCommand {
  static description = 'List EVM accounts'

  static args = {
    ...PhatBaseCommand.args
  }

  static flags = {
    ...PhatBaseCommand.flags
  }

  public async run(): Promise<void> {
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

    // Step 3: Querying your external accounts
    try {
      this.action.start('Querying your external accounts')
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
      const { output } = await brickProfile.query.getAllEvmAccounts(cert.address, {
        cert,
      })
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
      accounts.map(account => this.log(`[${account.id}] ${account.address}. ${chalk.dim(account.rpcEndpoint)}`))
      process.exit(0)
    } catch (error) {
      this.action.fail('Failed to query your external accounts.')
      return this.error(error as Error)
    }
  }
}
