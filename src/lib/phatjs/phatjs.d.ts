/* tslint:disable */
/* eslint-disable */
/**
*/
export function start(): void;
/**
* Get the version of the runtime.
* @returns {Promise<string>}
*/
export function version(): Promise<string>;
/**
* Run a script.
*
* # Arguments
* - `args` - a list of arguments to pass to the runtime, including the script name and arguments.
*
* # Example
*
* ```js
* const result = await run(["phatjs", "-c", "console.log(scriptArgs)", "--", "Hello, world!"]);
* console.log(result);
* ```
* @param {(string)[]} args
* @returns {Promise<any>}
*/
export function run(args: (string)[]): Promise<any>;
/**
* Set a hook for the runtime.
*
* # Available hooks
* - `fetch` - a function that takes a `Request` object and returns a `Response` object.
* @param {string} hook_name
* @param {any} hook_value
*/
export function setHook(hook_name: string, hook_value: any): void;
export function init(): void;
