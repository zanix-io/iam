import Zanix from '@zanix/core'

/**
 * iam's worker entrypoint — bootstraps this project as a standalone AsyncMQ background-jobs
 * worker instead of an HTTP server (no `Deno.serve()` at all). Always its own separate process
 * from `mod.ts` — never run both entrypoints in the same process. See `@zanix/core`'s own README
 * ("Worker mode") for `Zanix.startWorker()`'s full behavior, including its automatic
 * `SIGINT`/`SIGTERM` handling.
 */
await Zanix.startWorker()
