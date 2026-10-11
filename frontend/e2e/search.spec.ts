import { expect, test } from '@playwright/test'

test('picks skills and streams ranked, decorated results from the real dataset', async ({
  page,
}) => {
  await page.goto('/')

  const addSkill = page.getByRole('combobox', { name: /add a skill/i })
  await expect(addSkill).toBeVisible()

  await addSkill.selectOption({ label: 'Attack' })
  await page.getByRole('spinbutton').first().fill('15')

  await page.getByRole('button', { name: /^search$/i }).click()

  const firstResult = page.getByText(/surplus:/i).first()
  await expect(firstResult).toBeVisible()

  // The result actually came from the real exported dataset and a real
  // search, not a stub -- it names a genuine piece of equipment and reports
  // the skill the query asked for.
  await expect(page.getByText(/^head:/i).first()).toBeVisible()
  await expect(page.getByText(/attack:\s*\d+/i).first()).toBeVisible()
})

test('shows an empty-results message for a requirement nothing can meet', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('combobox', { name: /add a skill/i }).selectOption({ label: 'Attack' })
  await page.getByRole('spinbutton').first().fill('999999')

  await page.getByRole('button', { name: /^search$/i }).click()

  await expect(page.getByText(/no matching builds found/i)).toBeVisible()
})
