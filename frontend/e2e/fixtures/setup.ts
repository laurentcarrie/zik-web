import { Page } from '@playwright/test'
import { SONG_ID, mockSongDetail, mockStructure, mockSongs } from './mock-data'

/** Generate a silent WAV file as a Buffer. */
export function createSilentWav(durationSeconds: number, sampleRate = 44100): Buffer {
  const numSamples = Math.ceil(sampleRate * durationSeconds)
  const dataSize = numSamples * 2 // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

/** Generate click timestamps: one beat every (60/bpm) seconds for the given duration. */
export function generateClickTimes(bpm: number, durationSeconds: number): number[] {
  const interval = 60 / bpm
  const clicks: number[] = []
  for (let t = 0; t < durationSeconds; t += interval) {
    clicks.push(Math.round(t * 1000) / 1000)
  }
  return clicks
}

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
