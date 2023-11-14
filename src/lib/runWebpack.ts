import { statSync } from 'node:fs'
import path from 'node:path'
import upath from 'upath'
import webpack, { Configuration, Stats } from 'webpack'
import TerserPlugin from 'terser-webpack-plugin'
import VirtualModulesPlugin from 'webpack-virtual-modules'
import { merge, mergeWithCustomize, customizeArray } from 'webpack-merge'
import { filesize } from 'filesize'
import chalk from 'chalk'

import { resolveToAbsolutePath } from '../lib/utils'
import { formatWebpackMessages } from '../lib/formatWebpackMessages'

export const MAX_BUILD_SIZE = 1024 * 400

const BUILD_CODE_TEMPLATE = `
  declare global {
    var pink: any;
  }
  // @ts-ignore
  import entry from '{filePath}';
  (globalThis as any).scriptOutput = entry.apply(null, (globalThis as any).scriptArgs);
`

const getBaseConfig = (
  buildEntries: Configuration['entry'],
  projectDir: string,
  outputDir: string,
  development?: boolean,
): webpack.Configuration => ({
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
          configFile: require.resolve('../../tsconfig.build.json'),
          onlyCompileBundledFiles: true,
        }
      },
    ],
  },

  resolve: {
    extensions: ['.ts', '.js'],
  },

  output: {
    path: outputDir,
    filename: '[name].js',
  },
})


function modifyFilePath(filePath: string) {
  let newFilePath = filePath.replace(/([^/]+)$/, '_$1')
  if (!newFilePath.endsWith('.ts')) {
    newFilePath += '.ts'
  }
  return newFilePath
}

export async function runWebpack({
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
    acc[path.join(projectDir, modifyFilePath(value))] = BUILD_CODE_TEMPLATE.replace(/{filePath}/g, upath.join(projectDir, value))
    return acc
  }, {} as Record<string, string>))
  const newBuildEntries = Object.entries(buildEntries || {}).reduce((acc, [key, value]) => {
    acc[key] = upath.join(projectDir, modifyFilePath(value))
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

export function printFileSizesAfterBuild(
  stats: Stats,
  maxSize: number = MAX_BUILD_SIZE,
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
      outputPath: json.outputPath ?? '',
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
  return assets
}

