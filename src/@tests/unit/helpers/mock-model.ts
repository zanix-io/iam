/**
 * A recording stand-in for a `@zanix/datamaster` Mongoose model, for repository unit tests: every
 * query method records its arguments and returns `{ exec }` resolving to `result`; constructing it
 * (`new Model(data)`) records `data` and `.save()` resolves to the saved document.
 */
export function recordingModel(result: unknown = { acknowledged: true }) {
  const calls: Record<string, unknown[][]> = {}
  const record = (name: string) => (...args: unknown[]) => {
    ;(calls[name] ??= []).push(args)
    return { exec: () => Promise.resolve(result) }
  }
  const created: unknown[] = []
  function Model(this: { save: () => Promise<unknown> }, data: unknown) {
    created.push(data)
    this.save = () => Promise.resolve({ id: 'saved-1', ...(data as object) })
  }
  Object.assign(Model, {
    findById: record('findById'),
    findOne: record('findOne'),
    updateOne: record('updateOne'),
    deleteOne: record('deleteOne'),
    paginate: (...args: unknown[]) => {
      ;(calls.paginate ??= []).push(args)
      return Promise.resolve({ docs: [], total: 0 })
    },
  })
  return { Model: Model as unknown as Record<string, unknown>, calls, created }
}
