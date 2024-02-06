import { QuickJSWASMModule } from 'quickjs-emscripten'
import {
  injectTimingFunctions,
  wrap,
  wrapObject,
} from './sandbox-wrappers'

export default async function createSandbox(
  QuickJS: QuickJSWASMModule,
  requireLookup: Record<string, any> = {},
  globals: Record<string, any> = {},
  options: Record<string, any> = {},
) {
  const vm = QuickJS.newContext()

  let errorState = false
  let lastError = ''

  let asyncProcessesRunning = 0

  const beginAsyncProcess = () => {
    asyncProcessesRunning++
  }

  const endAsyncProcess = () => {
    if (asyncProcessesRunning > 0) {
      asyncProcessesRunning--
    }
  }

  const isAsyncProcessRunning = () => {
    return asyncProcessesRunning > 0
  }

  const consoleHandle = vm.newObject()
  const exportsHandle = vm.newObject()

  const logHandle = vm.newFunction('log', (...args) => {
    const nativeArgs = args.map(vm.dump)
    console.log(...nativeArgs)
  })

  const infoHandle = vm.newFunction('info', (...args) => {
    const nativeArgs = args.map(vm.dump)
    console.info(...nativeArgs)
  })

  const warnHandle = vm.newFunction('warn', (...args) => {
    const nativeArgs = args.map(vm.dump)
    console.warn(...nativeArgs)
  })

  const debugHandle = vm.newFunction('debug', (...args) => {
    const nativeArgs = args.map(vm.dump)
    console.debug(...nativeArgs)
  })

  const errorHandle = vm.newFunction('error', (...args) => {
    try {
      const nativeArgs = args.map(vm.dump)
      console.error(...nativeArgs)
      lastError = JSON.stringify(nativeArgs)
      errorState = true
    } catch (e) {
      console.log('Error in error:', e)
    }
  })

  const globalNames = Object.getOwnPropertyNames(globals)
  for (let i = 0; i < globalNames.length; i++) {
    const globalOption: any = globals[globalNames[i]]
    const globalObj = wrap(vm, globalOption.value, globalOption, beginAsyncProcess, endAsyncProcess)

    vm.setProp(vm.global, globalNames[i], globalObj)
    globalObj.dispose()
  }

  injectTimingFunctions(vm, beginAsyncProcess, endAsyncProcess)

  const requireHandle = vm.newFunction('require', (...args: any) => {
    const nativeArgs = args.map(vm.dump)
    if(requireLookup[nativeArgs[0] as string]) {
      const returnObj = wrapObject(vm, requireLookup[nativeArgs[0] as string], beginAsyncProcess, endAsyncProcess)
      return returnObj
    } else {
      return vm.undefined
    }
  })

  if (options.silent) {
    const handle = vm.newFunction('log', () => {})
    vm.setProp(consoleHandle, 'log', handle)
    vm.setProp(consoleHandle, 'info', handle)
    vm.setProp(consoleHandle, 'warn', handle)
    vm.setProp(consoleHandle, 'error', handle)
    vm.setProp(consoleHandle, 'debug', handle)
    handle.dispose()
  } else {
    vm.setProp(consoleHandle, 'log', logHandle)
    vm.setProp(consoleHandle, 'info', infoHandle)
    vm.setProp(consoleHandle, 'warn', warnHandle)
    vm.setProp(consoleHandle, 'debug', debugHandle)
    vm.setProp(consoleHandle, 'error', errorHandle)
    logHandle.dispose()
    infoHandle.dispose()
    warnHandle.dispose()
    debugHandle.dispose()
    errorHandle.dispose()
  }

  vm.setProp(vm.global, 'console', consoleHandle)
  vm.setProp(vm.global, 'require', requireHandle)
  vm.setProp(vm.global, 'exports', exportsHandle)

  consoleHandle.dispose()
  requireHandle.dispose()
  exportsHandle.dispose()

  return {
    vm,
    getLastError: () => {
      return lastError
    },
    isAsyncProcessRunning,
    run: (compiled: string): boolean => {
      try {
        errorState = false
        const result = vm.evalCode(compiled)

        if (result.error) {
          // log out the compiled program with line numbers
          const lines = compiled.split('\n')
          for (let i = 0; i < lines.length; i++) {
            console.log(`${i + 1}: ${lines[i]}`)
          }

          console.log('Execution failed:', vm.dump(result.error))

          result.error.dispose()
          return false
        } else {
          result.value.dispose()

          if (errorState) {
            const lines = compiled.split('\n')
            for (let i = 0; i < lines.length; i++) {
              console.log(`${i + 1}: ${lines[i]}`)
            }
          }
          return !errorState
        }
      } catch (e) {
        console.log(e)
      }

      return false
    },
  }
}
