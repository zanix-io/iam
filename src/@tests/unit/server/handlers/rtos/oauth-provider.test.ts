// OAuth2 protocol parameter names (`client_id`, `redirect_uri`, ...) are snake_case by spec.
// deno-lint-ignore-file camelcase
import { assertEquals } from 'jsr:@std/assert@0.224'
import { OAuthAuthorizeRTO, OAuthTokenExchangeRTO } from 'server/handlers/rtos/oauth-provider.ts'
import { assertInvalid, validate } from '../../../helpers/rto.ts'

const authorize = {
  client_id: 'host-app',
  redirect_uri: 'https://host.example/callback',
  response_type: 'code',
}

Deno.test('OAuthAuthorizeRTO: accepts the code flow with an optional state', async () => {
  assertEquals((await validate(OAuthAuthorizeRTO, authorize)).state, undefined)
  assertEquals((await validate(OAuthAuthorizeRTO, { ...authorize, state: 'x' })).state, 'x')
})

Deno.test('OAuthAuthorizeRTO: rejects the implicit flow and a non-URL redirect_uri', async () => {
  await assertInvalid(OAuthAuthorizeRTO, {
    ...authorize,
    response_type: 'token',
    redirect_uri: 'not a url',
  }, ['response_type', 'redirect_uri'])
})

Deno.test('OAuthTokenExchangeRTO: accepts only grant_type=authorization_code with every field', async () => {
  const exchange = {
    grant_type: 'authorization_code',
    code: 'c',
    client_id: 'host-app',
    client_secret: 's',
    redirect_uri: 'https://host.example/callback',
  }
  assertEquals((await validate(OAuthTokenExchangeRTO, exchange)).code, 'c')
  await assertInvalid(OAuthTokenExchangeRTO, { grant_type: 'client_credentials' }, [
    'grant_type',
    'code',
    'client_id',
    'client_secret',
    'redirect_uri',
  ])
})
