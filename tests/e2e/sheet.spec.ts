import { test, expect, type Page } from '@playwright/test'

/**
 * The bottom sheet's gesture, driven with touch-typed pointer input.
 *
 * This suite exists because of a real-device bug: the drag handlers were bound to the
 * grab handle alone, so on a phone — where nobody aims for a 44 px strip — the sheet
 * could not be moved at all. Every assertion below is about `data-detent`, which is
 * the contract main.ts reads to keep the scrubber and the camera padding clear of the
 * sheet.
 *
 * The project runs WebKit at an iPhone 13 viewport, the closest proxy available to
 * the device the bug was reported on.
 *
 * HOW THE GESTURES ARE DRIVEN, and what that does and does not prove:
 *   - `drag()` dispatches PointerEvents with `pointerType: 'touch'` on the element
 *     under the finger, with real time between the samples, so the velocity the sheet
 *     measures is the velocity the gesture had. Dispatched events go through real hit
 *     testing, real bubbling and the real handlers — but not through WebKit's own
 *     gesture arbitration, so they cannot prove that `touch-action` is right.
 *   - `mouseDrag()` uses Playwright's genuine input pipeline. That does exercise hit
 *     testing, pointer capture and the click suppression for real, at the cost of
 *     being a mouse.
 * Between them the logic is covered from both ends; the touch-action reasoning itself
 * is in ui.css and can only be finally confirmed on hardware.
 *
 * Every start point is chosen by hit test rather than by arithmetic. Other chrome
 * (the map legend, the top bar) overlays the sheet, and a gesture aimed at a covered
 * point silently goes to that chrome instead — which would make this suite lie.
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('#boot')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(() => Boolean((window as unknown as { __map?: unknown }).__map), null, { timeout: 30_000 })
  await expect(page.getByTestId('bottom-sheet')).toHaveAttribute('data-detent', 'peek')
}

interface Point { x: number; y: number }

/** Dispatch a touch-flavoured pointer drag from `from` to `to`. */
async function drag(page: Page, from: Point, to: Point, steps = 8, stepMs = 24): Promise<void> {
  await page.evaluate(
    async ({ from, to, steps, stepMs }: { from: Point; to: Point; steps: number; stepMs: number }) => {
      const target = document.elementFromPoint(from.x, from.y)
      if (!target) throw new Error(`nothing at ${from.x},${from.y}`)
      const fire = (type: string, x: number, y: number, buttons: number): void => {
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            button: type === 'pointermove' ? -1 : 0,
            buttons,
          }),
        )
      }
      fire('pointerdown', from.x, from.y, 1)
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        await new Promise((r) => setTimeout(r, stepMs))
        fire('pointermove', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1)
      }
      fire('pointerup', to.x, to.y, 0)
    },
    { from, to, steps, stepMs },
  )
}

/**
 * A deliberately unhurried drag: slow enough (~0.3 px/ms) that the release is read as
 * a settle rather than a flick, which is what makes the landing detent predictable.
 */
const slowDrag = (page: Page, from: Point, to: Point): Promise<void> => drag(page, from, to, 10, 60)

/** The same drag through Playwright's real input pipeline (as a mouse). */
async function mouseDrag(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
}

const detent = (page: Page): Promise<string | null> =>
  page.getByTestId('bottom-sheet').getAttribute('data-detent')

/**
 * Wait for the snap to finish — the sheet's top edge stops moving. It matters: the
 * snap is a 420 ms CSS transition, and a point measured mid-flight can be tens of px
 * from where the finger would land, far enough to miss the sheet entirely.
 */
async function settled(page: Page): Promise<void> {
  const sheet = page.getByTestId('bottom-sheet')
  let last = Number.NaN
  for (let i = 0; i < 40; i++) {
    const y = (await sheet.boundingBox())!.y
    if (Math.abs(y - last) < 0.5) return
    last = y
    await page.waitForTimeout(50)
  }
}

/**
 * The topmost uncovered point on the sheet matching `selector` — the place a finger
 * would actually land on that surface.
 */
