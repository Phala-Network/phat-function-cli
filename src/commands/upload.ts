import fs from 'node:fs'
import upath from 'upath'
import { Args, Flags, ux } from '@oclif/core'
import type { Result, u16 } from '@polkadot/types'
import { type AccountId } from '@polkadot/types/interfaces'
import { Abi } from '@polkadot/api-contract'
import { ApiPromise, WsProvider } from '@polkadot/api'
import {
  OnChainRegistry,
  options,
  signCertificate,
  PinkContractPromise,
  PinkBlueprintPromise,
  signAndSend,
  PinkBlueprintSubmittableResult,
} from '@phala/sdk'
import chalk from 'chalk'
import { filesize } from 'filesize'

import PhatCommandBase from '../lib/PhatCommandBase'
import {
  MAX_BUILD_SIZE,
  runWebpack,
  printFileSizesAfterBuild,
} from '../lib/runWebpack'

export default class Upload extends PhatCommandBase {
  static description = 'Upload JS to Phat Function'

  static args = {
    script: Args.string({
      description: 'The function script file',
      require: true,
      default: 'src/index',
    }),
  }

  static flags = {
    accountFilePath: Flags.string({
      char: 'a',
      required: false,
      description: 'Path to account account JSON file',
      exclusive: ['suri'],
    }),
    suri: Flags.string({
      required: false,
      description: 'Substrate uri',
      exclusive: ['accountFilePath'],
    }),
    endpoint: Flags.string({
      description: 'Phala provider endpoint',
      required: false,
    }),
    rpc: Flags.string({
      description: 'Client RPC URL',
      required: true,
    }),
    consumerAddress: Flags.string({
      description: 'Consumer contract address',
      required: true,
    }),
    coreSettings: Flags.string({
      description: 'Core settings',
      required: false,
    }),
    mode: Flags.custom({
      options: ['production', 'prod', 'development', 'dev'],
      default: 'development',
    })(),
    build: Flags.boolean({
      char: 'b',
      default: true,
    }),
  }

