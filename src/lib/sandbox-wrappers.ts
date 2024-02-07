import { QuickJSDeferredPromise, QuickJSContext } from 'quickjs-emscripten'

let promiseId = 0
const openPromises: Record<string, any> = {}

export function wrapPromise(
  vm: QuickJSContext,
  promise: Promise<any>,
  beginAsyncProcess: () => void,
  endAsyncProcess: () => void
): any {
  promiseId += 1

  const vmPromise = vm.newPromise() as QuickJSDeferredPromise & { _promiseId: number }
  vmPromise._promiseId = promiseId
  beginAsyncProcess()
  promise
    .then((...args) => {
      endAsyncProcess()
      const wrappedArgs = args.map((arg) =>
        wrap(vm, arg, undefined, beginAsyncProcess, endAsyncProcess)
      )
      openPromises[vmPromise._promiseId] = null
      vmPromise.resolve(...wrappedArgs)
      wrappedArgs.forEach((arg) => arg.dispose())
    })
    .catch((...args) => {
      const wrappedArgs = args.map((arg) =>
        wrap(vm, arg, undefined, beginAsyncProcess, endAsyncProcess)
      )
      vmPromise.reject(...wrappedArgs)
      wrappedArgs.forEach((arg) => arg.dispose())
      openPromises[vmPromise._promiseId] = null
    })
  vmPromise.settled.then(() => {
    endAsyncProcess()
    vm.runtime.executePendingJobs()
  })

  openPromises[promiseId] = vmPromise

  return vmPromise.handle
}

export function rejectOpenPromises(vm: QuickJSContext) {
  for (const [id, promise] of Object.entries(openPromises)) {
    if (promise !== null) {
      (promise as QuickJSDeferredPromise).reject(vm.newError('Shutting down'))
      openPromises[id] = null
    }
  }

  vm.runtime.executePendingJobs()
}

export function wrap(
  vm: QuickJSContext,
  value: any,
  context: Record<string, any> | undefined,
  beginAsyncProcess: () => void,
  endAsyncProcess: () => void
): any {
  if (value === null) {
    return null
  } else if (typeof value === 'object' && typeof value.then === 'function') {
    return wrapPromise(vm, value, beginAsyncProcess, endAsyncProcess)
  } else if (typeof value === 'function') {
    return wrapGenericFunction(
      vm,
      value,
      context,
      beginAsyncProcess,
      endAsyncProcess
    )
  } else if (Array.isArray(value)) {
    return wrapArray(vm, value, beginAsyncProcess, endAsyncProcess)
  } else if (typeof value === 'object') {
    return wrapObject(vm, value, beginAsyncProcess, endAsyncProcess)
  } else if (typeof value === 'string') {
    return vm.newString(value)
  } else if (typeof value === 'number') {
    return vm.newNumber(value)
  } else if (typeof value === 'bigint') {
    return vm.newBigInt(value)
  } else if (typeof value === 'boolean') {
    return vm.unwrapResult(vm.evalCode(value ? 'true' : 'false'))
  } else if (typeof value === 'undefined') {
    return vm.undefined
  } else {
    return null
  }
}

export function wrapObject(
  vm: QuickJSContext,
  obj: any,
  beginAsyncProcess: () => void,
  endAsyncProcess: () => void
): any {
  const vmObject = vm.newObject()

  for (const key in obj) {
    const value = obj[key]
    const wrappedValue = wrap(vm, value, obj, beginAsyncProcess, endAsyncProcess)

    if (wrappedValue !== null) {
      vm.setProp(vmObject, key, wrappedValue)
      if (
        wrappedValue != vm.undefined &&
        wrappedValue != vm.null &&
        wrappedValue.dispose
      ) {
        wrappedValue.dispose()
      }
    }
  }

  return vmObject
}

export function wrapArray(
  vm: QuickJSContext,
  arr: any[],
  beginAsyncProcess: () => void,
  endAsyncProcess: () => void
): any {
  const vmArray = vm.newArray()

  for (let i = 0; i < arr.length; i++) {
    const wrappedValue = wrap(vm, arr[i], arr, beginAsyncProcess, endAsyncProcess)
    vm.setProp(vmArray, i, wrappedValue)
    if (wrappedValue != vm.undefined && wrappedValue != vm.null) {
      wrappedValue.dispose()
    }
  }

  return vmArray
}

