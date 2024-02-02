import { lstatSync, readFileSync, existsSync } from 'node:fs'
import upath from 'upath'
import { Args, Flags } from '@oclif/core'

import { resolveToAbsolutePath } from '../lib/utils'
import { runWebpack, printFileSizesAfterBuild } from '../lib/runWebpack'
import { formatWebpackMessages } from '../lib/formatWebpackMessages'
import BaseCommand from '../lib/BaseCommand'

export default class Build extends BaseCommand {
  static description = 'Build a production bundle of the function script'

  static args = {
    script: Args.string({
      description: 'The function script file',
      require: true,
      default: 'src/index',
    }),
  }

  static flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Specify the script directory',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output file',
    }),
    outputDir: Flags.string({
      description: 'Output directory',
    }),
    webpack: Flags.string({
      char: 'w',
      description: 'Custom webpack config',
    }),
    silent: Flags.boolean({
      char: 's',
      description: 'Silent mode'
    }),
    clean: Flags.boolean({
      char: 'c',
      description: 'Clean the output directory',
      default: false,
    }),
    mode: Flags.custom({
      options: ['production', 'prod', 'development', 'dev'],
      default: 'production',
    })(),
    experimentalAsync: Flags.boolean({
      description: 'Build async code',
      default: false
    }),
  }

  public async run(): Promise<void> {
    const { flags, args: { script } } = await this.parse(Build)
    const directory = flags.directory ? resolveToAbsolutePath(flags.directory) : process.cwd()
    const isDev = flags.mode === 'development' || flags.mode === 'dev'
    if (!lstatSync(directory).isDirectory()) {
      this.error('Location directory is not a valid directory')
    }

    const outputDir = upath.resolve(directory, flags.outputDir ?? 'dist')
    let buildEntries: Record<string, string> = {
      [upath.parse(script).name]: script,
    }


    const pjson_file_path = upath.join(directory, 'package.json')
    if (existsSync(pjson_file_path)) {
      try {
        const pjson = JSON.parse(readFileSync(pjson_file_path).toString())
        if (pjson.exports && typeof pjson.exports !== 'string') {
          buildEntries = Object.entries(pjson.exports as Record<string, string>).reduce(
            (acc, [key, value]) => {
              acc[key] = value
              return acc
            },
            { ...buildEntries },
          )
        }
      } catch (error) {
        this.error(`Error parsing package.json: ${error}`)
      }
    }

    for (const i in buildEntries) {
      if (typeof buildEntries[i] !== 'string') {
        this.warn(`Ignoring entry ${i} from build.`)
        delete buildEntries[i]
      }
    }

    if (!flags.silent) {
      this.action.start('Creating an optimized build')
    }

    try {
      const stats = await runWebpack({
        clean: flags.output ? false : flags.clean,
        projectDir: directory,
        outputDir: flags.output ? upath.resolve(upath.dirname(flags.output)) : outputDir,
        outputFileName: flags.output ? upath.basename(flags.output) : undefined,
        customWebpack: flags.webpack,
        buildEntries,
        isDev,
        isAsync: flags.experimentalAsync,
      })
      if (!flags.silent) {
        this.action.stop()
        const json = stats.toJson({
          all: false,
          warnings: true,
          assets: true,
          outputPath: true
        })
        const messages = formatWebpackMessages(json)
        if (messages.warnings && messages.warnings.length) {
          this.action.warn('Compiled with warnings.')
          this.log(messages.warnings.join('\n\n'))
        } else {
          this.action.succeed('Compiled successfully.')
        }
        printFileSizesAfterBuild(json)
      }
    } catch (error: any) {
      if (!flags.silent) {
        this.action.fail('Failed to compile.')
      }
      return this.error(error)
    }
  }
}
