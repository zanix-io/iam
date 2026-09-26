import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { must } from '../dom-test-setup.ts'
import { act, createElement, useState } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { Input } from '@zanix/space-ui'
import { createOtpCodeField } from 'ui/components/otp-code-field/render.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'

// Same real-DOM harness `password-toggle-field.test.ts` already establishes — auto-submit and the
// box-mirroring re-render on every keystroke can't be verified from static SSR markup alone.
function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    unmount: () => act(() => root.unmount()),
  }
}

const OtpCodeField = createOtpCodeField<ReactElement>(
  createElement as unknown as CreateElement<ReactElement>,
  { useState },
  { Input: Input as unknown as (props: Record<string, unknown>) => ReactElement },
)

Deno.test('OtpCodeField: SSR — six decorative boxes, one real accessible input, aria-hidden mirror', () => {
  const html = renderToStaticMarkup(
    createElement(OtpCodeField, {
      name: 'code',
      length: 6,
      formId: 'f',
      ariaLabel: 'Verification code',
    }),
  )
  assertStringIncludes(html, 'aria-label="Verification code"')
  assertStringIncludes(html, 'data-space="otp-code-field-boxes"')
  assertEquals((html.match(/data-space="otp-code-field-box"/g) ?? []).length, 6)
  assertStringIncludes(html, 'one-time-code')
  assertStringIncludes(html, 'autofocus=""')
})

Deno.test('OtpCodeField: the real input carries autocomplete/inputmode/maxlength as real DOM properties', () => {
  const { container, unmount } = mount(
    createElement(OtpCodeField, { name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' }),
  )
  const input = must(container.querySelector<HTMLInputElement>('input'))

  assertEquals(input.autocomplete, 'one-time-code')
  assertEquals(input.inputMode, 'numeric')
  assertEquals(input.maxLength, 6)
  assertEquals(input.pattern, '[0-9]*')

  unmount()
})

function typeInto(input: HTMLInputElement, text: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  const nativeSetter = descriptor?.set
  nativeSetter?.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

Deno.test('OtpCodeField: typing digits mirrors them into the decorative boxes, non-digits stripped', () => {
  const { container, unmount } = mount(
    createElement(OtpCodeField, { name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' }),
  )
  const input = must(container.querySelector<HTMLInputElement>('input'))

  act(() => typeInto(input, '1a2b3'))

  const boxes = container.querySelectorAll('[data-space="otp-code-field-box"]')
  assertEquals(boxes[0].textContent, '1')
  assertEquals(boxes[1].textContent, '2')
  assertEquals(boxes[2].textContent, '3')
  assertEquals(boxes[3].textContent, '')

  unmount()
})

Deno.test('OtpCodeField: reaching the full length auto-submits the enclosing form', async () => {
  const form = document.createElement('form')
  form.id = 'otp-form-test'
  document.body.appendChild(form)
  let submitted = false
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    submitted = true
  })

  const { container, unmount } = mount(
    createElement(OtpCodeField, {
      name: 'code',
      length: 6,
      formId: 'otp-form-test',
      ariaLabel: 'Code',
    }),
  )
  form.appendChild(container)
  const input = must(container.querySelector<HTMLInputElement>('input'))

  act(() => typeInto(input, '123456'))
  // The real component schedules `requestSubmit()` inside a `requestAnimationFrame` — flush it.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assertEquals(submitted, true)

  unmount()
  form.remove()
})

Deno.test('OtpCodeField: does not auto-submit before the full length is reached', async () => {
  const form = document.createElement('form')
  form.id = 'otp-form-test-2'
  document.body.appendChild(form)
  let submitted = false
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    submitted = true
  })

  const { container, unmount } = mount(
    createElement(OtpCodeField, {
      name: 'code',
      length: 6,
      formId: 'otp-form-test-2',
      ariaLabel: 'Code',
    }),
  )
  form.appendChild(container)
  const input = must(container.querySelector<HTMLInputElement>('input'))

  act(() => typeInto(input, '123'))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  assertEquals(submitted, false)

  unmount()
  form.remove()
})

Deno.test('OtpCodeField: initialError starts every box in the error state, clears on the next keystroke', () => {
  const { container, unmount } = mount(
    createElement(OtpCodeField, {
      name: 'code',
      length: 6,
      formId: 'f',
      ariaLabel: 'Code',
      initialError: true,
    }),
  )
  const boxesBefore = container.querySelectorAll(
    '[data-space="otp-code-field-box"][data-error="true"]',
  )
  assertEquals(boxesBefore.length, 6)

  const input = must(container.querySelector<HTMLInputElement>('input'))
  act(() => typeInto(input, '1'))

  const boxesAfter = container.querySelectorAll(
    '[data-space="otp-code-field-box"][data-error="true"]',
  )
  assertEquals(boxesAfter.length, 0)

  unmount()
})

Deno.test('OtpCodeField: disabled disables the real input and marks the wrapper via data-disabled', () => {
  const html = renderToStaticMarkup(
    createElement(OtpCodeField, {
      name: 'code',
      length: 6,
      formId: 'f',
      ariaLabel: 'Code',
      disabled: true,
    }),
  )
  assertStringIncludes(html, 'data-disabled="true"')
  assertStringIncludes(html, 'disabled=""')
})

Deno.test('OtpCodeField: omitting disabled renders an enabled field with no disabled attribute', () => {
  const html = renderToStaticMarkup(
    createElement(OtpCodeField, { name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' }),
  )
  assertEquals(html.includes('disabled'), false)
})

// --- Real wiring — the actual `index.ts` binding, including the real defineComet boundary -------

Deno.test('OtpCodeField (index.ts): the real binding renders without throwing', async () => {
  // Side-effect only, scoped to this one test — see `login.test.ts`'s own identical doc for why
  // this registration is deferred rather than a top-level import.
  await import('@zanix/space/react')
  const { OtpCodeField: RealOtpCodeField } = await import('ui/components/otp-code-field/index.ts')
  const markup = renderToStaticMarkup(
    createElement(RealOtpCodeField, { name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' }),
  )
  assertStringIncludes(markup, 'data-space="otp-code-field-boxes"')
})
