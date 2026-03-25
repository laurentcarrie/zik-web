/**
 * Regression test: loop with audio track on a real song.
 * Requires the backend running on :8080.
 * Uses the actual song data (feu_chatterton--un_monde_nouveau) to reproduce
 * the bug where loop doesn't work with audio track enabled.
 */
import { test, expect } from '@playwright/test'

const SONG_ID = 'feu_chatterton--un_monde_nouveau'

// Skip if backend isn't running
test.beforeEach(async ({ page }) => {
  try {
    const res = await page.request.get('http://localhost:8080/mtl/api/songs')
    if (!res.ok()) test.skip(true, 'Backend not running')
  } catch {
    test.skip(true, 'Backend not running')
  }
})

test('loop with audio track replays section range (un monde nouveau)', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto(`/mtl/htmlsong/${SONG_ID}`)

  // Wait for audio track to load (headphone button turns purple)
  const audioBtn = page.getByTestId('btn-audio-track')
  await expect(audioBtn).toHaveClass(/bg-purple-600/, { timeout: 30000 })

  // Enable loop
  await page.getByTestId('btn-loop').click()
  await expect(page.getByTestId('btn-loop')).toHaveClass(/bg-green-600/)

  // Open section range picker and set From to "interlude" (second to last section)
  await page.getByTestId('btn-section-range').click()
  const modal = page.getByTestId('modal-section-range')
  const interludeRow = modal.locator('> div').filter({ hasText: 'interlude' })
  await interludeRow.getByText('From').click()
  await modal.getByText('×').click()

  // Verify section range is narrowed (button turns orange)
  await expect(page.getByTestId('btn-section-range')).toHaveClass(/bg-orange-600/)

  // Click play
  await page.getByTestId('btn-play-stop').click()
  await expect(page.getByTestId('btn-play-stop')).toHaveClass(/bg-red-600/)

  // Wait for bar counter to reach the "final" section area (bar >= 85)
  const barDisplay = page.getByTestId('bar-counter')
  await expect(barDisplay).toHaveText(/^(8[5-9]|9[0-2])$/, { timeout: 60000 })

  // Now wait for loop: bar should go back to ~68 (pre-roll before interlude)
  // If loop is broken, the metronome stops (button turns green) or bar keeps going past 92
  await expect(barDisplay).toHaveText(/^(6[89]|7[0-9])$/, { timeout: 30000 })

  // Should still be running
  await expect(page.getByTestId('btn-play-stop')).toHaveClass(/bg-red-600/)

  // === Second loop iteration ===
  // Wait for bar to reach final section again (bar >= 85)
  await expect(barDisplay).toHaveText(/^(8[5-9]|9[0-2])$/, { timeout: 60000 })

  // Bar should loop back to ~68 again
  await expect(barDisplay).toHaveText(/^(6[89]|7[0-9])$/, { timeout: 30000 })

  // Still running after second loop
  await expect(page.getByTestId('btn-play-stop')).toHaveClass(/bg-red-600/)
})

test('clicking section title seeks audio to correct position (un monde nouveau)', async ({ page }) => {
  test.setTimeout(60_000)

  // Capture console logs from the page
  const consoleLogs: string[] = []
  page.on('console', msg => { if (msg.text().startsWith('[seek-debug]')) consoleLogs.push(msg.text()) })

  await page.goto(`/mtl/htmlsong/${SONG_ID}`)

  // Wait for audio track to load
  const audioBtn = page.getByTestId('btn-audio-track')
  await expect(audioBtn).toHaveClass(/bg-purple-600/, { timeout: 30000 })

  // Inject monitoring: patch AudioBufferSourceNode.start to log seek offset
  await page.evaluate(() => {
    const origStart = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function(...args: Parameters<typeof origStart>) {
      console.log(`[seek-debug] source.start(${args.join(', ')})`)
      return origStart.apply(this, args)
    }
  })

  // Song is stopped. Click on "interlude" section title.
  const interludeHeading = page.getByRole('heading', { name: 'interlude' })
  await interludeHeading.click()

  // Play button should turn red (running)
  await expect(page.getByTestId('btn-play-stop')).toHaveClass(/bg-red-600/)

  // Bar counter should show 68 or 69
  const barDisplay = page.getByTestId('bar-counter')
  await expect(barDisplay).toHaveText(/^(6[89]|70)$/, { timeout: 5000 })

  // Wait for progress bar to appear and stabilize
  const progressBar = page.locator('.bg-purple-500.h-1')
  await expect(progressBar).toBeVisible({ timeout: 2000 })
  await page.waitForTimeout(1000)

  const widthStr = await progressBar.evaluate(el => el.style.width)
  const widthPercent = parseFloat(widthStr)

  // Log captured debug info
  for (const log of consoleLogs) console.log(log)
  console.log(`Progress bar width: ${widthPercent}% (expected ~72%)`)
  console.log(`Bar counter: ${await barDisplay.textContent()}`)

  // Audio should be at ~72% (bar 68-69 out of ~93 bars).
  expect(widthPercent).toBeGreaterThan(65)
  expect(widthPercent).toBeLessThan(80)
})
