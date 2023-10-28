import { getQuickJS, QuickJSContext } from 'quickjs-emscripten'
import { Arena } from 'quickjs-emscripten-sync'
import {
  blake2AsU8a,
  sha256AsU8a,
  keccak256AsU8a,
} from '@polkadot/util-crypto'

import request, { type HttpMethod } from './sync-request'

function isHexString(str: string): boolean {
  const regex = /^0x[0-9a-f]+$/
  return regex.test(str.toLowerCase())
}

const hexToString = (hex: string): string => {
  return Buffer.from(hex.substring(2), 'hex').toString()
}

function deriveSecret(salt: Uint8Array | string): Uint8Array {
  const buffer = new Uint8Array(4 + (salt instanceof Uint8Array ? salt.length : Buffer.from(salt).length))
  buffer.set([1, 2, 3, 4], 0)
  buffer.set(salt instanceof Uint8Array ? salt : Buffer.from(salt), 4)
  return blake2AsU8a(buffer)
}

function hash(algorithm: string, message: Uint8Array | string): Uint8Array {
  switch (algorithm) {
  case 'blake2b128':
    return blake2AsU8a(message).slice(0, 16)
  case 'blake2b256':
    return blake2AsU8a(message)
  case 'sha256':
    return sha256AsU8a(message)
  case 'keccak256':
    return keccak256AsU8a(message)
  default:
    throw new Error('not supported algorithm: ' + algorithm)
  }
}

function syncRequest(args: {
  url: string
  method?: HttpMethod
  headers?: Record<string, string>
  body?: string
}) {
  if (typeof args.body === 'string' && isHexString(args.body)) {
    args.body = hexToString(args.body)
  }
  return request({
    url: args.url,
    method: args.method || 'GET',
    headers: args.headers,
    body: args.body,
    timeout: 10,
  })
}

function polyfillPink(context: QuickJSContext) {
  const pinkHandle = context.newObject()

  const httpRequestHandle = context.newFunction('httpRequest', (args) => {
    const nativeArgs = context.dump(args)
    const res = syncRequest(nativeArgs)
    const resHandle = context.newObject()
    const statusHandle = context.newNumber(res.statusCode)
    context.setProp(resHandle, 'statusCode', statusHandle)
    let bodyHandle
    if (nativeArgs.returnTextBody) {
      bodyHandle = context.newString(res.body)
    } else {
      bodyHandle = context.unwrapResult(context.evalCode(`new Uint8Array([${new TextEncoder().encode(res.body)}]);`))
    }
    context.setProp(resHandle, 'body', bodyHandle)
    bodyHandle.dispose()
    return resHandle
  })

  const batchHttpRequestHandle = context.newFunction(
    'batchHttpRequest',
    (args) => {
      const nativeArgs = context.dump(args)
      const responses = nativeArgs.map(syncRequest)
      const responsesHandle = context.newArray()
      responses.map((res: { statusCode: number; body: string }, i: number) => {
        const resHandle = context.newObject()
        const statusHandle = context.newNumber(res.statusCode)
        context.setProp(resHandle, 'statusCode', statusHandle)
        let bodyHandle
        if (nativeArgs.returnTextBody) {
          bodyHandle = context.newString(res.body)
        } else {
          bodyHandle = context.unwrapResult(context.evalCode(`new Uint8Array([${new TextEncoder().encode(res.body)}]);`))
        }
        context.setProp(resHandle, 'body', bodyHandle)
        context.setProp(responsesHandle, i, resHandle)
        resHandle.dispose()
      })
      return responsesHandle
    }
  )

  const deriveSecretHandle = context.newFunction(
    'deriveSecret',
    (args) => {
      let salt = context.dump(args)
      if (typeof salt === 'object') {
        salt = new Uint8Array(Object.values(salt))
      }
      return context.evalCode(`new Uint8Array([${deriveSecret(salt)}]);`)
    }
  )

  const hashHandle = context.newFunction(
    'hash',
    (...args) => {
      const nativeArgs = args.map(context.dump)
      const algorithm = nativeArgs[0]
      let message = nativeArgs[1]
      if (typeof message === 'object') {
        message = new Uint8Array(Object.values(message))
      }
      return context.evalCode(`new Uint8Array([${hash(algorithm, message)}]);`)
    }
  )

  context.setProp(pinkHandle, 'httpRequest', httpRequestHandle)
  context.setProp(pinkHandle, 'batchHttpRequest', batchHttpRequestHandle)
  context.setProp(pinkHandle, 'deriveSecret', deriveSecretHandle)
  context.setProp(pinkHandle, 'hash', hashHandle)
  context.setProp(context.global, 'pink', pinkHandle)
  httpRequestHandle.dispose()
  batchHttpRequestHandle.dispose()
  deriveSecretHandle.dispose()
  hashHandle.dispose()
  pinkHandle.dispose()
}

