import { expect, test } from '@playwright/test'

test('picks skills and streams ranked, decorated results from the real dataset', async ({
  page,
}) => {
  await page.goto('/')

  const addSkill = page.getByRole('combobox', { name: /add a skill/i })
  await expect(addSkill).toBeVisible()

  await addSkill.selectOption({ label: 'Attack' })
  // Attack has real point-threshold levels (scraped from a second data
  // source -- see docs/data-format-notes.md "Skill tiers"), so picking it
  // renders a level select rather than a raw points input; this exercises
  // that real level-selection flow end to end.
  await page
    .getByRole('combobox', { name: /attack level/i })
    .selectOption({ label: 'Attack Up (Small)' })

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

  // Adrenaline's source data has two ambiguous, unparseable point values per
  // tier (see parse/skill_tiers.py's module docstring), so it has no tiers
  // and still falls back to a raw points input -- useful here since this
  // test needs an arbitrarily large, unachievable target.
  await page.getByRole('combobox', { name: /add a skill/i }).selectOption({ label: 'Adrenaline' })
  await page.getByRole('spinbutton').first().fill('999999')

  await page.getByRole('button', { name: /^search$/i }).click()

  await expect(page.getByText(/no matching builds found/i)).toBeVisible()
})
