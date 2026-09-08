import { test, expect, type Page } from '@playwright/test'

/**
 * The bottom sheet's gesture, driven with real touch-typed pointer input.
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
 *     under the finger, with real time between the samples so the velocity the sheet
 *     measures is the velocity the gesture had. Dispatched events go through real hit
 *     testing, real bubbling and the real handlers — but not through WebKit's own
 *     gesture arbitration, so they cannot prove that `touch-action` is right.
 *   - `mouseDrag()` uses Playwright's genuine input pipeline. That does exercise hit
 *     testing, pointer capture and the click suppression for real, at the cost of
 *     being a mouse.
 * Between them the logic is covered from both ends; the touch-action reasoning itself
 * is in ui.css and can only be finally confirmed on hardware.
 */

const VIEWPORT_W = 390

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
async function slowDrag(page: Page, from: Point, to: Point): Promise<void> {
  await drag(page, from, to, 10, 60)
}

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
 * The y of a point `dy` px below the sheet's top edge, once the sheet has stopped
 * moving. Waiting matters: the snap is a 420 ms CSS transition, and a point measured
 * mid-flight can be several tens of px from where the finger would actually land —
 * far enough to miss the sheet entirely and hit the map behind it.
 */
async function belowSheetTop(page: Page, dy: number): Promise<number> {
  const sheet = page.getByTestId('bottom-sheet')
  let last = Number.NaN
  for (let i = 0; i < 40; i++) {
    const y = (await sheet.boundingBox())!.y
    if (Math.abs(y - last) < 0.5) return y + dy
    last = y
    await page.waitForTimeout(50)
  }
  return last + dy
}

/**
 * A point inside the scrolling body that is actually the topmost element there.
 * Other chrome (the map legend, for one) overlays the sheet, and a gesture aimed at
 * a covered point never reaches the sheet at all — on a phone or in this suite.
 */
async function inScrollBody(page: Page): Promise<Point> {
  await belowSheetTop(page, 0) // let any snap finish first
  return await page.evaluate(() => {
    const scroll = document.querySelector('.sheet-scroll')!
    const box = scroll.getBoundingClientRect()
    const bottom = Math.min(box.bottom, window.innerHeight) - 24
    for (let y = box.top + 24; y < bottom; y += 12) {
      const hit = document.elementFromPoint(195, y)
      if (hit?.closest('.sheet-scroll') && !hit.closest('.sheet-grab')) return { x: 195, y }
    }
    throw new Error('no uncovered point inside the sheet body')
  })
}

