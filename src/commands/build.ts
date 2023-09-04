import { lstatSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { Command, Flags, ux } from '@oclif/core'
import webpack, { Configuration, Stats } from 'webpack'
import VirtualModulesPlugin from 'webpack-virtual-modules'
import { merge, mergeWithCustomize, customizeArray } from 'webpack-merge'
import TerserPlugin from 'terser-webpack-plugin'
import { filesize } from 'filesize'
import chalk from 'chalk'

import { resolveToAbsolutePath } from '../lib/utils'
import { formatWebpackMessages } from '../lib/formatWebpackMessages'

const MAX_BUILD_SIZE = 1024 * 1024

const BUILD_CODE_TEMPLATE = `
  // @ts-ignore
  import entry from '{filePath}';
  (globalThis as any).scriptOutput = entry((globalThis as any).scriptArgs);
`

const getBaseConfig = (
  buildEntries: Configuration['entry'],
  projectDir: string,
  outputDir: string,
  development?: boolean,
): webpack.Configuration => ({
  target: 'node',
  mode: development ? 'development' : 'production',
  context: projectDir,
  entry: buildEntries,
  optimization: development ? {} : {
    usedExports: true,
    minimize: true,
    minimizer: [new TerserPlugin({
      extractComments: false,
      terserOptions: {
        output: {
          comments: false,
        },
      },
    })],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: require.resolve('ts-loader'),
        options: {
          compilerOptions: {
            declaration: false,
            moduleResolution: 'node',
            module: 'es6',
          },
        },
      },
    ],
  },

  resolve: {
    extensionAlias: {
      '.js': ['.js', '.ts'],
    },
    extensions: ['.ts', '.js'],
  },

  output: {
    path: outputDir,
    filename: '[name].js',
  },
})

function modifyFilePath(filePath: string) {
  let newFilePath = filePath.replace(/\/([^/]+)$/, '/_$1')
  if (!newFilePath.endsWith('.ts')) {
    newFilePath += '.ts'
  }
  return newFilePath
}

async function runWebpack({
  buildEntries,
  projectDir,
  outputDir,
  customWebpack,
  isDev = false,
  clean = false,
}: {
  buildEntries: Configuration['entry'],
  projectDir: string,
  outputDir: string,
  customWebpack?: string,
  isDev: boolean,
  clean: boolean,
}): Promise<Stats> {
  const virtualModules = new VirtualModulesPlugin(Object.entries(buildEntries || {}).reduce((acc, [, value]) => {
    acc[path.join(projectDir, modifyFilePath(value))] = BUILD_CODE_TEMPLATE.replace(/{filePath}/g, path.join(projectDir, value))
    return acc
  }, {} as Record<string, string>))
  const newBuildEntries = Object.entries(buildEntries || {}).reduce((acc, [key, value]) => {
    acc[key] = path.join(projectDir, modifyFilePath(value))
    return acc
  }, {} as Record<string, string>)

  let config = merge(
    getBaseConfig(newBuildEntries, projectDir, outputDir, isDev),
    {
      output: {
        clean
      },
      plugins: [
        virtualModules,
      ]
    },
  )

  if (customWebpack) {
    config = mergeWithCustomize({
      customizeArray: customizeArray({
        'module.rules': 'replace',
      }),
    })(config, require(resolveToAbsolutePath(customWebpack)))
  }

  return new Promise((resolve, reject) => {
    webpack(config).run((error, stats) => {
      if (error || !stats) {
        return reject(error || new Error('Failed to compile.'))
      }

      if (stats.hasErrors()) {
        const json = stats.toJson({ all: false, errors: true })
        const messages = formatWebpackMessages(json)
        return reject(new Error(messages.errors?.join('\n\n')))
      }

      return resolve(stats)
    })
  })
}

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
    const { size } = statSync(path.join(json.outputPath ?? '', asset.name))
    return {
      folder: path.join(
        path.basename(json.outputPath ?? ''),
        path.dirname(asset.name),
      ),
      name: path.basename(asset.name),
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
  static description = 'Build a production bundle of your JS'

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
    const { flags } = await this.parse(Build)
    const directory = flags.location ? resolveToAbsolutePath(flags.location) : process.cwd()
    const isDev = flags.mode === 'development' || flags.mode === 'dev'
    if (!lstatSync(directory).isDirectory()) {
      this.error('Location directory is not a valid directory')
    }

    const outputDir = path.resolve(directory, flags.output ?? 'dist')
    let buildEntries: Record<string, string> = {
      index: 'src/index',
    }
    const pjson = JSON.parse(readFileSync(path.join(directory, 'package.json')).toString())
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
