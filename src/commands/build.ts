import { lstatSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import upath from 'upath'
import { Args, Command, Flags, ux } from '@oclif/core'
import { Stats } from 'webpack'
import { filesize } from 'filesize'
import chalk from 'chalk'

import { resolveToAbsolutePath } from '../lib/utils'
import { formatWebpackMessages } from '../lib/formatWebpackMessages'
import { MAX_BUILD_SIZE, runWebpack } from '../lib/runWebpack'

function printFileSizesAfterBuild(
  stats: Stats,
  maxSize: number,
) {
  const json = stats.toJson({ all: false, warnings: true, assets: true, outputPath: true })
  const messages = formatWebpackMessages(json)
  if (messages.warnings && messages.warnings.length) {
    console.log(chalk.yellow('Compiled with warnings.\n'))
    console.log(messages.warnings.join('\n\n'))
  } else {
    console.log(chalk.green('Compiled successfully.\n'))
  }
  const assets = (json.assets ?? []).map(asset => {
    const { size } = statSync(upath.join(json.outputPath ?? '', asset.name))
    return {
      folder: upath.join(
        upath.basename(json.outputPath ?? ''),
        upath.dirname(asset.name),
      ),
      name: upath.basename(asset.name),
      size: size,
      sizeLabel: filesize(size, { base: 2, standard: 'jedec' }),
    }
  })
  assets.sort((a: any, b: any) => b.size - a.size)
  assets.forEach(asset => {
    const sizeLabel = asset.sizeLabel
    const exceeded = maxSize && asset.size > maxSize
    if (exceeded) {
      console.log([
        '  ',
        chalk.yellow(`${sizeLabel}`),
        '  ',
        chalk.dim(asset.folder + path.sep),
        chalk.cyan(asset.name),
        '  ',
        chalk.yellow(`(Exceeded the limit size of ${filesize(maxSize, { base: 2, standard: 'jedec' })})`),
      ].join(''))
    } else {
      console.log([
        '  ',
        sizeLabel,
        '  ',
        chalk.dim(asset.folder + path.sep) + chalk.cyan(asset.name),
      ].join(''))
    }
  })
}

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
      index: script,
    }
    const pjson = JSON.parse(readFileSync(upath.join(directory, 'package.json')).toString())
    if (pjson.exports && typeof pjson.exports !== 'string') {
      buildEntries = Object.entries(pjson.exports as Record<string, string>).reduce(
        (acc, [key, value]) => {
          acc[key] = value
          return acc
        },
        { ...buildEntries },
      )
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
      printFileSizesAfterBuild(stats, MAX_BUILD_SIZE)
    } catch (error: any) {
      ux.action.stop(chalk.red('Failed to compile.\n'))
      return this.error(error)
    }
  }
}
