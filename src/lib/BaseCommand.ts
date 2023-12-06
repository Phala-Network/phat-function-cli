import { Command } from '@oclif/core'
import chalk from 'chalk'
import ora from 'ora'

abstract class BaseCommand extends Command {
  public spinner = ora()

  get action() {
    return {
      start: (message?: string) => {
        this.spinner.stop()
        this.spinner.start(message)
      },
      stop: () => this.spinner.stop(),
      succeed: (message?: string) =>
        this.spinner.stopAndPersist({
          symbol: chalk.green('✓'),
          text: message,
        }),
      fail: (message?: string) => {
        this.spinner.stopAndPersist({
          symbol: chalk.red('✗'),
          text: message,
        })
      },
      warn: (message?: string) => {
        this.spinner.stopAndPersist({
          symbol: chalk.yellow('!'),
          text: message,
        })
      },
    }
  }
}

export default BaseCommand
