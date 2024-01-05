import os from 'node:os'
import upath from 'upath'

export function resolveToAbsolutePath(inputPath: string): string {
  const regex = /^~(?=$|[/\\])/
  return upath.resolve(inputPath.replace(regex, os.homedir()))
}

export function add0xPrefix(inputStr: string): `0x${string}` {
  if (!inputStr.startsWith('0x')) {
    inputStr = `0x${inputStr}`
  }
  return inputStr as `0x${string}`
}
