import { test, expect } from '@playwright/test'
import { setupMockRoutes, createSilentWav, generateClickTimes } from './fixtures/setup'
import { SONG_ID, mockSongDetail } from './fixtures/mock-data'

const BPM = 300

// Short 3-section structure: 1 bar each
const shortStructure = {
  sections: [
    { id: 'intro', title: 'Intro', color: 'wheat1', rows: [{ bars: [{ chords: [{ display: 'C', font: 'songbook', char: 'T' }] }], repeat: 1, bar_number: 1 }] },
    { id: 'verse', title: 'Verse', color: 'darkseagreen1', rows: [{ bars: [{ chords: [{ display: 'G', font: 'songbook', char: 'r' }] }], repeat: 1, bar_number: 2 }] },
    { id: 'chorus', title: 'Chorus', color: 'coral1', rows: [{ bars: [{ chords: [{ display: 'Am', font: 'songbook', char: 'q' }] }], repeat: 1, bar_number: 3 }] },
  ],
}

test.beforeEach(async ({ page }) => {
  await setupMockRoutes(page)

  // Override structure with short sections
  await page.route(`**/api/song/${SONG_ID}/structure`, async (route) => {
    await route.fulfill({ json: shortStructure })
  })

  // Override song with high BPM
  await page.route(`**/api/song/${SONG_ID}`, async (route) => {
    if (route.request().url().includes('/structure') || route.request().url().includes('/lyrics/')) return route.fallback()
    await route.fulfill({ json: { ...mockSongDetail, tempo: BPM } })
  })

  // Serve a silent WAV for mp3 requests (so useAudioClickTrack loads successfully)
  const wavBuffer = createSilentWav(10, 44100)
  await page.route('**/*.mp3', async (route) => {
    await route.fulfill({ body: wavBuffer, contentType: 'audio/wav' })
  })

  // Serve click timestamps for clicks.yml
  const clicks = generateClickTimes(BPM, 10)
  await page.route('**/clicks.yml', async (route) => {
    await route.fulfill({ json: clicks })
  })
})

test('loop mode with audio track replays section range after reaching the end', async ({ page }) => {
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)

  // Wait for audio track to load (headphone button becomes purple when loaded and not muted)
  const audioBtn = page.getByTestId('btn-audio-track')
  await expect(audioBtn).toHaveClass(/bg-purple-600/, { timeout: 10000 })

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
  const barDisplay = page.getByTestId('bar-counter')
  await expect(barDisplay).toHaveText('3', { timeout: 10000 })

  // If loop works: bar goes back to 1-2 (start of range) while still running.
  // If loop is broken: metronome stops (button turns green) or bar keeps increasing.
  await expect(barDisplay).toHaveText(/^[12]$/, { timeout: 10000 })
  await expect(page.getByTestId('btn-play-stop')).toHaveClass(/bg-red-600/)
})

test('clicking section title with audio track seeks audio to the correct position', async ({ page }) => {
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)

  // Wait for audio track to load
  const audioBtn = page.getByTestId('btn-audio-track')
  await expect(audioBtn).toHaveClass(/bg-purple-600/, { timeout: 10000 })

  // Song is stopped. Click on Chorus section title (bar 3, last section).
  // When not running, onTitleClick receives firstBarNumber - 1 = 2.
  // seekToBar(2) should seek audio to (2-1)*4*60/300 = 0.8 seconds.
  const chorusHeading = page.getByRole('heading', { name: 'Chorus' })
  await chorusHeading.click()

  // Play button should turn red (running)
  await expect(page.getByTestId('btn-play-stop')).toHaveClass(/bg-red-600/)

  // Bar counter should show 2 or 3 (pre-roll bar 2, then chorus bar 3)
  const barDisplay = page.getByTestId('bar-counter')
  await expect(barDisplay).toHaveText(/^[23]$/, { timeout: 5000 })

  // Check progress bar: audio should be near bar 2 position (~8% of 10s),
  // NOT at 0% (which would mean audio started from the beginning).
  // The purple progress bar shows audioTrack.currentTime / audioTrack.duration.
  const progressBar = page.locator('.bg-purple-500.h-1')
  await expect(progressBar).toBeVisible({ timeout: 2000 })

  // Wait a tiny bit for currentTime to update
  await page.waitForTimeout(500)

  const widthStr = await progressBar.evaluate(el => el.style.width)
  const widthPercent = parseFloat(widthStr)
  // At BPM=300, bar 2 starts at 0.8s out of 10s = 8%.
  // After 0.5s of playback, audio is at ~1.3s = ~13%.
  // Should be > 5% (not starting from beginning) and < 30% (not way off).
  expect(widthPercent).toBeGreaterThan(5)
  expect(widthPercent).toBeLessThan(30)
})
