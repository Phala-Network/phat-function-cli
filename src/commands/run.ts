import { readFileSync } from 'node:fs'
import { Args, Command, Flags } from '@oclif/core'

import { resolveToAbsolutePath } from '../lib/utils'
import { runQuickJs } from '../lib/runQuickJs'

export default class Run extends Command {
  static description = 'Run JS in QuickJS runtime'
  public static enableJsonFlag = true

  static flags = {
    scriptArgs: Flags.string({
      char: 'a',
      description: 'Script arguments',
      multiple: true,
    }),
    experimentalAsync: Flags.boolean({
      description: 'Run async code',
      default: false
    }),
  }

  static args = {
    script: Args.string({
      description: 'The location of the JS file',
      required: true,
    }),
  }

  public async run(): Promise<{ output: string }> {
    const {
      flags: { scriptArgs = [], experimentalAsync },
      args: { script },
    } = await this.parse(Run)
    const scriptPath = resolveToAbsolutePath(script)
    const js = readFileSync(scriptPath, 'utf8')
    const output = await runQuickJs(js, scriptArgs, {
      silent: this.jsonEnabled(),
      isAsync: experimentalAsync,
    })
    this.log(JSON.stringify({ output }))
    return {
      output,
    }
  }
}
