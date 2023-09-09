import os from 'node:os'
import upath from 'upath'

export function resolveToAbsolutePath(inputPath: string): string {
  const regex = /^~(?=$|[/\\])/
  return upath.resolve(inputPath.replace(regex, os.homedir()))
}
