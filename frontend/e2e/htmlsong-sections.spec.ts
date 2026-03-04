import { test, expect } from '@playwright/test'
import { setupMockRoutes } from './fixtures/setup'
import { SONG_ID, mockStructure } from './fixtures/mock-data'

test.beforeEach(async ({ page }) => {
  await setupMockRoutes(page)
  await page.goto(`/mtl/htmlsong/${SONG_ID}`)
})

test('all section titles are displayed', async ({ page }) => {
  for (const section of mockStructure.sections) {
    await expect(page.getByRole('heading', { name: section.title })).toBeVisible()
  }
})

test('section range picker opens and closes', async ({ page }) => {
  const rangeBtn = page.getByTestId('btn-section-range')

  // Modal not visible initially
  await expect(page.getByTestId('modal-section-range')).not.toBeVisible()

  // Open modal
  await rangeBtn.click()
  const modal = page.getByTestId('modal-section-range')
  await expect(modal).toBeVisible()

  // Modal shows section names
  for (const section of mockStructure.sections) {
    await expect(modal.getByText(section.title)).toBeVisible()
  }

  // Close modal by clicking the close button
  await modal.getByText('×').click()
  await expect(page.getByTestId('modal-section-range')).not.toBeVisible()
})

test('section range picker shows From/To buttons for each section', async ({ page }) => {
  await page.getByTestId('btn-section-range').click()
  const modal = page.getByTestId('modal-section-range')

  // Each section should have From and To buttons
  // The first section's From should be active (green), last section's To should be active (red)
  const fromButtons = modal.getByText('From', { exact: false })
  const toButtons = modal.getByText('To', { exact: false })

  await expect(fromButtons).toHaveCount(mockStructure.sections.length)
  await expect(toButtons).toHaveCount(mockStructure.sections.length)
})

test('section range picker narrows range', async ({ page }) => {
  await page.getByTestId('btn-section-range').click()
  const modal = page.getByTestId('modal-section-range')

  // Set range to just Verse 1 (index 1) by clicking its From and To
  const rows = modal.locator('> div').filter({ has: page.getByText('Verse 1') })
  await rows.getByText('From', { exact: false }).click()
  await rows.getByText('To', { exact: false }).click()

  // Section range button should now be orange (indicating narrowed range)
  await modal.getByText('×').click()
  await expect(page.getByTestId('btn-section-range')).toHaveClass(/bg-orange-600/)
})

test('chord grid shows bar numbers', async ({ page }) => {
  // Bar number 1 should be visible for the first section
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible()
})
