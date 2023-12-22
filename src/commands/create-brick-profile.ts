import { Flags } from '@oclif/core'
import type { Struct, u128 } from '@polkadot/types'
import { PinkContractPromise, OnChainRegistry, type CertificateData } from '@phala/sdk'
import { type KeyringPair } from '@polkadot/keyring/types'

import PhatBaseCommand, { type ParsedFlags, type BrickProfileFactoryContract, type BrickProfileContract } from '../lib/PhatBaseCommand'
import { bindWaitPRuntimeFinalized } from '../lib/utils'

interface PartialAccountQueryResult extends Struct {
  data: {
    free: u128
  }
}

export default class CreateBrickProfile extends PhatBaseCommand {
  static description = 'Create brick profile'

  static args = {
    ...PhatBaseCommand.args
  }

  static flags = {
    ...PhatBaseCommand.flags,
    evmRpcEndpoint: Flags.string({
      description: 'EVM RPC endpoint',
      required: false,
    }),
  }

  public async run(): Promise<void> {
    const { evmRpcEndpoint } = this.parsedFlags as ParsedFlags & {
      evmRpcEndpoint: string
    }

    if (evmRpcEndpoint) {
      await this.verifyRpcEndpoint(evmRpcEndpoint)
    }

    const pair = await this.getDecodedPair({
      suri: this.parsedFlags.suri || process.env.POLKADOT_WALLET_SURI,
      accountFilePath: this.parsedFlags.accountFilePath || process.env.POLKADOT_WALLET_ACCOUNT_FILE,
      accountPassword: this.parsedFlags.accountPassword || process.env.POLKADOT_WALLET_ACCOUNT_PASSWORD,
    })

    // Step 1: Connect to the endpoint.
    const endpoint = this.getEndpoint()
    const [apiPromise, registry, cert, type] = await this.connect({
      endpoint,
      pair,
    })

    // Step 2: Check balance
    const account = await apiPromise.query.system.account<PartialAccountQueryResult>(cert.address)
    const balance = Number(account.data.free.toBigInt() / BigInt(1e12))
    if (balance < 50) {
      this.action.fail(`Insufficient on-chain balance, please go to ${type.isDevelopment || type.isLocal ? 'https://phala.network/faucet' : 'https://docs.phala.network/introduction/basic-guidance/get-pha-and-transfer'} to get more than 50 PHA before continuing the process.`)
      this.exit(0)
    }
    try {
      this.action.start('Creating your brick profile')
      const brickProfileFactoryContractId = await this.getBrickProfileFactoryContractId(endpoint)
      const brickProfileFactoryAbi = await this.loadAbiByContractId(
        registry,
        brickProfileFactoryContractId
      )
      const brickProfileFactoryContractKey = await registry.getContractKeyOrFail(
        brickProfileFactoryContractId
      )
      const brickProfileFactory: BrickProfileFactoryContract = new PinkContractPromise(
        apiPromise,
        registry,
        brickProfileFactoryAbi,
        brickProfileFactoryContractId,
        brickProfileFactoryContractKey
      )
      const waitForPRuntimeFinalized = bindWaitPRuntimeFinalized(registry)
      // Step 3: create user profile
      await waitForPRuntimeFinalized(
        brickProfileFactory.send.createUserProfile(
          { cert, address: pair.address, pair },
        ),
        async function () {
          const { output } = await brickProfileFactory.query.getUserProfileAddress(cert.address, {
            cert,
          })
          const created = output && output.isOk && output.asOk.isOk
          if (!created) {
            return false
          }
          const result = await registry.getContractKey(
            output.asOk.asOk.toHex()
          )
          if (result) {
            return true
          }
          return false
        }
      )
      // Step 4: query profile
      const { output } = await brickProfileFactory.query.getUserProfileAddress(cert.address, {
        cert,
      })
      if (output.isErr) {
        throw new Error(output.asErr.toString())
      }
      const brickProfileContractId = output.asOk.asOk.toHex()
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
      // Step 5: unsafeConfigureJsRunner
      const jsRunnerContractId = await this.getJsRunnerContractId(endpoint)
      await this.unsafeConfigureJsRunner({
        registry,
        contract: brickProfile,
        jsRunnerContractId,
        pair,
        cert,
      })
      // Step 6: unsafeGenerateEtherAccount
      const { output: queryCount } = await brickProfile.query.externalAccountCount(cert.address, {
        cert,
      })
      if (queryCount.isErr) {
        throw new Error(queryCount.asErr.toString())
      }
      const externalAccountCount = output.asOk.toNumber()
      if (externalAccountCount === 0) {
        await this.unsafeGenerateEtherAccount({
          registry,
          contract: brickProfile,
          externalAccountCount,
          evmRpcEndpoint: evmRpcEndpoint || (type.isDevelopment || type.isLocal) ? 'https://polygon-mumbai.g.alchemy.com/v2/YWlujLKt0nSn5GrgEpGCUA0C_wKV1sVQ' : 'https://polygon-mainnet.g.alchemy.com/v2/W1kyx17tiFQFT2b19mGOqppx90BLHp0a',
          pair,
          cert
        })
      }
      this.action.succeed(`Created successfully.`)
      process.exit(0)
    } catch (error) {
      this.action.fail('Failed to create brick profile.')
      return this.error(error as Error)
    }
  }

  async unsafeGenerateEtherAccount({
    registry,
    contract,
    externalAccountCount,
    evmRpcEndpoint,
    pair,
    cert,
  }: {
    registry: OnChainRegistry
    contract: BrickProfileContract
    externalAccountCount: number
    evmRpcEndpoint: string
    pair: KeyringPair
    cert: CertificateData
  }) {
    const waitForPRuntimeFinalized = bindWaitPRuntimeFinalized(registry)
    await waitForPRuntimeFinalized(
      contract.send.generateEvmAccount(
        { cert, address: pair.address, pair },
        evmRpcEndpoint
      ),
      async function () {
        const { output } = await contract.query.externalAccountCount(cert.address, {
          cert,
        })
        return output.isOk && output.asOk.toNumber() === externalAccountCount + 1
      }
    )
  }

  async unsafeConfigureJsRunner({
    registry,
    contract,
    jsRunnerContractId,
    pair,
    cert,
  }: {
    registry: OnChainRegistry
    contract: BrickProfileContract
    jsRunnerContractId: string
    pair: KeyringPair
    cert: CertificateData
  }) {
    const waitForPRuntimeFinalized = bindWaitPRuntimeFinalized(registry)
    await waitForPRuntimeFinalized(
      contract.send.config(
        { cert, address: pair.address, pair },
        jsRunnerContractId
      ),
      async function () {
        const { output } = await contract.query.getJsRunner(cert.address, { cert })
        return (
          output.isOk &&
          output.asOk.isOk &&
          output.asOk.asOk.toHex() === jsRunnerContractId
        )
      }
    )
  }
}
