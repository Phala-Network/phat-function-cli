import { getQuickJS } from 'quickjs-emscripten'

export async function runQuickJs(code: string, args: string[] = []) {
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  const context = runtime.newContext()
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
