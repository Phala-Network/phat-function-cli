import { existsSync, readFileSync } from 'node:fs'
import { Args, Command, Flags } from '@oclif/core'
import { ethers, JsonRpcProvider } from 'ethers'
import chalk from 'chalk'

import { resolveToAbsolutePath } from '../lib/utils'
import { runQuickJs } from '../lib/runQuickJs'

export default class Watch extends Command {
  static description = 'Watch contract events and run Phat Function'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    rpc: Flags.string({
      description: 'RPC endpoint',
    }),
    scriptArgs: Flags.string({
      char: 'a',
      description: 'Script arguments',
      multiple: true,
      default: [],
    }),
    once: Flags.boolean({
      description: 'Process events once only',
      default: false,
    }),
  }

  static args = {
    address: Args.string({
      description: 'The contract address',
      required: true
    }),
    contract: Args.string({
      description: 'The location of the contract JSON file',
      required: true,
    }),
    js: Args.string({
      description: 'The location of the JS file',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Watch)
    if (!existsSync(args.contract)) {
      return this.error(`The Contract file ${args.contract} not found`)
    }
    if (!ethers.isAddress(args.address)) {
      return this.error('Invalid contract address')
    }
    let provider: JsonRpcProvider
    if (flags.rpc) {
      provider = new ethers.JsonRpcProvider(flags.rpc)
    } else {
      provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545/')
    }
    const signer = await provider.getSigner()
    let contractJson
    try {
      contractJson = JSON.parse(readFileSync(args.contract, 'utf-8'))
    } catch (error: any) {
      return this.error(error)
    }
    const contract = new ethers.Contract(args.address, contractJson.abi, signer)
    console.log(chalk.green(`Listening for ${contractJson.contractName} MessageQueued events...`))
    contract.on('MessageQueued', async (from, to, event) => {
      const [tail, data] = event.args
      console.info('Received event [MessageQueued]:', {
        tail,
        data,
      })

      const js = readFileSync(resolveToAbsolutePath(args.js), 'utf8')
      const output = await runQuickJs(js, [data, ...flags.scriptArgs])
      console.info(`JS Execution output: ${output}`)
      const action = ethers.hexlify(ethers.concat([
        new Uint8Array([0]),
        output,
      ]))
      await contract.rollupU256CondEq(
        // cond
        [],
        [],
        // updates
        [],
        [],
        // actions
        [action],
      )
      if (flags.once) {
        process.exit()
      }
    })
  }
}