export function wrapGenericFunction(
  vm: QuickJSContext,
  fn: any,
  context: any = undefined,
  beginAsyncProcess: () => void,
  endAsyncProcess: () => void
): any {
  const vmFn = vm.newFunction(fn.name, (...args: any) => {
    const unwrappedArgs: any[] = args.map(vm.dump)
    try {
      const result = fn.call(context, ...unwrappedArgs)
      const wrappedResult = wrap(
        vm,
        result,
        undefined,
        beginAsyncProcess,
        endAsyncProcess
      )
      return wrappedResult
    } catch (e) {
      console.log('Error', e)
    }
  })
  return vmFn
}

export function injectTimingFunctions(
  vm: QuickJSContext,
  cbAddedTimer: any,
  cbRemovedTimer: any,
  maxTimeout = 600000
): void {
  const timeoutFunctionHandles: any = {}
  const _setTimeout = vm.newFunction(
    'setTimeout',
    (vmFnHandle: any, timeoutHandle: any) => {
      // Make a copy because otherwise vmFnHandle does not live long enough to call after the timeout
      const vmFnHandleCopy = vmFnHandle.dup()
      let timeout = vm.dump(timeoutHandle)

      // cap timeout at max timeout
      if (timeout > maxTimeout) {
        timeout = maxTimeout
      }

      cbAddedTimer()
      const timeoutID = setTimeout(() => {
        timeoutFunctionHandles[timeoutID.toString()] = null
        // callFunction(vmFnHandleCopy) will call the vm function
        // in the context of the vm
        // we pass vm.undefined because we need to pass something for the "this" argument
        cbRemovedTimer()
        vm.callFunction(vmFnHandleCopy, vm.undefined)
        vmFnHandleCopy.dispose()
        vm.runtime.executePendingJobs()
      }, timeout)
      timeoutFunctionHandles[timeoutID.toString()] = vmFnHandleCopy

      return vm.newNumber((timeoutID as unknown) as number)
    }
  )

  vm.setProp(vm.global, 'setTimeout', _setTimeout)
  _setTimeout.dispose()
  const intervalFunctionHandles: Record<string, any> = {}
  const _setInterval = vm.newFunction(
    'setInterval',
    (vmFnHandle, timeoutHandle) => {
      // Make a copy because otherwise vmFnHandle does not live long enough to call after the timeout
      const vmFnHandleCopy = vmFnHandle.dup()
      let timeout = vm.dump(timeoutHandle)

      // cap timeout at max timeout
      if (timeout > maxTimeout) {
        timeout = maxTimeout
      }

      const maxRepetitions = 99
      let repetitions = 0
      cbAddedTimer()
      const intervalId = setInterval(() => {
        repetitions += 1
        intervalFunctionHandles[intervalId.toString()] = null

        // callFunction(vmFnHandleCopy) will call the vm function
        // in the context of the vm
        // we pass vm.undefined because we need to pass something for the "this" argument
        vm.callFunction(vmFnHandleCopy, vm.undefined)
        vm.runtime.executePendingJobs()

        if (repetitions > maxRepetitions) {
          console.log('Sandbox interval exceeded max repetitions')
          clearInterval(intervalId)
          cbRemovedTimer()
          return
        }
      }, timeout)
      intervalFunctionHandles[intervalId.toString()] = vmFnHandleCopy

      return vm.newNumber((intervalId as unknown) as number)
    }
  )
  vm.setProp(vm.global, 'setInterval', _setInterval)
  _setInterval.dispose()

  const _clearTimeout = vm.newFunction(
    'clearTimeout',
    (timeoutIdHandle: any) => {
      const timeoutId = vm.dump(timeoutIdHandle)
      const timeoutHandle = timeoutFunctionHandles[timeoutId.toString()]
      if (timeoutHandle) {
        cbRemovedTimer()
        timeoutHandle.dispose()
        clearTimeout(timeoutId)
      }
    }
  )
  vm.setProp(vm.global, 'clearTimeout', _clearTimeout)
  _clearTimeout.dispose()

  const _clearInterval = vm.newFunction(
    'clearInterval',
    (intervalIdHandle: any) => {
      const intervalId = vm.dump(intervalIdHandle)
      const intervalHandle = intervalFunctionHandles[intervalId.toString()]
      if (intervalId) {
        cbRemovedTimer()
        intervalHandle.dispose()
        clearInterval(intervalId)
      }
    }
  )
  vm.setProp(vm.global, 'clearInterval', _clearInterval)
  _clearInterval.dispose()
}
