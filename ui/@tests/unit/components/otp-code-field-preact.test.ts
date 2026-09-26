import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@0.224'
import { must } from '../dom-test-setup.ts'
import { h, render as renderDOM } from 'preact'
import type { VNode } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { render as renderToString } from 'preact-render-to-string'
import { Input } from '@zanix/space-ui/preact'
import { createOtpCodeField } from 'ui/components/otp-code-field/render.ts'
import type { OtpCodeFieldProps } from 'ui/components/otp-code-field/types.ts'
import type { CreateElement } from 'ui/typings/renderer.ts'

const OtpCodeField = createOtpCodeField<VNode>(
  h as unknown as CreateElement<VNode>,
  { useState },
  { Input: Input as unknown as (props: Record<string, unknown>) => VNode },
)

function element(props: OtpCodeFieldProps): VNode {
  return h(OtpCodeField, props) as VNode
}

function mount(props: OtpCodeFieldProps) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => renderDOM(element(props), container))
  return {
    container,
    unmount: () => act(() => renderDOM(null, container)),
  }
}

function typeInto(input: HTMLInputElement, text: string) {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

Deno.test('OtpCodeField (preact): SSR — six decorative boxes, aria-hidden mirror', () => {
  const html = renderToString(element({ name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' }))
  assertStringIncludes(html, 'data-space="otp-code-field-boxes"')
  assertEquals((html.match(/data-space="otp-code-field-box"/g) ?? []).length, 6)
})

Deno.test('OtpCodeField (preact): typing digits mirrors them into the decorative boxes, non-digits stripped', () => {
  const { container, unmount } = mount({ name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' })
  const input = must(container.querySelector<HTMLInputElement>('input'))

  act(() => typeInto(input, '9x8y7'))

  const boxes = container.querySelectorAll('[data-space="otp-code-field-box"]')
  assertEquals(boxes[0].textContent, '9')
  assertEquals(boxes[1].textContent, '8')
  assertEquals(boxes[2].textContent, '7')

  unmount()
})

Deno.test('OtpCodeField (preact): reaching the full length auto-submits the enclosing form', async () => {
  const form = document.createElement('form')
  form.id = 'otp-form-preact-test'
  document.body.appendChild(form)
  let submitted = false
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    submitted = true
  })

  const { container, unmount } = mount({
    name: 'code',
    length: 6,
    formId: 'otp-form-preact-test',
    ariaLabel: 'Code',
  })
  form.appendChild(container)
  const input = must(container.querySelector<HTMLInputElement>('input'))

  act(() => typeInto(input, '654321'))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assertEquals(submitted, true)

  unmount()
  form.remove()
})

// Real DOM `paste` dispatch works fine under Preact (unlike React's own synthetic paste plugin,
// which hangs against a plain bridged `Event` — see `@zanix/space-ui`'s own `input.test.tsx` doc
// for the full account; this file's own React sibling verifies `onPaste` at the factory level
// instead, for that reason).
Deno.test('OtpCodeField (preact): pasting REPLACES the whole value rather than inserting at the cursor', () => {
  const { container, unmount } = mount({ name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' })
  const input = must(container.querySelector<HTMLInputElement>('input'))

  act(() => typeInto(input, '12'))
  let boxes = container.querySelectorAll('[data-space="otp-code-field-box"]')
  assertEquals(boxes[0].textContent, '1')
  assertEquals(boxes[1].textContent, '2')

  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => '987654' } })
  act(() => {
    input.dispatchEvent(event)
  })

  boxes = container.querySelectorAll('[data-space="otp-code-field-box"]')
  assertEquals(boxes[0].textContent, '9')
  assertEquals(boxes[1].textContent, '8')
  assertEquals(boxes[5].textContent, '4')

  unmount()
})

Deno.test('OtpCodeField (preact): initialError starts every box in the error state, clears on the next keystroke', () => {
  const { container, unmount } = mount({
    name: 'code',
    length: 6,
    formId: 'f',
    ariaLabel: 'Code',
    initialError: true,
  })
  const before = container.querySelectorAll('[data-space="otp-code-field-box"][data-error="true"]')
  assertEquals(before.length, 6)

  const input = must(container.querySelector<HTMLInputElement>('input'))
  act(() => typeInto(input, '1'))

  const after = container.querySelectorAll('[data-space="otp-code-field-box"][data-error="true"]')
  assertEquals(after.length, 0)

  unmount()
})

// --- Real wiring — the actual `index.preact.ts` binding, including the real defineComet boundary -

Deno.test('OtpCodeField (index.preact.ts): the real binding constructs without throwing', async () => {
  const { OtpCodeField: RealOtpCodeField } = await import(
    'ui/components/otp-code-field/index.preact.ts'
  )
  const html = renderToString(
    h(RealOtpCodeField, { name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' }) as VNode,
  )
  assertStringIncludes(html, 'data-space="otp-code-field-boxes"')
})

Deno.test('OtpCodeField (preact): an empty paste leaves the typed value alone and the browser default untouched', () => {
  const { container, unmount } = mount({ name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' })
  const input = must(container.querySelector<HTMLInputElement>('input'))
  act(() => typeInto(input, '12'))

  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => '' } })
  act(() => {
    input.dispatchEvent(event)
  })

  assertEquals(event.defaultPrevented, false)
  const boxes = container.querySelectorAll('[data-space="otp-code-field-box"]')
  assertEquals([boxes[0].textContent, boxes[1].textContent], ['1', '2'])
  unmount()
})

Deno.test('OtpCodeField (preact): a paste event with no clipboard data is ignored', () => {
  const { container, unmount } = mount({ name: 'code', length: 6, formId: 'f', ariaLabel: 'Code' })
  const input = must(container.querySelector<HTMLInputElement>('input'))
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: null })
  act(() => {
    input.dispatchEvent(event)
  })
  assertEquals(event.defaultPrevented, false)
  unmount()
})
