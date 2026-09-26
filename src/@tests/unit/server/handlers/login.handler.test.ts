import { LoginController } from 'server/handlers/login.handler.ts'
import { assertDelegates } from '../../helpers/controller.ts'

Deno.test('LoginController: every route forwards its payload to the matching AuthService method', async () => {
  await assertDelegates(LoginController, [
    {
      method: 'login',
      payload: { body: { email: 'jane@example.com', password: 'secret' } },
      calls: 'loginWithPassword',
      args: ['jane@example.com', 'secret'],
    },
    {
      method: 'loginOtp',
      payload: { params: { email: 'jane@example.com' }, search: { notifier: 'sms' } },
      calls: 'loginWithOTP',
      args: ['jane@example.com', { notifier: 'sms' }],
    },
    {
      method: 'loginOtp',
      payload: { params: { email: 'jane@example.com' }, search: {} },
      calls: 'loginWithOTP',
      args: ['jane@example.com', { notifier: undefined }],
    },
    {
      method: 'loginOtpCallback',
      payload: { body: { email: 'jane@example.com', code: '123456' } },
      calls: 'loginWithOTPCallback',
      args: ['jane@example.com', '123456'],
    },
    {
      method: 'confirmReactivation',
      payload: { body: { reactivationToken: 'reactivation-token' } },
      calls: 'confirmReactivation',
      args: ['reactivation-token'],
    },
    {
      method: 'loginTotpCallback',
      payload: { body: { email: 'jane@example.com', code: '654321' } },
      calls: 'loginWithTOTPCallback',
      args: ['jane@example.com', '654321'],
    },
    {
      method: 'oAuth',
      payload: { params: { oauth: 'google' }, search: { email: 'jane@example.com' } },
      calls: 'loginWithOauth',
      args: ['google', undefined, 'jane@example.com'],
    },
    {
      method: 'oAuthLogin',
      payload: { params: { oauth: 'github' }, body: { code: 'provider-code' } },
      calls: 'loginWithOauthCallback',
      args: ['provider-code', 'github'],
    },
    {
      method: 'oAuthLink',
      payload: { params: { oauth: 'google' }, body: { code: 'provider-code' } },
      calls: 'linkOauth',
      args: ['provider-code', 'google'],
    },
    {
      method: 'oAuthUnlink',
      payload: { params: { oauth: 'github' } },
      calls: 'unlinkOauth',
      args: ['github'],
    },
    { method: 'methods', calls: 'getOwnAuthMethods', args: [] },
    {
      method: 'loginMethods',
      payload: { params: { email: 'jane@example.com' } },
      calls: 'resolveLoginMethods',
      args: ['jane@example.com'],
    },
    {
      method: 'refresh',
      payload: { body: { token: 'refresh-token' } },
      calls: 'refreshTokens',
      args: ['refresh-token'],
    },
    {
      method: 'logout',
      payload: { body: { token: 'refresh-token' } },
      calls: 'revokeToken',
      args: ['refresh-token'],
    },
    { method: 'totpEnroll', calls: 'totpEnroll', args: [] },
    {
      method: 'totpConfirm',
      payload: { body: { secret: 'SECRET', code: '111111' } },
      calls: 'totpConfirm',
      args: ['SECRET', '111111'],
    },
    { method: 'totpDisable', calls: 'disableTotp', args: [] },
    {
      method: 'phoneEnroll',
      payload: { body: { phone: '+14155551234' } },
      calls: 'phoneEnroll',
      args: ['+14155551234'],
    },
    {
      method: 'phoneConfirm',
      payload: { body: { phone: '+14155551234', code: '222222' } },
      calls: 'phoneConfirm',
      args: ['+14155551234', '222222'],
    },
    { method: 'phoneDisable', calls: 'disablePhone', args: [] },
    {
      method: 'setOtpNotifier',
      payload: { body: { notifier: 'whatsapp' } },
      calls: 'setOtpNotifier',
      args: ['whatsapp'],
    },
  ])
})
