import { promises as asyncFs } from 'node:fs'
import path from 'node:path'

import { Command, Flags, Args, ux } from '@oclif/core'
import chalk from 'chalk'
import inquirer from 'inquirer'
import simpleGit from 'simple-git'

const TEMPLATE_ALIASES: Record<string, { url: string; description: string }> = {
  'lens-oracle': {
    url: 'https://github.com/pacoyang/lens-stats',
    description: 'A minimal oracle template for lens.',
  },
  'phat-oracle': {
    url: 'https://github.com/pacoyang/phat-oracle-contract',
    description: 'A phat oracle contract template.',
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

async function directoryIsEmpty(path: string) {
  try {
    const directory = await asyncFs.opendir(path)
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
    const localDir = path.resolve(dir || name)
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
      await git.clone(githubRepository, localDir, {})
    } catch (error: any) {
      return this.error(error)
    }

    ux.action.stop('✔')

    await asyncFs.rm(path.resolve(localDir, '.git'), { recursive: true })

    this.log(`The project is created in ${localDir}`)
  }
}
