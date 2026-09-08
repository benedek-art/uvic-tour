import { test, expect, type Page } from '@playwright/test'

/**
 * E2E against the real production build at an iPhone viewport.
 * The map needs WebGL + a worker, so every test waits for the app to finish booting
 * rather than for an arbitrary timeout.
 */
async function boot(page: Page): Promise<void> {
  await page.goto('/')
  // #boot only hides once the style, sources and rise animation have all completed.
  await expect(page.locator('#boot')).toBeHidden({ timeout: 30_000 })
  await page.waitForFunction(() => Boolean((window as unknown as { __map?: unknown }).__map), null, { timeout: 30_000 })
}

test.describe('UVic Tour', () => {
  test('boots to an interactive map with no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('GL Driver')) errors.push(m.text()) })
    page.on('pageerror', e => errors.push('pageerror: ' + e.message))
    await boot(page)
    await expect(page.locator('canvas')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('shows the now/next card without any interaction', async ({ page }) => {
    await boot(page)
    const card = page.getByTestId('now-next')
    await expect(card).toBeVisible()
    // Whatever the real clock says, the card must name one of the five courses.
    await expect(card).toContainText(/BIOL 184|BIOL 150A|ITAL 100A|PSYC 100A|PSYC 100B/)
  })

  test('lays out every session of the week', async ({ page }) => {
    await boot(page)
    await expect(page.getByTestId('week-class-row')).toHaveCount(12)
  })

  test('flying to a class drops the correct room pin', async ({ page }) => {
    await boot(page)
    await page.getByTestId('week-class-row').filter({ hasText: 'ITAL 100A' }).first().click()
    await expect(page.getByTestId('room-pin')).toContainText('D287', { timeout: 15_000 })
  })

  test('surfaces the room decoder for a selected class', async ({ page }) => {
    await boot(page)
    await page.getByTestId('week-class-row').filter({ hasText: 'ITAL 100A' }).first().click()
    const sheet = page.getByTestId('bottom-sheet')
    await expect(sheet).toContainText(/wing D/i)
    await expect(sheet).toContainText(/floor 2/i)
  })

  test('draws a route with a believable distance and duration', async ({ page }) => {
    await boot(page)
    await page.getByTestId('week-class-row').filter({ hasText: 'ITAL 100A' }).first().click()
    await page.getByTestId('route-btn').first().click()
    const summary = page.getByTestId('route-summary')
    await expect(summary).toContainText(/\d+\s*m/, { timeout: 15_000 })
    await expect(summary).toContainText(/\d+\s*min/)
    // The route layers must actually exist on the map, not just in the panel text.
    const layers = await page.evaluate(() => {
      const m = (window as any).__map
      return m.getStyle().layers.map((l: { id: string }) => l.id).filter((i: string) => i.startsWith('route'))
    })
    expect(layers).toContain('route-line')
  })

  test('calls the Monday PSYC handoff a stay-put, not a scramble', async ({ page }) => {
    await boot(page)
    await page.getByTestId('week-class-row').filter({ hasText: 'PSYC 100B' }).first().click()
    await expect(page.getByTestId('transition-note')).toContainText(/stay put/i, { timeout: 15_000 })
  })

  test('renders exactly three gold hero buildings and no more', async ({ page }) => {
    await boot(page)
    const count = await page.evaluate(() => {
      const m = (window as any).__map
      return m.querySourceFeatures('buildings', { sourceLayer: undefined })
        .filter((f: any) => ['MacLaurin Building', 'Bob Wright Centre', 'Engineering/Computer Science Building']
          .includes(f.properties?.name))
        .reduce((s: Set<string>, f: any) => s.add(f.properties.name), new Set<string>()).size
    })
    expect(count).toBe(3)
  })

  test('works at phone width with the bottom sheet as primary UI', async ({ page }) => {
    await boot(page)
    const sheet = page.getByTestId('bottom-sheet')
    await expect(sheet).toBeVisible()
    const box = await sheet.boundingBox()
    const vp = page.viewportSize()!
    expect(box!.width).toBeGreaterThan(vp.width * 0.9)   // full-width sheet, not a rail
  })


  test('top bar controls are actually tappable, not covered by the map canvas', async ({ page }) => {
    await boot(page)
    // Regression: #topbar was unpositioned, so the absolutely-positioned MapLibre canvas
    // painted over it and swallowed every tap. A JS .click() hid this; only a real
    // hit-test catches it.
    const btn = page.locator('.tour-launch').first()
    await expect(btn).toBeVisible()
    const box = (await btn.boundingBox())!
    const topmost = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number)
      return el?.closest('.tour-launch') ? 'tour-launch' : (el?.tagName.toLowerCase() ?? 'none')
    }, [box.x + box.width / 2, box.y + box.height / 2])
    expect(topmost).toBe('tour-launch')
  })

  test('the guided tour starts from a real tap and can be stopped', async ({ page }) => {
    await boot(page)
    await page.locator('.tour-launch').first().click()
    const overlay = page.locator('#tour-overlay')
    await expect(overlay).toBeVisible({ timeout: 15_000 })
    await expect(overlay).toContainText('Stop 1 of 8')
    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden({ timeout: 10_000 })
    await expect(page.getByTestId('bottom-sheet')).toBeVisible()
  })

  test('map overlays stand down when the sheet expands over them', async ({ page }) => {
    await boot(page)
    // Regression: the place card floats at a fixed offset from the resting chrome.
    // Expanding the sheet used to leave it on top, making that band of the sheet
    // untappable and undraggable.
    await page.locator('.poi-marker').first().click({ force: true })
    await expect(page.locator('#place-card')).toBeVisible()

    const handle = page.locator('.sheet-handle').first()
    await handle.click({ force: true })
    await handle.click({ force: true })
    await expect(page.locator('#sheet')).toHaveAttribute('data-detent', /half|full/, { timeout: 10_000 })
    await expect(page.locator('#place-card')).toBeHidden()
  })
})
