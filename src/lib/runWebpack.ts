import path from 'node:path'
import upath from 'upath'
import webpack, { Configuration, Stats } from 'webpack'
import TerserPlugin from 'terser-webpack-plugin'
import VirtualModulesPlugin from 'webpack-virtual-modules'
import { merge, mergeWithCustomize, customizeArray } from 'webpack-merge'

import { resolveToAbsolutePath } from '../lib/utils'
import { formatWebpackMessages } from '../lib/formatWebpackMessages'

export const MAX_BUILD_SIZE = 1024 * 1024

const BUILD_CODE_TEMPLATE = `
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

