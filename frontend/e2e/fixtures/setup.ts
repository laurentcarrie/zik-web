import { Page } from '@playwright/test'
import { SONG_ID, mockSongDetail, mockStructure, mockSongs } from './mock-data'

export async function setupMockRoutes(page: Page) {
  // Mock song detail
  await page.route(`**/api/song/${SONG_ID}`, async (route) => {
    if (route.request().url().includes('/structure') || route.request().url().includes('/lyrics/') || route.request().url().includes('/yml')) return route.fallback()
    await route.fulfill({ json: mockSongDetail })
  })

  // Mock song structure
  await page.route(`**/api/song/${SONG_ID}/structure`, async (route) => {
    await route.fulfill({ json: mockStructure })
  })

  // Mock lyrics (return empty for all sections)
  await page.route(`**/api/song/*/lyrics/*`, async (route) => {
    await route.fulfill({ json: { content: 'Some lyrics here\\\\And more lyrics' } })
  })

  // Mock songs list
  await page.route('**/api/songs', async (route) => {
    await route.fulfill({ json: mockSongs })
  })

  // Stub guitar-embed requests
  await page.route('**/guitar-embed*', async (route) => {
    await route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' })
  })

  // Abort WebSocket upgrade requests (click-sync)
  await page.route('**/api/click-sync/**', async (route) => {
    await route.abort()
  })

  // Abort audio file requests
  await page.route('**/*.mp3', async (route) => {
    await route.abort()
  })
  await page.route('**/clicks.yml', async (route) => {
    await route.abort()
  })

  // Stub static assets (fonts, background, favicon)
  await page.route('**/*.woff', async (route) => {
    await route.abort()
  })
  await page.route('**/*.ttf', async (route) => {
    await route.abort()
  })
  await page.route('**/background.jpg', async (route) => {
    await route.fulfill({ body: '', contentType: 'image/jpeg' })
  })
}