test.describe('bottom sheet gesture', () => {
  test('drags up from peek and back down again — from the Now/Next card, not the handle', async ({ page }) => {
    await boot(page)

    // Start on the hero card, well clear of the grab handle: this is the swipe the
    // bug report was about.
    const from = await belowSheetTop(page, 90)
    await drag(page, { x: VIEWPORT_W / 2, y: from }, { x: VIEWPORT_W / 2, y: 90 })
    const opened = await detent(page)
    expect(['half', 'full']).toContain(opened)

    // …and back down.
    const back = await belowSheetTop(page, 90)
    await drag(page, { x: VIEWPORT_W / 2, y: back }, { x: VIEWPORT_W / 2, y: 640 })
    expect(await detent(page)).toBe('peek')
  })

  test('drags up from the grab handle too', async ({ page }) => {
    await boot(page)
    const from = await belowSheetTop(page, 20)
    await drag(page, { x: VIEWPORT_W / 2, y: from }, { x: VIEWPORT_W / 2, y: 40 })
    expect(await detent(page)).toBe('full')
  })

  test('a tap on the grab handle still cycles detents — the slop does not eat it', async ({ page }) => {
    await boot(page)
    // A click, not a drag: nothing moves more than 0 px, so the sheet must treat it as
    // the button press it is.
    await page.locator('.sheet-handle').click()
    expect(await detent(page)).toBe('half')
    await belowSheetTop(page, 0) // the handle is still travelling; let it land
    await page.locator('.sheet-handle').click()
    expect(await detent(page)).toBe('full')
  })

  test('a quick flick down snaps to peek without the finger travelling far', async ({ page }) => {
    await boot(page)
    // Open to half first, slowly, so the flick is measured from a known detent.
    const up = await belowSheetTop(page, 90)
    await slowDrag(page, { x: VIEWPORT_W / 2, y: up }, { x: VIEWPORT_W / 2, y: up - 200 })
    expect(await detent(page)).toBe('half')

    // 70 px in ~24 ms. Nowhere near half way to peek — only the velocity gets it there.
    const flick = await belowSheetTop(page, 60)
    await drag(page, { x: VIEWPORT_W / 2, y: flick }, { x: VIEWPORT_W / 2, y: flick + 70 }, 4, 6)
    expect(await detent(page)).toBe('peek')
  })

  test('a slow short drag settles back on the detent it came from', async ({ page }) => {
    await boot(page)
    const from = await belowSheetTop(page, 60)
    // 40 px, slowly: not a flick, and nearer to peek than to half.
    await drag(page, { x: VIEWPORT_W / 2, y: from }, { x: VIEWPORT_W / 2, y: from - 40 }, 8, 40)
    expect(await detent(page)).toBe('peek')
  })

  test('a horizontal swipe is not a sheet drag', async ({ page }) => {
    await boot(page)
    const from = await belowSheetTop(page, 90)
    await drag(page, { x: 40, y: from }, { x: 340, y: from - 20 })
    expect(await detent(page)).toBe('peek')
  })

  test('tapping a class row still selects it', async ({ page }) => {
    await boot(page)
    const up = await belowSheetTop(page, 20)
    await drag(page, { x: VIEWPORT_W / 2, y: up }, { x: VIEWPORT_W / 2, y: 40 })
    expect(await detent(page)).toBe('full')

    await page.getByTestId('class-row').filter({ hasText: 'ITAL 100A' }).first().click()
    await expect(page.getByTestId('bottom-sheet')).toContainText(/wing D/i, { timeout: 15_000 })
  })

  test('a drag that starts on a class row moves the sheet and does not select', async ({ page }) => {
    await boot(page)
    // At the half detent the body has nothing to scroll, so a swipe on a row is a drag.
    const up = await belowSheetTop(page, 90)
    await slowDrag(page, { x: VIEWPORT_W / 2, y: up }, { x: VIEWPORT_W / 2, y: up - 200 })
    expect(await detent(page)).toBe('half')

    const row = page.getByTestId('class-row').first()
    const box = (await row.boundingBox())!
    await mouseDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2, y: box.y + 260 })

    expect(await detent(page)).toBe('peek')
    // The drag must not have been read as a tap on the row.
    await expect(page.getByTestId('bottom-sheet')).not.toContainText(/wing/i)
  })

  test('real pointer input drags the sheet — capture and hit testing, not just handlers', async ({ page }) => {
    await boot(page)
    const from = await belowSheetTop(page, 90)
    await mouseDrag(page, { x: VIEWPORT_W / 2, y: from }, { x: VIEWPORT_W / 2, y: 60 })
    expect(await detent(page)).toBe('full')
  })

  test('at the full detent the body scrolls, and a pull down from its top drags the sheet', async ({ page }) => {
    await boot(page)
    const up = await belowSheetTop(page, 20)
    await drag(page, { x: VIEWPORT_W / 2, y: up }, { x: VIEWPORT_W / 2, y: 40 })
    expect(await detent(page)).toBe('full')

    const scroller = page.locator('.sheet-scroll')
    await expect(scroller).toHaveCSS('touch-action', 'pan-y')

    // The body really does overflow, or the handoff below proves nothing.
    const overflows = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)
    expect(overflows).toBe(true)

    // Scrolled away from the top, a pull down belongs to the scroller, not the sheet.
    const inBody = await inScrollBody(page)
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
    const from = await belowSheetTop(page, 90)

    await page.evaluate(async (y: number) => {
      const target = document.elementFromPoint(195, y)!
      const fire = (type: string, cy: number, buttons: number): void => {
        target.dispatchEvent(new PointerEvent(type, {
          pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true,
          cancelable: true, composed: true, clientX: 195, clientY: cy, buttons,
        }))
      }
      fire('pointerdown', y, 1)
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 20))
        fire('pointermove', y - i * 30, 1)
      }
      // iOS fires this where Chrome does not — a second finger, the app switcher, a
      // system edge gesture. The old code ignored it and left the sheet mid-drag.
      fire('pointercancel', y - 180, 0)
    }, from)

    await expect(sheet).not.toHaveClass(/is-dragging/)
    expect(['peek', 'half', 'full']).toContain(await detent(page))
    // And the sheet still responds to the next gesture.
    const again = await belowSheetTop(page, 90)
    await drag(page, { x: VIEWPORT_W / 2, y: again }, { x: VIEWPORT_W / 2, y: 60 })
    expect(await detent(page)).toBe('full')
  })

  test('the map keeps its own gestures — a drag on the canvas never moves the sheet', async ({ page }) => {
    await boot(page)
    const before = await page.evaluate(() => {
      const m = (window as any).__map
      return { c: m.getCenter(), z: m.getZoom() }
    })
    await mouseDrag(page, { x: 200, y: 200 }, { x: 200, y: 320 })
    expect(await detent(page)).toBe('peek')
    const after = await page.evaluate(() => {
      const m = (window as any).__map
      return { c: m.getCenter(), z: m.getZoom() }
    })
    // The map moved; the sheet did not.
    expect(Math.abs(after.c.lat - before.c.lat) + Math.abs(after.c.lng - before.c.lng)).toBeGreaterThan(0)
  })
})
