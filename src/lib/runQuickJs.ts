import { getQuickJS, QuickJSContext } from 'quickjs-emscripten'

import { HttpVerb} from 'then-request'
import request from 'sync-request'

function isHexString(str: string): boolean {
  const regex = /^0x[0-9a-f]+$/
  return regex.test(str.toLowerCase())
}

const hexToString = (hex: string): string => {
  return Buffer.from(hex.substring(2), 'hex').toString()
}

function syncRequest(options: {
  url: string,
  method?: HttpVerb,
  headers?: Record<string, string>,
  body?: string,
  returnTextBody?: boolean,
}) {
  if (options.body && isHexString(options.body)) {
    options.body = hexToString(options.body)
  }
  const res = request(options.method || 'GET', options.url, {
    headers: options.headers,
    body: options.body,
  })
  return {
    statusCode: res.statusCode,
    body: res.getBody(options.returnTextBody ? 'utf8' : '')
  }
}

function polyfillPink(context: QuickJSContext) {
  const pinkHandle = context.newObject()

  const httpRequestHandle = context.newFunction('httpRequest', (args) => {
    const nativeArgs = context.dump(args)
    const res = syncRequest(nativeArgs)
    const resHandle = context.newObject()
    const statusHandle = context.newNumber(res.statusCode)
    context.setProp(resHandle, 'statusCode', statusHandle)
    const bodyHandle = context.newString(res.body)
    context.setProp(resHandle, 'body', bodyHandle)
    return resHandle
  })

  const batchHttpRequestHandle = context.newFunction('batchHttpRequest', (args) => {
    const nativeArgs = context.dump(args)
    const responses = nativeArgs.map(syncRequest)
    const responsesHandle = context.newArray()
    responses.map((res: { statusCode: number, body: string }, i: number) => {
      const resHandle = context.newObject()
      const statusHandle = context.newNumber(res.statusCode)
      context.setProp(resHandle, 'statusCode', statusHandle)
      const bodyHandle = context.newString(res.body)
      context.setProp(resHandle, 'body', bodyHandle)
      context.setProp(responsesHandle, i, resHandle)
      resHandle.dispose()
    })
    return responsesHandle
  })

  context.setProp(pinkHandle, 'httpRequest', httpRequestHandle)
  context.setProp(pinkHandle, 'batchHttpRequest', batchHttpRequestHandle)
  context.setProp(context.global, 'pink', pinkHandle)
  httpRequestHandle.dispose()
  batchHttpRequestHandle.dispose()
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

export async function runQuickJs(code: string, args: string[] = []) {
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  const context = runtime.newContext()
  polyfillConsole(context)
  polyfillPink(context)
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
    context.dispose()
    runtime.dispose()
    throw new Error(error.message)
  }
  context.unwrapResult(result).dispose()
  const output = context.getProp(context.global, 'scriptOutput').consume(context.dump)
  context.dispose()
  runtime.dispose()
  return output
}
