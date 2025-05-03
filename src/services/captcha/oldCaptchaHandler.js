class CaptchaHandler {
  constructor() {
    this.captchaDetected = false;
  }

  async detectCaptcha(page) {
    return await page.evaluate(() => {
      const captchaIndicators = [
        document.body.innerText.toLowerCase().includes('captcha'),
        document.body.innerText.toLowerCase().includes('robô'),
        document.body.innerText.toLowerCase().includes('verificação'),
        document.body.innerText.toLowerCase().includes('not a robot'),
        document.body.innerText.toLowerCase().includes('segurança'),
        !!document.querySelector('.g-recaptcha'),
        !!document.querySelector('.h-captcha'),
        !!document.querySelector('[data-sitekey]'),
        !!document.querySelector('iframe[src*="captcha"]'),
        !!document.querySelector('iframe[src*="recaptcha"]'),
        window.location.href.includes('captcha'),
        window.location.href.includes('challenge'),
        window.location.href.includes('security')
      ];
      return captchaIndicators.some(indicator => indicator === true);
    });
  }

  async bypassWithoutService(page) {
    try {
      await this.simulateHumanBehavior(page);
      const url = page.url();
      const bypassUrl = url.includes('?') ?
        `${url}&_bypass=${Date.now()}` :
        `${url}?_bypass=${Date.now()}`;
      await page.goto(bypassUrl, { waitUntil: 'networkidle0' });
      const stillCaptcha = await this.detectCaptcha(page);
      return !stillCaptcha;
    } catch (e) {
      console.error('Erro ao tentar bypass de captcha:', e);
      return false;
    }
  }

  async simulateHumanBehavior(page) {
    // Exemplo simples: mover mouse e scrollar
    await page.mouse.move(
      100 + Math.random() * 400,
      100 + Math.random() * 300,
      { steps: 10 + Math.floor(Math.random() * 25) }
    );
    await page.waitForTimeout(1200 + Math.random() * 2500);
    await page.evaluate(() => window.scrollBy({ top: 200 + Math.random() * 300, left: 0, behavior: 'smooth' }));
    await page.waitForTimeout(800 + Math.random() * 1200);
  }
}

module.exports = CaptchaHandler;