async function pointOn(page: Page, selector: string): Promise<Point> {
  await settled(page)
  return await page.evaluate((sel: string) => {
    const sheet = document.getElementById('sheet')!
    const box = sheet.getBoundingClientRect()
    const bottom = Math.min(box.bottom, window.innerHeight) - 8
    for (let y = Math.max(box.top, 0) + 6; y < bottom; y += 6) {
      for (const x of [195, 120, 270, 60, 330]) {
        const hit = document.elementFromPoint(x, y)
        if (hit?.closest(sel) && hit.closest('#sheet')) return { x, y }
      }
    }
    throw new Error(`nothing uncovered matching ${sel} on the sheet`)
  }, selector)
}

/** A drag surface: the grab handle or the Now/Next header. */
const grabPoint = (page: Page): Promise<Point> => pointOn(page, '.sheet-handle, .sheet-grab')

/** The scrolling body, clear of the header. */
async function bodyPoint(page: Page): Promise<Point> {
  await settled(page)
  return await page.evaluate(() => {
    const scroll = document.querySelector('.sheet-scroll')!
    const box = scroll.getBoundingClientRect()
    const bottom = Math.min(box.bottom, window.innerHeight) - 24
    for (let y = box.top + 24; y < bottom; y += 6) {
      const hit = document.elementFromPoint(195, y)
      if (hit?.closest('.sheet-scroll') && !hit.closest('.sheet-grab')) return { x: 195, y }
    }
    throw new Error('no uncovered point inside the sheet body')
  })
}

/** A point on the map canvas that nothing is covering. */
async function mapPoint(page: Page): Promise<Point> {
  return await page.evaluate(() => {
    for (let y = 140; y < 420; y += 10) {
      for (const x of [120, 195, 270]) {
        const hit = document.elementFromPoint(x, y)
        if (hit?.tagName === 'CANVAS') return { x, y }
      }
    }
    throw new Error('the map canvas is completely covered')
  })
}

