import { test, expect } from '@playwright/test'
import { setupMockRoutes } from './fixtures/setup'
import { SONG_ID } from './fixtures/mock-data'

test.beforeEach(async ({ page }) => {
  await setupMockRoutes(page)
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)
})

test('play/stop button starts in stopped state', async ({ page }) => {
  const btn = page.getByTestId('btn-play-stop')
  await expect(btn).toBeVisible()
  // Green background = stopped (ready to play)
  await expect(btn).toHaveClass(/bg-green-600/)
})

test('grid toggle hides and shows chord grid', async ({ page }) => {
  const gridBtn = page.getByTestId('btn-grid')
  // Grid is on by default
  await expect(gridBtn).toHaveClass(/bg-blue-600/)

  // Click to disable grid
  await gridBtn.click()
  await expect(gridBtn).not.toHaveClass(/bg-blue-600/)

  // Click again to re-enable
  await gridBtn.click()
  await expect(gridBtn).toHaveClass(/bg-blue-600/)
})

test('lyrics toggle works', async ({ page }) => {
  const lyricsBtn = page.getByTestId('btn-lyrics')
  // Lyrics is on by default
  await expect(lyricsBtn).toHaveClass(/bg-blue-600/)

  // Click to disable
  await lyricsBtn.click()
  await expect(lyricsBtn).not.toHaveClass(/bg-blue-600/)

  // Click to re-enable
  await lyricsBtn.click()
  await expect(lyricsBtn).toHaveClass(/bg-blue-600/)
})

test('all-lyrics toggle works', async ({ page }) => {
  const btn = page.getByTestId('btn-all-lyrics')
  // Off by default
  await expect(btn).not.toHaveClass(/bg-purple-600/)

  await btn.click()
  await expect(btn).toHaveClass(/bg-purple-600/)
})

test('loop toggle works', async ({ page }) => {
  const btn = page.getByTestId('btn-loop')
  // Off by default
  await expect(btn).not.toHaveClass(/bg-green-600/)

  await btn.click()
  await expect(btn).toHaveClass(/bg-green-600/)
})

test('flash toggle works', async ({ page }) => {
  const btn = page.getByTestId('btn-flash')
  // On by default
  await expect(btn).toHaveClass(/bg-yellow-500/)

  await btn.click()
  await expect(btn).not.toHaveClass(/bg-yellow-500/)
})

test('highlight toggle works', async ({ page }) => {
  const btn = page.getByTestId('btn-highlight')
  // On by default
  await expect(btn).toHaveClass(/bg-yellow-600/)

  await btn.click()
  await expect(btn).not.toHaveClass(/bg-yellow-600/)
})

test('sound button is visible', async ({ page }) => {
  await expect(page.getByTestId('btn-sound')).toBeVisible()
})

test('audio track button is visible', async ({ page }) => {
  await expect(page.getByTestId('btn-audio-track')).toBeVisible()
})
