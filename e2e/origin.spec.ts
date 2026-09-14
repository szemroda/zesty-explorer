import { expect, test } from '@playwright/test';

test('redirects an IPv4 loopback URL to canonical localhost without changing the view URL', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173/saved/view?lang=en-US#shared-view');

  await expect(page).toHaveURL('http://localhost:5173/saved/view?lang=en-US#shared-view');
});
