import { test, expect } from '@playwright/test'
import { setupMockRoutes } from './fixtures/setup'
import { SONG_ID, mockSongDetail } from './fixtures/mock-data'

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

test('clicking play starts the metronome and activates first section', async ({ page }) => {
  const playBtn = page.getByTestId('btn-play-stop')

  // Click play
  await playBtn.click()

  // Button turns red (running)
  await expect(playBtn).toHaveClass(/bg-red-600/)

  // Bar counter advances beyond 0
  const barDisplay = page.locator('.font-mono.font-bold.tabular-nums').first()
  await expect(barDisplay).not.toHaveText('0', { timeout: 5000 })

  // First section (Intro) becomes active — title grows to text-4xl
  const introHeading = page.getByRole('heading', { name: 'Intro' })
  await expect(introHeading).toHaveClass(/text-4xl/, { timeout: 5000 })

  // Click stop
  await playBtn.click()

  // Button turns green again (stopped)
  await expect(playBtn).toHaveClass(/bg-green-600/)
})

test('loop mode replays section range after reaching the end', async ({ page }) => {
  // Override structure with short 1-bar sections so the test completes quickly
  await page.route(`**/api/song/${SONG_ID}/structure`, async (route) => {
    await route.fulfill({
      json: {
        sections: [
          { id: 'intro', title: 'Intro', color: 'wheat1', rows: [{ bars: [{ chords: [{ display: 'C', font: 'songbook', char: 'T' }] }], repeat: 1, bar_number: 1 }] },
          { id: 'verse', title: 'Verse', color: 'darkseagreen1', rows: [{ bars: [{ chords: [{ display: 'G', font: 'songbook', char: 'r' }] }], repeat: 1, bar_number: 2 }] },
          { id: 'chorus', title: 'Chorus', color: 'coral1', rows: [{ bars: [{ chords: [{ display: 'Am', font: 'songbook', char: 'q' }] }], repeat: 1, bar_number: 3 }] },
        ],
      },
    })
  })
  // Override song with high BPM so bars advance faster
  await page.route(`**/api/song/${SONG_ID}`, async (route) => {
    if (route.request().url().includes('/structure') || route.request().url().includes('/lyrics/')) return route.fallback()
    await route.fulfill({ json: { ...mockSongDetail, tempo: 300 } })
  })
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)

  // Enable loop
  await page.getByTestId('btn-loop').click()
  await expect(page.getByTestId('btn-loop')).toHaveClass(/bg-green-600/)

  // Open section range picker and set From to Verse (second section)
  await page.getByTestId('btn-section-range').click()
  const modal = page.getByTestId('modal-section-range')
  const verseRow = modal.locator('> div').filter({ hasText: 'Verse' }).filter({ hasNotText: 'Intro' })
  await verseRow.getByText('From').click()
  await modal.getByText('×').click()

  // Click play — starts at Verse (bar 2), range ends at Chorus (bar 3)
  await page.getByTestId('btn-play-stop').click()
  await expect(page.getByTestId('btn-play-stop')).toHaveClass(/bg-red-600/)

  // Wait for bar to reach Chorus (bar 3)
  const barDisplay = page.locator('.font-mono.font-bold.tabular-nums').first()
  await expect(barDisplay).toHaveText('3', { timeout: 10000 })

  // If loop works, bar should go back to 1 (start of Verse range) while still running.
  // If loop is broken, the metronome stops (button turns green).
  await expect(barDisplay).toHaveText(/^[12]$/, { timeout: 10000 })
  await expect(page.getByTestId('btn-play-stop')).toHaveClass(/bg-red-600/)
})

test('sound button is visible', async ({ page }) => {
  await expect(page.getByTestId('btn-sound')).toBeVisible()
})

test('audio track button is visible', async ({ page }) => {
  await expect(page.getByTestId('btn-audio-track')).toBeVisible()
})
