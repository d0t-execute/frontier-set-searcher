import { expect, test } from '@playwright/test'

test('picks skills and streams ranked, decorated results from the real dataset', async ({
  page,
}) => {
  await page.goto('/')

  const addSkill = page.getByRole('textbox', { name: /add a skill/i })
  await expect(addSkill).toBeVisible()

  await addSkill.fill('Attack')
  await page.getByRole('button', { name: 'Attack', exact: true }).click()
  // Attack has real point-threshold levels (scraped from a second data
  // source -- see docs/data-format-notes.md "Skill tiers"), so picking it
  // renders a level select rather than a raw points input; this exercises
  // that real level-selection flow end to end.
  await page
    .getByRole('combobox', { name: /attack level/i })
    .selectOption({ label: 'Attack Up (Small)' })

  await page.getByRole('button', { name: /^search$/i }).click()

  const firstResult = page.getByText(/active skill cap:/i).first()
  await expect(firstResult).toBeVisible({ timeout: 30_000 })

  // The result actually came from the real exported dataset and a real
  // search, not a stub -- it names a genuine piece of equipment and reports
  // the skill the query asked for. Only "Small" is requested (>=10 points),
  // but the optimal build's actual Attack total can legitimately cross into
  // a higher tier (e.g. "Large"), so this doesn't assert a specific tier --
  // just that a real, tiered Attack Up result is shown.
  await expect(page.getByText(/^head:/i).first()).toBeVisible()
  await expect(page.getByText(/attack up \([^)]+\) \(\d+\/\d+\)/i).first()).toBeVisible()
})

test('shows an empty-results message for a requirement nothing can meet', async ({ page }) => {
  await page.goto('/')

  // Every real skill now has at least one tier (confirmed against the
  // current dataset), so there's no longer an untiered skill to type an
  // arbitrarily large raw point target into. Instead, this stacks the
  // highest tier of four separate, commonly-rolled skills at once --
  // individually reachable (so the app's own preflight feasibility check
  // lets the search through), but not simultaneously satisfiable by any
  // real 5-armor-slot build, so the solver itself comes back with nothing
  // (confirmed live against the real dataset before writing this).
  const addSkill = page.getByRole('textbox', { name: /add a skill/i })
  for (const skill of ['Attack', 'Defense', 'Expert', 'Strong Attack']) {
    await addSkill.fill(skill)
    await page.getByRole('button', { name: skill, exact: true }).click()
  }

  await page.getByRole('button', { name: /^search$/i }).click()

  await expect(page.getByText(/no matching builds found/i)).toBeVisible({ timeout: 30_000 })
})
