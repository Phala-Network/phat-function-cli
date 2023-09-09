import { promises as asyncFs } from 'node:fs'
import upath from 'upath'

import { Command, Flags, Args, ux } from '@oclif/core'
import chalk from 'chalk'
import inquirer from 'inquirer'
import simpleGit from 'simple-git'

const TEMPLATE_ALIASES: Record<string, { url: string; description: string }> = {
  'lensapi-oracle-consumer-contract': {
    url: 'https://github.com/Phala-Network/lensapi-oracle-consumer-contract',
    description: 'Polygon Consumer Contract for LensAPI Oracle',
  },
}

const TEMPLATE_DESC = [
  'Choose one of the templates:',
  ...Object.entries(TEMPLATE_ALIASES).map(([alias, { description }]) => `- ${chalk.bold(alias)} ${description}`),
]

const git = simpleGit({
  baseDir: process.cwd(),
  binary: 'git',
})

async function directoryIsEmpty(directoryPath: string) {
  try {
    const directory = await asyncFs.opendir(directoryPath)
    const entry = await directory.read()
    await directory.close()
    return entry === null
  } catch (error: any) {
    if (error.code === 'ENOENT') return true
    return false
  }
}

export default class Init extends Command {
  static description = 'Create a new project from template'

  static args = {
    name: Args.string({
      name: 'name',
      required: true,
    }),
  }

  static flags = {
    template: Flags.string({
      char: 't',
      description: TEMPLATE_DESC.join('\n'),
      required: false,
    }),
    dir: Flags.string({
      char: 'd',
      description: 'The target location for the squid. If omitted, a new folder NAME is created.',
      required: false,
    }),
    remove: Flags.boolean({
      char: 'r',
      description: 'Clean up the target directory if it exists',
      required: false,
    }),
  }

  public async run(): Promise<void> {
    const {
      args: { name },
      flags: { template, dir, remove },
    } = await this.parse(Init)
    const localDir = upath.resolve(dir || name)
    const isEmptyDir = await directoryIsEmpty(localDir)
    if (!isEmptyDir) {
      if (!remove) {
        return this.error(
          `The folder "${localDir}" already exists. Use the "-r" flag to init the project at the existing path (will clean the folder first).`,
        )
      }

      await asyncFs.rm(localDir, { recursive: true })
    }

    let resolvedTemplate = template || ''
    if (!template) {
      const { alias } = await inquirer.prompt({
        name: 'alias',
        message: `Please select one of the templates for your "${name}" project:`,
        type: 'list',

        choices: Object.entries(TEMPLATE_ALIASES).map(([name, { description }]) => {
          return {
            name: `${name}. ${chalk.dim(description)}`,
            value: name,
          }
        }),
      })

      resolvedTemplate = alias
    }

    const githubRepository = TEMPLATE_ALIASES[resolvedTemplate] ? TEMPLATE_ALIASES[resolvedTemplate].url : resolvedTemplate

    ux.action.start(`Downloading the template: ${githubRepository}`)
    try {
      await git.clone(githubRepository, localDir, { '--depth': 1 })
    } catch (error: any) {
      return this.error(error)
    }

    ux.action.stop('✔')

    await asyncFs.rm(upath.resolve(localDir, '.git'), { recursive: true })

    this.log(`The project is created in ${localDir} 🎉`)
    this.log('Now run:\n')
    this.log(`  cd ${name}`)
    this.log('  npm install')
  }
}
