import { readFileSync } from 'node:fs'
import { Args, Command, Flags } from '@oclif/core'

import { resolveToAbsolutePath } from '../lib/utils'
import { runQuickJs } from '../lib/runQuickJs'

export default class Run extends Command {
  static description = 'Run JS in QuickJS runtime'

  static flags = {
    scriptArgs: Flags.string({
      char: 'a',
      description: 'Script Arguments',
      multiple: true,
    }),
  }

  static args = {
    script: Args.string({
      description: 'The location of the JS file',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const {
      flags: { scriptArgs = [] },
      args: { script },
    } = await this.parse(Run)
    const scriptPath = resolveToAbsolutePath(script)
    const js = readFileSync(scriptPath, 'utf8')
    const output = await runQuickJs(js, scriptArgs)
    this.log(`JS Execution output: ${output}`)
  }
}
