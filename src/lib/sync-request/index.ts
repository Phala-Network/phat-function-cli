import type { Dispatcher } from 'undici'

export type HttpMethod = Dispatcher.HttpMethod

const rpc = require('sync-rpc')
const remote = rpc(require.resolve('./worker'))

export default function (
  options: Omit<Dispatcher.RequestOptions, 'path'> & {
    url: string
    timeout: number
  }
) {
  return remote(options)
}
