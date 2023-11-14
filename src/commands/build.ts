import { lstatSync, readFileSync, existsSync } from 'node:fs'
import upath from 'upath'
import { Args, Command, Flags, ux } from '@oclif/core'
import chalk from 'chalk'

import { resolveToAbsolutePath } from '../lib/utils'
import { runWebpack, printFileSizesAfterBuild } from '../lib/runWebpack'

export default class Build extends Command {
  static description = 'Build a production bundle of the function script'

  static args = {
    script: Args.string({
      description: 'The function script file',
      require: true,
      default: 'src/index',
    }),
  }

  static flags = {
    location: Flags.string({
      char: 'd',
      description: 'Location directory',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output directory',
    }),
    webpack: Flags.string({
      char: 'w',
      description: 'Custom webpack config',
    }),
    mode: Flags.custom({
      options: ['production', 'prod', 'development', 'dev'],
      default: 'production',
    })(),
  }

  public async run(): Promise<void> {
    const { flags, args: { script } } = await this.parse(Build)
    const directory = flags.location ? resolveToAbsolutePath(flags.location) : process.cwd()
    const isDev = flags.mode === 'development' || flags.mode === 'dev'
    if (!lstatSync(directory).isDirectory()) {
      this.error('Location directory is not a valid directory')
    }

    const outputDir = upath.resolve(directory, flags.output ?? 'dist')
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

    ux.action.start('Creating an optimized build')

    try {
      const stats = await runWebpack({
        clean: true,
        projectDir: directory,
        customWebpack: flags.webpack,
        buildEntries,
        outputDir,
        isDev,
      })
      ux.action.stop()
      printFileSizesAfterBuild(stats)
    } catch (error: any) {
      ux.action.stop(chalk.red('Failed to compile.\n'))
      return this.error(error)
    }
  }
}
