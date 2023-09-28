import fs from 'node:fs'
import upath from 'upath'
import { Command } from '@oclif/core'
import inquirer from 'inquirer'
import {
  OnChainRegistry,
  unsafeGetAbiFromGitHubRepoByCodeHash,
} from '@phala/sdk'
import { Keyring } from '@polkadot/keyring'
import { type KeyringPair } from '@polkadot/keyring/types'

export default abstract class PhatCommandBase extends Command {
  async getDecodedPair({ suri, accountFilePath, accountPassword }: { suri?: string, accountFilePath?: string, accountPassword?: string }): Promise<KeyringPair> {
    const keyring = new Keyring({ type: 'sr25519' })
    let pair: KeyringPair

    if (accountFilePath) {
      if (!fs.existsSync(accountFilePath)) {
        this.error(
          `Keypair account json file does not exist: ${accountFilePath}`
        )
      }

      if (upath.extname(accountFilePath) !== '.json') {
        this.error(
          `Keypair account json file is invalid: File extension should be .json: ${accountFilePath}`
        )
      }

      const exported = fs.readFileSync(
        upath.resolve(accountFilePath),
        'utf8'
      )
      pair = keyring.createFromJson(JSON.parse(exported))
    } else if (suri) {
      pair = keyring.addFromUri(suri)
    } else {
      pair = keyring.addFromUri((await this.promptForSuri()))
    }

    if (pair.isLocked) {
      pair = await this.requestPairDecoding(pair, {
        password: accountPassword,
      })
    }

    return pair
  }

  async requestPairDecoding(
    pair: KeyringPair,
    options: {
      password?: string,
      message?: string
    }
  ): Promise<KeyringPair> {
    if (!pair.isLocked) {
      return pair
    }

    // Try decoding using empty string
    try {
      pair.decodePkcs8(options.password || '')
      return pair
    } catch (e) {
      // Continue
    }

    let isPassValid = false
    while (!isPassValid) {
      try {
        const password = await this.promptForPassword(
          options.message ||
            `Please Enter ${
              pair.meta.name ? pair.meta.name : pair.address
            } account password`
        )
        pair.decodePkcs8(password)
        isPassValid = true
      } catch (e) {
        this.warn('Invalid password, try again.')
      }
    }
    return pair
  }

  async promptForPassword(
    message = `Please enter your account password`
  ): Promise<string> {
    const { password } = await inquirer.prompt([
      {
        name: 'password',
        type: 'password',
        message,
      },
    ])
    return password
  }

  async promptForSuri(
    message = `Please enter your substrate uri`
  ): Promise<string> {
    const { suri } = await inquirer.prompt([
      {
        name: 'suri',
        type: 'input',
        message,
      },
    ])
    return suri
  }

  async loadAbiByCodeHash(codeHash: string) {
    const dirPath = upath.join(
      process.cwd(),
      '.phat',
      'abis',
    )
    const abiPath = upath.join(
      dirPath,
      `${codeHash}.json`
    )
    if (fs.existsSync(abiPath)) {
      return fs.readFileSync(abiPath, 'utf8')
    }
    const codeHashWithPrefix =
      codeHash && codeHash.indexOf('0x') !== 0 ? `0x${codeHash}` : codeHash
    const abi = await unsafeGetAbiFromGitHubRepoByCodeHash(codeHashWithPrefix)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    fs.writeFileSync(abiPath, JSON.stringify(abi))
    return abi
  }

  async loadAbiByContractId(registry: OnChainRegistry, contractId: string) {
    const contractInfo = await registry.phactory.getContractInfo({
      contracts: [contractId],
    })
    if (!contractInfo.contracts.length || !contractInfo.contracts[0].codeHash) {
      this.error(`Contract code hash not found: Contract ID: ${contractId}`)
    }
    const codeHash = contractInfo.contracts[0].codeHash
    const codeHashWithPrefix =
      codeHash && codeHash.indexOf('0x') !== 0 ? `0x${codeHash}` : codeHash
    const abi = await this.loadAbiByCodeHash(codeHashWithPrefix)
    return abi
  }

}
