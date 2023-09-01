import path from 'node:path'
import os from 'node:os'

export function resolveToAbsolutePath(inputPath: string): string {
  const regex = /^~(?=$|[/\\])/
  return path.resolve(inputPath.replace(regex, os.homedir()))
}
