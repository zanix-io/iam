// OAuth2 protocol parameter names (`client_id`, `redirect_uri`, ...) are snake_case by spec.
// deno-lint-ignore-file camelcase
import { OAuthProviderController } from 'server/handlers/oauth-provider.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('OAuthProviderController: every route forwards its payload to the matching OAuthProviderService method', async () => {
  const authorize = {
    client_id: 'host-app',
    redirect_uri: 'https://host.example/callback',
    response_type: 'code',
    state: 'opaque',
  }
  const exchange = {
    grant_type: 'authorization_code',
    code: 'auth-code',
    client_id: 'host-app',
    client_secret: 'host-secret',
    redirect_uri: 'https://host.example/callback',
  }
  await assertDelegates(OAuthProviderController, [
    { method: 'authorize', payload: { search: authorize }, calls: 'authorize', args: [authorize] },
    { method: 'token', payload: { body: exchange }, calls: 'exchangeCode', args: [exchange] },
  ])
})