function polyfillConsole(context: QuickJSContext) {
  const consoleHandle = context.newObject()

  const infoHandle = context.newFunction('info', (...args) => {
    const nativeArgs = args.map(context.dump)
    console.info(...nativeArgs)
  })
  context.setProp(consoleHandle, 'info', infoHandle)

  const logHandle = context.newFunction('log', (...args) => {
    const nativeArgs = args.map(context.dump)
    console.log(...nativeArgs)
  })
  context.setProp(consoleHandle, 'log', logHandle)

  const warnHandle = context.newFunction('warn', (...args) => {
    const nativeArgs = args.map(context.dump)
    console.warn(...nativeArgs)
  })
  context.setProp(consoleHandle, 'warn', warnHandle)

  const errorHandle = context.newFunction('error', (...args) => {
    const nativeArgs = args.map(context.dump)
    console.error(...nativeArgs)
  })
  context.setProp(consoleHandle, 'error', errorHandle)

  const debugHandle = context.newFunction('debug', (...args) => {
    const nativeArgs = args.map(context.dump)
    console.debug(...nativeArgs)
  })
  context.setProp(consoleHandle, 'debug', debugHandle)

  context.setProp(context.global, 'console', consoleHandle)
  consoleHandle.dispose()
  infoHandle.dispose()
  logHandle.dispose()
  warnHandle.dispose()
  errorHandle.dispose()
  debugHandle.dispose()
}

function polyfillTextCoder(arena: Arena) {
  const exposed = {
    encode: (input: string) => {
      return (new TextEncoder().encode(input))
    },
    encodeInto: (input: string, u8array: Record<string, number>) => {
      const dest = new Uint8Array(Object.values(u8array))
      const result = new TextEncoder().encodeInto(input, dest)
      for (let i = 0; i < dest.length; i++) {
        u8array[i] = dest[i]
      }
      return result
    },
    decode: (buffer: object) => {
      return (new TextDecoder().decode(new Uint8Array(Object.values(buffer))))
    },
  }
  arena.expose(exposed)
  arena.evalCode(`
    class TextEncoder {
      get encoding() {
        return 'utf-8'
      }

      encode(input) {
        return new Uint8Array(Object.values(encode(input)))
      }

      encodeInto(src, dest) {
        return encodeInto(src, dest)
      }
    }

    class TextDecoder {
      constructor(encoding = 'utf-8') {
        if (encoding !== 'utf-8') {
          throw new TypeError('Only utf-8 encoding is supported')
        }
      }

      decode(bytes, options) {
        return decode(bytes)
      }
    }
  `)
}

function polyfillSilentConsole(context: QuickJSContext) {
  const consoleHandle = context.newObject()

  const handle = context.newFunction('info', () => {})
  context.setProp(consoleHandle, 'info', handle)
  context.setProp(consoleHandle, 'log', handle)
  context.setProp(consoleHandle, 'warn', handle)
  context.setProp(consoleHandle, 'error', handle)
  context.setProp(consoleHandle, 'debug', handle)

  context.setProp(context.global, 'console', consoleHandle)
  consoleHandle.dispose()
  handle.dispose()
}

export async function runQuickJs(
  code: string,
  args: string[] = [],
  options = { silent: false }
) {
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  const context = runtime.newContext()
  const arena = new Arena(context, { isMarshalable: true })

  if (options.silent) {
    polyfillSilentConsole(context)
  } else {
    polyfillConsole(context)
  }

  polyfillPink(context)
  polyfillTextCoder(arena)

  const scriptArgs = context.newArray()
  args.map((arg, i) => {
    const handle = context.newString(arg)
    context.setProp(scriptArgs, i, handle)
    handle.dispose()
  })
  context.setProp(context.global, 'scriptArgs', scriptArgs)
  scriptArgs.dispose()
  const result = context.evalCode(code)
  if (result.error) {
    const error = context.dump(result.error)
    result.error.dispose()
    arena.dispose()
    context.dispose()
    runtime.dispose()
    throw new Error(error.message)
  }
  context.unwrapResult(result).dispose()
  const output = context
    .getProp(context.global, 'scriptOutput')
    .consume(context.dump)
  arena.dispose()
  context.dispose()
  runtime.dispose()
  return output
}
