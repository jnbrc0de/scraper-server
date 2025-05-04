# Scraper Server

Sistema de web scraping de alta performance com recursos avançados de proxy, anti-detecção e resiliência.

## Principais Recursos

- **Anti-Detecção Avançada**: Bypass automático de medidas anti-bot usando técnicas de evasão
- **Proxy Residencial Integrado**: Integração com Bright Data para acesso via IPs residenciais
- **Gerenciamento de Proxies**: Rotação inteligente com base no desempenho
- **Detecção de Captcha**: Identificação e resolução automática de diferentes tipos de captcha
- **Arquitetura Modular**: Design extensível com adaptadores para diferentes sites
- **Gerenciamento de Recursos**: Otimização de uso de memória e processamento
- **Cache Inteligente**: Minimiza requisições repetidas
- **Tolerância a Falhas**: Múltiplas estratégias de retry e fallback

## Configuração

### Requisitos

- Node.js 20+
- NPM 10+
- 2GB RAM (recomendado)

### Instalação Rápida

```bash
# Clonar o repositório
git clone https://github.com/seu-usuario/scraper-server.git
cd scraper-server

# Instalar dependências e configurar o ambiente
npm run setup

# Iniciar em modo de produção
npm run prod
```

Para configuração detalhada, consulte [SETUP.md](SETUP.md).

## Uso da API

O servidor expõe uma API REST para realizar scraping:

### Obter preço de um produto

```bash
curl -X POST http://localhost:3000/api/scrape/price \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.example.com/product/123"}'
```

Resposta:

```json
{
  "success": true,
  "cached": false,
  "price": 129.99,
  "title": "Produto Exemplo",
  "url": "https://www.example.com/product/123"
}
```

### Extrair múltiplos produtos

```bash
curl -X POST http://localhost:3000/api/scrape/batch \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.example.com/product/123",
      "https://www.example.com/product/456"
    ],
    "concurrency": 2
  }'
```

## Estrutura do Projeto

```
scraper-server/
├── src/
│   ├── adapters/        # Adaptadores específicos para sites
│   ├── config/          # Configurações centralizadas
│   ├── controllers/     # Controladores da API
│   ├── services/        # Serviços principais
│   │   ├── browser/     # Gerenciamento de navegadores
│   │   ├── cache/       # Serviço de cache
│   │   ├── captcha/     # Detecção e resolução de captchas
│   │   ├── proxy/       # Gerenciamento de proxies
│   │   └── ...          
│   └── utils/           # Utilitários
├── logs/                # Logs da aplicação
├── screenshots/         # Capturas de tela (debugging)
└── tokens/              # Tokens armazenados
```

## Proxy Bright Data

Este projeto utiliza o proxy residencial da Bright Data para melhorar a taxa de sucesso do scraping. A configuração do proxy é feita automaticamente durante o setup.

Para mais detalhes sobre a configuração e uso do proxy, consulte [BRIGHTDATA-INFO.md](BRIGHTDATA-INFO.md).

## Desenvolvimento

```bash
# Iniciar em modo de desenvolvimento com hot reload
npm run dev

# Executar linting
npm run lint

# Formatar código
npm run format
```

### Adicionando suporte a novos sites

Para adicionar suporte a um novo site, crie um adaptador em `src/adapters/` seguindo o padrão dos adaptadores existentes. O adaptador deve implementar as seguintes funções:

- `isBlocked(page)`: Detecta se o acesso está bloqueado
- `preProcess(page)`: Preparações antes da extração
- `extract(page)`: Extrai dados da página
- `canHandle(url)`: Verifica se o adaptador pode lidar com a URL

## Solução de Problemas

Consulte o arquivo [SETUP.md](SETUP.md) para dicas de solução de problemas comuns.

## Próximos Passos

- [ ] Suporte para extração de imagens
- [ ] Interface de administração web
- [ ] Suporte a extração de horários de disponibilidade
- [ ] Análise de sentimento em reviews

## Licença

Este projeto está licenciado sob a licença MIT - veja o arquivo LICENSE para detalhes.
