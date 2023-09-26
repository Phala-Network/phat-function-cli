import fs from 'node:fs'
import upath from 'upath'
import { Command } from '@oclif/core'
import inquirer from 'inquirer'
import fetch from 'node-fetch'
import {
  OnChainRegistry,
} from '@phala/sdk'
import { Keyring } from '@polkadot/keyring'
import { type KeyringPair } from '@polkadot/keyring/types'

export default abstract class PhatCommandBase extends Command {
  async getDecodedPair({ suri, accountFilePath }: { suri?: string, accountFilePath?: string }): Promise<KeyringPair> {
    const keyring = new Keyring({ type: 'sr25519' })
    let pair: KeyringPair

    if (suri) {
      pair = keyring.addFromUri(suri)
    } else if (accountFilePath) {
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
    } else {
      this.error('Please specify suri or accountFilePath.')
    }

    if (pair.isLocked) {
      pair = await this.requestPairDecoding(pair)
    }

    return (await this.requestPairDecoding(pair))
  }

  async promptForPassword(
    message = `Your account's password`
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

  async requestPairDecoding(
    pair: KeyringPair,
    message?: string
  ): Promise<KeyringPair> {
    if (!pair.isLocked) {
      return pair
    }

    // Try decoding using empty string
    try {
      pair.decodePkcs8('')
      return pair
    } catch (e) {
      // Continue
    }

    let isPassValid = false
    while (!isPassValid) {
      try {
        const password = await this.promptForPassword(
          message ||
            `Enter ${
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
    const url = `https://phala-network.github.io/phat-contract-artifacts/artifacts/${codeHashWithPrefix}/metadata.json`
    const resp = await fetch(url)
    if (resp.status !== 200) {
      this.error(`Failed to get abi from GitHub: ${resp.status}`)
    }
    const text = await resp.text()
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    fs.writeFileSync(abiPath, text)
    return text
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
