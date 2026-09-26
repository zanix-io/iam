import { assertEquals } from 'jsr:@std/assert@0.224'
import {
  deliverableOtpChannels,
  parseOtpChannel,
  resolveOtpChannel,
  withOtpChannelParam,
} from '../../../sdk/otp-channel.ts'

Deno.test('parseOtpChannel: only the three known channels', () => {
  for (const channel of ['email', 'sms', 'whatsapp']) {
    assertEquals(parseOtpChannel(channel), channel)
  }
  for (const bad of ['', 'SMS', 'fax', null, undefined]) {
    assertEquals(parseOtpChannel(bad), undefined)
  }
})

Deno.test('resolveOtpChannel: a valid param wins, else the account default', () => {
  assertEquals(resolveOtpChannel(new URLSearchParams('channel=sms'), 'email'), 'sms')
  assertEquals(resolveOtpChannel(new URLSearchParams('channel=bogus'), 'whatsapp'), 'whatsapp')
  assertEquals(resolveOtpChannel(new URLSearchParams(''), 'email'), 'email')
})

Deno.test('withOtpChannelParam: appends with the right separator, and does nothing without a channel', () => {
  assertEquals(withOtpChannelParam('/es/login/otp/a', 'sms'), '/es/login/otp/a?channel=sms')
  assertEquals(withOtpChannelParam('/p?x=1', 'email'), '/p?x=1&channel=email')
  assertEquals(withOtpChannelParam('/p', undefined), '/p')
})

Deno.test('deliverableOtpChannels: email always, the phone channels only with a verified phone', () => {
  assertEquals(deliverableOtpChannels(false), ['email'])
  assertEquals(deliverableOtpChannels(undefined), ['email'])
  assertEquals(deliverableOtpChannels(true), ['email', 'sms', 'whatsapp'])
})