  public async run(): Promise<void> {
    const {
      flags,
      args: { script },
    } = await this.parse(Upload)
    const isDev = flags.mode === 'development' || flags.mode === 'dev'
    let buildAssets
    if (flags.build) {
      const directory = process.cwd()
      try {
        ux.action.start('Creating an optimized build')
        const stats = await runWebpack({
          clean: true,
          projectDir: directory,
          customWebpack: flags.webpack,
          buildEntries: {
            [upath.parse(script).name]: script,
          },
          outputDir: upath.resolve(directory, 'dist'),
          isDev: false,
        })
        ux.action.stop()
        buildAssets = printFileSizesAfterBuild(stats)
      } catch (error: any) {
        ux.action.stop(chalk.red('Failed to compile.\n'))
        return this.error(error)
      }

      if (
        buildAssets &&
        buildAssets.length &&
        buildAssets[0].size > MAX_BUILD_SIZE
      ) {
        this.error(
          `The file size exceeds the limit of ${filesize(MAX_BUILD_SIZE, {
            base: 2,
            standard: 'jedec',
          })}.`
        )
      }
    }

    this.log('Start uploading...')
    const pair = await this.getDecodedPair({
      suri: flags.suri,
      accountFilePath: flags.accountFilePath,
    })

    // Step 1: Connect to the endpoint.
    let endpoint
    if (flags.endpoint) {
      endpoint = flags.endpoint
    } else {
      endpoint = isDev
        ? 'wss://poc5.phala.network/ws'
        : 'wss://api.phala.network/ws'
    }
    ux.action.start(`Connecting to the endpoint: ${endpoint}`)
    const cert = await signCertificate({ pair })
    const apiPromise = await ApiPromise.create(
      options({
        provider: new WsProvider(endpoint),
        noInitWarn: true,
      })
    )
    const registry = await OnChainRegistry.create(apiPromise)
    ux.action.stop()

    // Step 2: Query the brick profile contract id.
    ux.action.start('Querying your Brick Profile contract ID')
    const brickProfileFactoryContractId = isDev
      ? '0x489bb4fa807bbe0f877ed46be8646867a8d16ec58add141977c4bd19b0237091'
      : '0xb59bcc4ea352f3d878874d8f496fb093bdf362fa59d6e577c075f41cd7c84924'
    const brickProfileFactoryAbi = await this.loadAbiByContractId(
      registry,
      brickProfileFactoryContractId
    )
    const brickProfileFactoryContractKey = await registry.getContractKeyOrFail(
      brickProfileFactoryContractId
    )
    const brickProfileFactory = new PinkContractPromise(
      apiPromise,
      registry,
      brickProfileFactoryAbi,
      brickProfileFactoryContractId,
      brickProfileFactoryContractKey
    )
    const { output: brickProfileAddressQuery } =
      await brickProfileFactory.query.getUserProfileAddress<Result<AccountId, any>>(pair.address, { cert })

    if (!brickProfileAddressQuery.isOk || !brickProfileAddressQuery.asOk.isOk) {
      this.error('You need create Brick Profile before continue.')
    }

    const brickProfileContractId = brickProfileAddressQuery.asOk.asOk.toHex()
    ux.action.stop()
    this.log(`Your Brick Profile contract ID: ${brickProfileContractId}`)

    // Step 3: Instantiating the ActionOffchainRollup contract.
    ux.action.start('Instantiating the ActionOffchainRollup contract')
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
    const rollupAbi = new Abi(
      await this.loadAbiByCodeHash(
        isDev
          ? '0xe0a086ccadbac348b625e859b46175224b226d29fa842f051e49c6fcc85dee62'
          : '0x96ca5480eb52b8087b1e64cae52c75e6db037e1920320653584ef920db5d29d5'
      )
    )
    const blueprint = new PinkBlueprintPromise(
      apiPromise,
      registry,
      rollupAbi,
      rollupAbi.info.source.wasmHash.toHex()
    )

    const result = await signAndSend<PinkBlueprintSubmittableResult>(
      blueprint.tx.withConfiguration(
        { gasLimit: 1000000000000 },
        flags.rpc,
        flags.consumerAddress,
        fs.readFileSync(
          buildAssets && buildAssets.length
            ? upath.join(buildAssets[0].outputPath, buildAssets[0].name)
            : upath.join(process.cwd(), 'dist', 'index.js'),
          'utf8'
        ),
        flags.coreSettings || '',
        brickProfileContractId
      ),
      pair
    )
    await result.waitFinalized()
    const contractPromise = result.contract
    ux.action.stop()
    this.log(
      'The ActionOffchainRollup contract has been instantiated:',
      contractPromise.address.toHex()
    )

    // Step 4: Setting up the actions.
    ux.action.start('Setting up the actions')
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
    const { blocknum: initBlockNum } = await registry.phactory.getInfo({})

    await signAndSend(
      brickProfile.tx.addWorkflow(
        { gasLimit: 1000000000000 },
        `My Phat Function ${numberQuery.asOk.toNumber()}`,
        JSON.stringify(actions)
      ),
      pair
    )

    // How many blocks wait for confirmations
    const confirmations = 8
    while (true) {
      const { blocknum } = await registry.phactory.getInfo({})
      if (blocknum > initBlockNum + confirmations) {
        this.error(
          `Wait for transaction finalized in PRuntime but timeout after ${confirmations} blocks.`
        )
      }
      const { output: numberQuery } =
        await brickProfile.query.workflowCount<u16>(pair.address, { cert })
      if (numberQuery.asOk.toNumber() > num) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
    const externalAccountId = 0
    await signAndSend(
      brickProfile.tx.authorizeWorkflow(
        { gasLimit: 1000000000000 },
        num,
        externalAccountId
      ),
      pair
    )
    ux.action.stop()
    this.log(
      `🎉 Your workflow has been added, you can check it out here: https://bricks-poc5.phala.network/workflows/${brickProfileContractId}/${num}`
    )
    this.log('Your Attestor address:', attestor)
    this.log('Your WORKFLOW_ID:', numberQuery.asOk.toNumber())
    process.exit(0)
  }
}
