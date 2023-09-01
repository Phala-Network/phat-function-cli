import { readFileSync } from 'node:fs'
import { Args, Command } from '@oclif/core'

import { resolveToAbsolutePath } from '../lib/utils'
import { runQuickJs } from '../lib/runQuickJs'

export default class Run extends Command {
  static description = 'Run JS in QuickJS runtime'

  static args = {
    file: Args.string({
      description: 'The location of the JS file',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    let { args: { file } } = await this.parse(Run)
    file = resolveToAbsolutePath(file)
    const js = readFileSync(file, 'utf8')
    const output = await runQuickJs(js)
    this.log(`JS Execution output: ${output}`)
  }
}
