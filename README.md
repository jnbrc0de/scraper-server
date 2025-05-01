# Scraper Híbrido Profissional

## Estratégia
- Tenta scraping HTTP direto (rápido e barato)
- Fallback automático para browser stealth (Playwright + Stealth)
- Rotação de User-Agent, headers e proxies
- Cache local para evitar requisições repetidas
- Delays e randomização para simular comportamento humano
- Logs para monitoramento e ajuste

## Como usar

```js
const { hybridScrape } = require('./hybridScraper');
const url = 'https://www.amazon.com.br/Apple-iPhone-15-128-GB/dp/B0CP6CR795';

(async () => {
    const html = await hybridScrape(url);
    // Parseie o HTML conforme necessário
})();
```

## Dicas para máxima eficiência

- Adicione proxies gratuitos ou baratos no array `proxies` do arquivo `hybridScraper.js`
- Use cache para evitar requisições repetidas
- Ajuste delays conforme o volume de scraping
- Monitore logs para identificar bloqueios e ajustar a estratégia
- Adapte o parser para cada marketplace conforme necessário

## Gerenciamento inteligente de proxies

- Proxies bloqueados são automaticamente desativados após 3 falhas.
- Proxies mais rápidos são priorizados.
- Estatísticas de sucesso/falha e latência são monitoradas em tempo real.

## Scraping paralelo

Use a função `parallelScrape` para processar múltiplas URLs em paralelo:

```js
const { parallelScrape } = require('./hybridScraper');
const urls = [
    'https://www.amazon.com.br/...',
    'https://www.amazon.com.br/...',
    // ...
];
(async () => {
    const htmls = await parallelScrape(urls, 'SUA_2CAPTCHA_KEY', 5); // 5 workers paralelos
    // htmls é um array com o HTML de cada URL
})();
```

## Logs estruturados e métricas

- Cada tentativa de scraping gera um log JSON estruturado com status, marketplace, bloqueio e dados extraídos.
- Métricas globais e por marketplace podem ser acessadas via `getMetrics()`.

## Parsers modulares por marketplace

- O arquivo `hybridScraper.js` possui um objeto `parsers` para cada marketplace.
- Para adicionar ou ajustar a extração de dados, edite ou crie funções dentro do objeto `parsers`.

### Exemplo de uso

```js
const { hybridScrape, getMetrics } = require('./hybridScraper');
const url = 'https://www.amazon.com.br/Apple-iPhone-15-128-GB/dp/B0CP6CR795';

(async () => {
    const { html, parsed } = await hybridScrape(url);
    console.log('Dados extraídos:', parsed);
    console.log('Métricas:', getMetrics());
})();
```

## Dependências

- axios
- playwright-extra
- playwright-extra-plugin-stealth
- random-useragent

Instale com:
```
npm install axios playwright-extra playwright-extra-plugin-stealth random-useragent
```

# Segurança e Boas Práticas

- **NUNCA** use proxies gratuitos para dados sensíveis.
- Defina todas as chaves sensíveis via variáveis de ambiente (`.env`).
- O cache e os logs são criptografados. Troque as chaves periodicamente.
- Os logs são rotacionados e nunca devem ser expostos publicamente.
- O paralelismo é limitado por padrão. Ajuste conforme a capacidade do servidor.
- Mantenha todas as dependências sempre atualizadas.
- Sanitização básica é aplicada nos dados extraídos. Faça sanitização adicional se necessário.
- Não exponha dados extraídos diretamente para front-end sem validação/sanitização.
