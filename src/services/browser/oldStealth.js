class EnhancedStealth {
  async applyToPage(page) {
    // 1. Modificar fingerprints de JavaScript
    await page.evaluateOnNewDocument(() => {
      // Modificar detecção canvas
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
        const imageData = originalGetImageData.call(this, x, y, w, h);
        for (let i = 0; i < imageData.data.length; i += 100) {
          if (Math.random() < 0.3) {
            const pixel = Math.floor(Math.random() * 4);
            if (imageData.data[i + pixel] > 0) {
              imageData.data[i + pixel] -= 1;
            } else {
              imageData.data[i + pixel] += 1;
            }
          }
        }
        return imageData;
      };

      // WebDriver e automation
      Object.defineProperty(navigator, 'webdriver', { get: () => false });

      // Language e plataforma consistentes
      Object.defineProperty(navigator, 'language', { get: () => 'pt-BR' });
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

      // Plugins falsificados
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', description: '', filename: 'internal-nacl-plugin' }
          ];
          const pluginArray = Object.create(PluginArray.prototype);
          pluginArray.length = plugins.length;
          plugins.forEach((plugin, i) => {
            const pluginObj = Object.create(Plugin.prototype);
            Object.defineProperties(pluginObj, {
              name: { value: plugin.name },
              description: { value: plugin.description },
              filename: { value: plugin.filename }
            });
            Object.defineProperty(pluginArray, i, { value: pluginObj });
            Object.defineProperty(pluginArray, plugin.name, { value: pluginObj });
          });
          return pluginArray;
        }
      });

      // Definir funcionamento consistente de media devices (evita fingerprintings)
      const enumerateDevices = MediaDevices.prototype.enumerateDevices;
      MediaDevices.prototype.enumerateDevices = function() {
        return enumerateDevices.call(this).then(devices => {
          return devices.map(device => {
            const deviceWithRandomId = Object.create(device);
            Object.defineProperty(deviceWithRandomId, 'deviceId', {
              get: () => {
                const seeds = '0123456789abcdef';
                const randomId = Array(32).fill()
                  .map(() => seeds[Math.floor(Math.random() * seeds.length)])
                  .join('');
                return randomId;
              }
            });
            return deviceWithRandomId;
          });
        });
      };
    });

    // 2. Configurar cabeçalhos específicos
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not-A.Brand";v="24"',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-mobile': '?0',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0'
    });
  }
}

module.exports = EnhancedStealth;
