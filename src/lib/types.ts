export interface WaitPRuntimeFinalized {
  <T>(awaitable: Promise<T>, predicate?: () => Promise<boolean>): Promise<T>
}