test.describe('bottom sheet gesture', () => {
  test('drags up from the Now/Next card, not just the handle, and back down again', async ({ page }) => {
    // The bug in one test: a swipe that starts on the hero card — the biggest thing
    // on screen at peek — used to do nothing at all.
    await boot(page)

    const up = await grabPoint(page)
    await drag(page, up, { x: up.x, y: 90 })
    expect(['half', 'full']).toContain(await detent(page))

    const down = await grabPoint(page)
    await drag(page, down, { x: down.x, y: 640 })
    expect(await detent(page)).toBe('peek')
  })

  test('drags up from the grab handle too', async ({ page }) => {
    await boot(page)
    const from = await pointOn(page, '.sheet-handle')
    await drag(page, from, { x: from.x, y: 40 })
    expect(await detent(page)).toBe('full')
  })

  test('a tap on the grab handle still cycles detents — the slop does not eat it', async ({ page }) => {
    await boot(page)
    // A click, not a drag: nothing moves, so the sheet must treat it as the button
    // press it is.
    await page.locator('.sheet-handle').click()
    expect(await detent(page)).toBe('half')
    await settled(page)
    await page.locator('.sheet-handle').click()
    expect(await detent(page)).toBe('full')
  })

  test('a quick flick down snaps to peek without the finger travelling far', async ({ page }) => {
    await boot(page)
    // Open to half first, slowly, so the flick is measured from a known detent.
    const up = await grabPoint(page)
    await slowDrag(page, up, { x: up.x, y: up.y - 200 })
    expect(await detent(page)).toBe('half')

    // ~70 px in ~24 ms. Nowhere near half way down to peek: only the velocity gets
    // it there.
    const flick = await grabPoint(page)
    await drag(page, flick, { x: flick.x, y: flick.y + 70 }, 4, 6)
    expect(await detent(page)).toBe('peek')
  })

  test('a slow short drag settles back on the detent it came from', async ({ page }) => {
    await boot(page)
    const from = await grabPoint(page)
    // 40 px, slowly: not a flick, and still nearer to peek than to half.
    await drag(page, from, { x: from.x, y: from.y - 40 }, 8, 40)
    expect(await detent(page)).toBe('peek')
  })

  test('a horizontal swipe is not a sheet drag', async ({ page }) => {
    await boot(page)
    const from = await grabPoint(page)
    await drag(page, { x: 40, y: from.y }, { x: 340, y: from.y - 20 })
    expect(await detent(page)).toBe('peek')
  })

  test('tapping a class row still selects it', async ({ page }) => {
    await boot(page)
    const from = await pointOn(page, '.sheet-handle')
    await drag(page, from, { x: from.x, y: 40 })
    expect(await detent(page)).toBe('full')

    await page.getByTestId('week-class-row').filter({ hasText: 'ITAL 100A' }).first().click()
    await expect(page.getByTestId('bottom-sheet')).toContainText(/wing D/i, { timeout: 15_000 })
  })

  test('a drag that starts on a class row moves the sheet and does not select', async ({ page }) => {
    await boot(page)
    // Class rows only come into view at the full detent, where the body scrolls — so
    // this is also the handoff: at the top of the scroll, a pull down is the sheet's.
    const open = await pointOn(page, '.sheet-handle')
    await drag(page, open, { x: open.x, y: 40 })
    expect(await detent(page)).toBe('full')
    await page.locator('.sheet-scroll').evaluate((el) => { el.scrollTop = 0 })

    const start = await pointOn(page, '[data-testid="week-class-row"]')
    await mouseDrag(page, start, { x: start.x, y: start.y + 260 })

    expect(await detent(page)).not.toBe('full')
    // The drag must not have been read as a tap on the row.
    await expect(page.getByTestId('bottom-sheet')).not.toContainText(/wing/i)
  })

  test('real pointer input drags the sheet — capture and hit testing, not just handlers', async ({ page }) => {
    await boot(page)
    const from = await grabPoint(page)
    await mouseDrag(page, from, { x: from.x, y: 60 })
    expect(await detent(page)).toBe('full')
  })

  test('at the full detent the body scrolls, and a pull down from its top drags the sheet', async ({ page }) => {
    await boot(page)
    const open = await pointOn(page, '.sheet-handle')
    await drag(page, open, { x: open.x, y: 40 })
    expect(await detent(page)).toBe('full')

    const scroller = page.locator('.sheet-scroll')
    await expect(scroller).toHaveCSS('touch-action', 'pan-y')
    // The body really does overflow, or the handoff below proves nothing.
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    // Scrolled away from the top, a pull down belongs to the scroller, not the sheet.
    const inBody = await bodyPoint(page)
    await scroller.evaluate((el) => { el.scrollTop = 60 })
    await drag(page, inBody, { x: inBody.x, y: inBody.y + 160 })
    expect(await detent(page)).toBe('full')

    // Back at the top, the same pull hands off to the sheet.
    await scroller.evaluate((el) => { el.scrollTop = 0 })
    await drag(page, inBody, { x: inBody.x, y: inBody.y + 200 })
    expect(await detent(page)).not.toBe('full')
  })

  test('a pointercancel mid-drag lands on a detent instead of freezing the sheet', async ({ page }) => {
    await boot(page)
    const sheet = page.getByTestId('bottom-sheet')
    const from = await grabPoint(page)

    await page.evaluate(async (from: Point) => {
      const target = document.elementFromPoint(from.x, from.y)!
      const fire = (type: string, cy: number, buttons: number): void => {
        target.dispatchEvent(new PointerEvent(type, {
          pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true,
          cancelable: true, composed: true, clientX: from.x, clientY: cy, buttons,
        }))
      }
      fire('pointerdown', from.y, 1)
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 20))
        fire('pointermove', from.y - i * 30, 1)
      }
      // iOS fires this where Chrome does not — a second finger, the app switcher, a
      // system edge gesture. The old code ignored it and left the sheet mid-drag.
      fire('pointercancel', from.y - 180, 0)
    }, from)

    await expect(sheet).not.toHaveClass(/is-dragging/)
    expect(['peek', 'half', 'full']).toContain(await detent(page))

    // And the sheet still answers the next gesture.
    const again = await grabPoint(page)
    await drag(page, again, { x: again.x, y: 60 })
    expect(await detent(page)).toBe('full')
  })

  test('the map keeps its own gestures — a drag on the canvas never moves the sheet', async ({ page }) => {
    await boot(page)
    const from = await mapPoint(page)
    const before = await page.evaluate(() => (window as any).__map.getCenter())
    await mouseDrag(page, from, { x: from.x, y: from.y + 120 })
    expect(await detent(page)).toBe('peek')
    const after = await page.evaluate(() => (window as any).__map.getCenter())
    // The map panned; the sheet did not.
    expect(Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng)).toBeGreaterThan(0)
  })
})
