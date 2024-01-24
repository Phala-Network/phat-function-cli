import { Flags } from '@oclif/core'
import type { Struct, u128, u64, Result } from '@polkadot/types'
import { getContract } from '@phala/sdk'
import type { AccountId } from '@polkadot/types/interfaces'
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'
import { toHex } from 'viem/utils'
import { mnemonicToMiniSecret } from '@polkadot/util-crypto'
import { u8aToHex } from '@polkadot/util'
import chalk from 'chalk'

import PhatBaseCommand, { type ParsedFlags, type BrickProfileFactoryContract, type BrickProfileContract } from '../lib/PhatBaseCommand'

interface PartialAccountQueryResult extends Struct {
  data: {
    free: u128
  }
}

type CreateBrickProfileArgs = ParsedFlags & {
  evmRpcEndpoint: string
  generate?: boolean
  type: 'substrate' | 'evm'
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
    generate: Flags.boolean({
      description: 'Generate mnemonic and use for Phat Contract Dashboard.',
      required: false,
    }),
    type: Flags.string({
      description: 'One of substrate or evm. Default is substrate. NOTE: evm account support now only available on PoC6 testnet.',
      required: false,
      default: 'substrate',
      options: ['substrate', 'evm'],
      helpValue: 'substrate|evm',
    }),
  }

  public async run(): Promise<void> {
    const { generate, type: accountType, evmRpcEndpoint, addressIndex } = this.parsedFlags as CreateBrickProfileArgs
    if (!generate) {
      if (!this.parsedFlags.mnemonic && !this.parsedFlags.privateKey && !this.parsedFlags.suri && !process.env.PRIVATE_KEY && !process.env.POLKADOT_WALLET_SURI) {
        return this.error('You need specified one of --mnemonic, --privateKey, --suri or --generate to continuing.')
      }
    } else {
      const mnemonic = generateMnemonic(english)
      this.log('\nPlease copy the following mnemonic and keep it safe.\n')
      this.log(chalk.yellow(mnemonic), '\n')
      if (accountType === 'substrate') {
        const suri = u8aToHex(mnemonicToMiniSecret(mnemonic))
        this.parsedFlags.suri = suri
        this.log('Please run following command to save your account to .env file.\n')
        this.log(`echo 'POLKADOT_WALLET_SURI=${suri}' >> .env`)
      } else if (accountType === 'evm') {
        this.warn('You are generating EVM account, please note it only available on PoC6 testnet now.')
        const account = mnemonicToAccount(mnemonic, { addressIndex })
        this.parsedFlags.privateKey = toHex(account.getHdKey().privateKey!)
        this.log('Please run following command to save your account to .env file.\n')
        this.log(`echo 'PRIVATE_KEY=${toHex(account.getHdKey().privateKey!)}' >> .env`)
      } else {
        return this.error('You need specified --type to continuing.')
      }
    }

    if (evmRpcEndpoint) {
      await this.verifyRpcEndpoint(evmRpcEndpoint)
    }

    // connect to the endpoint
    const endpoint = this.getEndpoint()
    const [apiPromise, registry, type] = await this.connect({ endpoint })
    const provider = await this.getProvider({ apiPromise })

    this.log('Your address is', chalk.blue(provider.address))

    // check if brick profile already exists
    this.action.start('Checking your brick profile contract ID')
    const brickProfileFactoryContractId = await this.getBrickProfileFactoryContractId(endpoint)
    const brickProfileFactoryAbi = await this.loadAbiByContractId(
      registry,
      brickProfileFactoryContractId
    )
    const brickProfileFactory = await getContract<BrickProfileFactoryContract>({
      client: registry,
      contractId: brickProfileFactoryContractId,
      abi: brickProfileFactoryAbi,
      provider,
    })
    const { output } = await brickProfileFactory.q.getUserProfileAddress<Result<AccountId, any>>()
    if (output.isOk && output.asOk.isOk) {
      this.action.succeed(`Your Brick Profile already exists, contract ID: ${output.asOk.asOk.toHex()}`)
      process.exit(0)
    }
    this.action.succeed('Your brick profile does not exist')

    // check balance
    this.action.start('Checking account balance')
    const accountQueryResult = await registry.api.query.system.account<PartialAccountQueryResult>(provider.address)
    const balance = Number(accountQueryResult.data.free.toBigInt() / BigInt(1e12))
    if (balance < 50) {
      this.action.fail(`Insufficient on-chain balance, please go to ${type.isDevelopment || type.isLocal ? 'https://phala.network/faucet' : 'https://docs.phala.network/introduction/basic-guidance/get-pha-and-transfer'} to get more than 50 PHA before continuing the process.`)
      process.exit(0)
    }
    this.action.succeed(`Account balance: ${balance} PHA`)

    try {
      this.action.start('Creating your brick profile')
      await brickProfileFactory.exec.createUserProfile({
        waitFinalized: async () => {
          const { output } = await brickProfileFactory.q.getUserProfileAddress<Result<AccountId, any>>()
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
      })
      // query profile
      const { output } = await brickProfileFactory.q.getUserProfileAddress<Result<AccountId, any>>()
      if (output.isErr) {
        throw new Error(output.asErr.toString())
      }
      const brickProfileContractId = output.asOk.asOk.toHex()
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

      // unsafeConfigureJsRunner
      const jsRunnerContractId = await this.getJsRunnerContractId(endpoint)
      await this.unsafeConfigureJsRunner({
        contract: brickProfile,
        jsRunnerContractId,
      })

      // unsafeGenerateEtherAccount
      const { output: queryCount } = await brickProfile.q.externalAccountCount()
      if (queryCount.isErr) {
        throw new Error(queryCount.asErr.toString())
      }
      const externalAccountCount = output.asOk.toNumber()
      if (externalAccountCount === 0) {
        await this.unsafeGenerateEtherAccount({
          contract: brickProfile,
          externalAccountCount,
          evmRpcEndpoint: evmRpcEndpoint || (type.isDevelopment || type.isLocal) ? 'https://polygon-mumbai.g.alchemy.com/v2/YWlujLKt0nSn5GrgEpGCUA0C_wKV1sVQ' : 'https://polygon-mainnet.g.alchemy.com/v2/W1kyx17tiFQFT2b19mGOqppx90BLHp0a',
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
    contract,
    externalAccountCount,
    evmRpcEndpoint,
  }: {
    contract: BrickProfileContract
    externalAccountCount: number
    evmRpcEndpoint: string
  }) {
    await contract.exec.generateEvmAccount({
      args: [evmRpcEndpoint],
      waitFinalized: async () => {
        const { output } = await contract.q.externalAccountCount<u64>()
        return output.isOk && output.asOk.toNumber() === externalAccountCount + 1
      }
    })
  }

  async unsafeConfigureJsRunner({
    contract,
    jsRunnerContractId,
  }: {
    contract: BrickProfileContract
    jsRunnerContractId: string
  }) {
    await contract.exec.config({
      args: [jsRunnerContractId],
      waitFinalized: async () => {
        const { output } = await contract.q.getJsRunner<Result<AccountId, any>>()
        return (
          output.isOk &&
          output.asOk.isOk &&
          output.asOk.asOk.toHex() === jsRunnerContractId
        )
      }
    })
  }
}
