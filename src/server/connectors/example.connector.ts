import { Connector, ZanixConnector } from '@zanix/server'

/**
 * A `Connector` wraps the lifecycle of a connection to an external service — a REST API, a
 * third-party SDK, anything not already covered by a companion package.
 *
 * **When to use this**: only for integrations no companion package already covers. If you're
 * connecting to MongoDB/Redis/a KV store, use `@zanix/datamaster`'s connectors instead; for
 * RabbitMQ/queues, use `@zanix/asyncmq`'s.
 *
 * **How it's used**: the framework calls `initialize()`/`close()`/`isHealthy()` automatically
 * during the app's startup/shutdown lifecycle (see `@Connector`'s `startMode`/`lifetime`/
 * `autoInitialize` options to control when/how that happens).
 */
@Connector()
export class ExampleConnector extends ZanixConnector {
  /** Establishes the connection to the external service. */
  protected override initialize(): void {
    // Establish the connection to the external service here.
  }

  /** Tears down the connection to the external service. */
  protected override close(): void {
    // Tear down the connection here.
  }

  /** Whether the connection is currently usable. */
  public override isHealthy(): boolean {
    return true
  }
}
