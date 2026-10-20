import { OauthService } from 'server/interactors/oauth.interactor.ts'
import { PhoneService } from 'server/interactors/phone.interactor.ts'
import { SessionService } from 'server/interactors/session.interactor.ts'
import { TotpService } from 'server/interactors/totp.interactor.ts'
import { mapGetter, mockAccessor } from './mock.ts'

/**
 * Wires the interactors `AuthService` delegates to (`SessionService`, `TotpService`,
 * `PhoneService`, `OauthService`) to the `providers` and `context` fakes set on `service`, and
 * gives each of them an `interactors` getter that finds its siblings. A test then exercises the
 * real code behind `AuthService` with one set of fakes.
 *
 * Call it after `providers` and `context` are mocked on `service`.
 *
 * @param service The `AuthService` under test, with `providers` and `context` already mocked.
 * @param extra Further `[class, fake]` interactors the code under test requests.
 */
export function wireAuthServices(service: object, extra: [unknown, unknown][] = []) {
  const concerns = [SessionService, TotpService, PhoneService, OauthService]
    .map((Concern) => [Concern, new Concern('ctx-1')] as [unknown, object])
  const interactors = mapGetter([...extra, ...concerns])
  mockAccessor(service, 'interactors', interactors)
  // Read through `service` on every access, so a test that swaps its `providers` or `context`
  // later reaches the interactors it delegates to as well.
  for (const [, instance] of concerns) {
    for (const property of ['providers', 'context']) {
      Object.defineProperty(instance, property, {
        get: () => (service as Record<string, unknown>)[property],
        configurable: true,
      })
    }
    mockAccessor(instance, 'interactors', interactors)
  }
}

/** The `OauthService` that `service` delegates to, to shadow its `getOauthConnector` in a test. */
export function oauthServiceOf(service: object): OauthService {
  return (service as { interactors: { get(key: unknown): unknown } }).interactors.get(
    OauthService,
  ) as OauthService
}
