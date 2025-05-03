// Funções utilitárias para valores aleatórios
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomIntBetween(min, max) {
  return Math.floor(randomBetween(min, max));
}

/**
 * Simula navegação humana realista na página.
 * Inclui movimento de mouse, scroll e foco em elementos.
 */
async function simulateRealisticBrowsing(page, options = {}) {
  await page.mouse.move(
    100 + randomBetween(0, 400),
    100 + randomBetween(0, 300),
    { steps: 10 + randomIntBetween(0, 25) }
  );

  await page.waitForTimeout(1200 + randomBetween(0, 2500));

  await page.evaluate(() => {
    const scrollHeight = Math.min(
      document.body.scrollHeight,
      1500 + Math.random() * 1000
    );
    const scrollSteps = 8 + Math.floor(Math.random() * 12);
    const scrollDelay = 100 + Math.random() * 300;

    function smoothScroll(step) {
      if (step >= scrollSteps) return;
      const currentPos = window.scrollY;
      const targetPos = (scrollHeight / scrollSteps) * (step + 1);
      const delta = targetPos - currentPos;
      window.scrollBy({
        top: delta,
        left: 0,
        behavior: 'smooth'
      });
      setTimeout(() => smoothScroll(step + 1), scrollDelay);
    }
    smoothScroll(0);
  });

  const focusables = await page.$$('a, button, input, select, textarea');
  if (focusables.length > 0) {
    const idx = randomIntBetween(0, focusables.length);
    await focusables[idx].focus();
    await page.waitForTimeout(500 + randomBetween(0, 800));
  }
}

module.exports = { simulateRealisticBrowsing };
