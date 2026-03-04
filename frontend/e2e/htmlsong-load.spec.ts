import { test, expect } from '@playwright/test'
import { setupMockRoutes } from './fixtures/setup'
import { SONG_ID, mockSongDetail, mockStructure } from './fixtures/mock-data'

test.beforeEach(async ({ page }) => {
  await setupMockRoutes(page)
})

test('renders song title and author', async ({ page }) => {
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)
  await expect(page.getByText(mockSongDetail.title)).toBeVisible()
  await expect(page.getByText(mockSongDetail.author)).toBeVisible()
})

test('displays BPM in toolbar', async ({ page }) => {
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)
  await expect(page.getByText(String(mockSongDetail.tempo))).toBeVisible()
})

test('renders all sections', async ({ page }) => {
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)
  for (const section of mockStructure.sections) {
    await expect(page.getByRole('heading', { name: section.title })).toBeVisible()
  }
})

test('shows status indicators for mp3, clicks, mp3/click', async ({ page }) => {
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)
  const mp3Status = page.getByTestId('status-mp3')
  const clicksStatus = page.getByTestId('status-clicks')
  const mp3ClickStatus = page.getByTestId('status-mp3-click')

  await expect(mp3Status).toBeVisible()
  await expect(clicksStatus).toBeVisible()
  await expect(mp3ClickStatus).toBeVisible()

  // All three have green indicators (mock data has all URLs set)
  await expect(mp3Status.locator('.bg-green-400')).toBeVisible()
  await expect(clicksStatus.locator('.bg-green-400')).toBeVisible()
  await expect(mp3ClickStatus.locator('.bg-green-400')).toBeVisible()
})

test('shows prev/next song navigation', async ({ page }) => {
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)
  const prevBtn = page.getByTestId('btn-prev-song')
  const nextBtn = page.getByTestId('btn-next-song')

  await expect(prevBtn).toBeVisible()
  await expect(nextBtn).toBeVisible()

  // Both should be enabled (mock has songs before and after)
  await expect(prevBtn).toBeEnabled()
  await expect(nextBtn).toBeEnabled()
})
