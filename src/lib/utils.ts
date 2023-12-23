import os from 'node:os'
import upath from 'upath'
import type { OnChainRegistry } from '@phala/sdk'

import { WaitPRuntimeFinalized } from './types'

export function resolveToAbsolutePath(inputPath: string): string {
  const regex = /^~(?=$|[/\\])/
  return upath.resolve(inputPath.replace(regex, os.homedir()))
}

export function bindWaitPRuntimeFinalized(
  phatRegistry: OnChainRegistry,
  confirmations = 10,
  pollingIntervalMs = 1000
): WaitPRuntimeFinalized {
  return async function waitPRuntimeFinalized<T>(
    awaitable: Promise<T>,
    predicate?: () => Promise<boolean>
  ) {
    const { blocknum: initBlockNum } = await phatRegistry.phactory.getInfo({})
    const result = await awaitable
    while (true) {
      const { blocknum } = await phatRegistry.phactory.getInfo({})
      if (blocknum > initBlockNum + confirmations) {
        if (!predicate) {
          return result
        }
        throw new Error(
          `Wait for transaction finalized in PRuntime but timeout after ${confirmations} blocks.`
        )
      }
      if (predicate) {
        const predicateResult = await predicate()
        if (predicateResult) {
          return result
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs))
    }
  }
}
