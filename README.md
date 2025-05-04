# Scraper Server

High-performance, resilient, and modular web scraping server with built-in anti-detection features.

## Principais Recursos

- **Anti-Detecção Avançada**: Bypass automático de medidas anti-bot usando técnicas de evasão
- **Proxy Residencial Integrado**: Integração com Bright Data para acesso via IPs residenciais
- **Gerenciamento de Proxies**: Rotação inteligente com base no desempenho
- **Detecção de Captcha**: Identificação e resolução automática de diferentes tipos de captcha
- **Arquitetura Modular**: Design extensível com adaptadores para diferentes sites
- **Gerenciamento de Recursos**: Otimização de uso de memória e processamento
- **Cache Inteligente**: Minimiza requisições repetidas
- **Tolerância a Falhas**: Múltiplas estratégias de retry e fallback

## Installation

### Prerequisites
- Node.js >= 20.0.0
- NPM or Yarn

### Standard Installation

```bash
# Clone the repository
git clone <repository-url>
cd scraper-server

# Install dependencies
npm install

# Install Playwright browsers
npm run install-browsers
```

### Installation Troubleshooting

If you encounter errors during installation, particularly with Playwright browser installation, try the following solutions:

#### Windows

```bash
# Run the Windows-specific Chrome installation script
npm run install-chrome-windows

# Or use the fix-dependencies script to resolve plugin issues
npm run fix
```

#### Linux/Docker/Render

```bash
# Run the browser installation fix script
npm run fix-browser

# Or install system Chrome for containerized environments
sudo apt-get update && sudo apt-get install -y google-chrome-stable
```

## Configuration

Create a `.env` file in the root directory with the following content:

```
# Server
PORT=3000
NODE_ENV=production

# Browser Settings
BROWSER_POOL_SIZE=3
BROWSER_HEADLESS=true
MEMORY_LIMIT_MB=2048

# Proxy Settings (optional)
PROXY_ENABLED=false
PROXY_SERVER=
PROXY_USERNAME=
PROXY_PASSWORD=
```

### Using System Chrome

If you face issues with the Playwright browser download, you can configure the system to use your installed Chrome/Chromium by creating a `browser-config.json` file:

```json
{
  "chromiumPath": "/path/to/chrome"
}
```

On Windows, this is typically:
- `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`
- `C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe`

## Running

```bash
# Start the server
npm start

# Start in development mode with auto-reload
npm run dev
```

## Fixing Common Issues

### "Plugin dependency not found" Error

```bash
# Run the dependency fix script
npm run fix
```

### Browser Installation Error

```bash
# Run the browser installation fix script
npm run fix-browser
```

### Windows-specific Browser Issues

```bash
# Run the Windows-optimized Chrome installation
npm run install-chrome-windows
```

## Production Deployment Checklist

- [ ] Run `npm run fix` and `npm run fix-browser`
- [ ] Set up all required environment variables
- [ ] Ensure Chrome/Chromium is available with execute permissions
- [ ] Configure proper logging and monitoring
- [ ] Set up restart policies (PM2 or similar)
- [ ] Secure all exposed endpoints
- [ ] Test the scraping with real targets
- [ ] Configure appropriate resource limits

## License

MIT

## Endpoints

- `GET /health` - Verificar status do servidor
- `GET /scrape-price?url=URL_DO_PRODUTO` - Extrair preço de um URL
- `POST /scrape-batch` - Extrair preços em lote

## Solução de problemas comuns

### Erro: Cannot find module 'helmet'
Se encontrar este erro, execute:
```bash
npm run fix-dependencies
```

Ou instale manualmente:
```bash
npm install helmet compression
```

### Erro no captchaService
Se encontrar problemas relacionados ao serviço de captcha, você pode usar a versão simplificada que está incluída.

### Erros de permissão no PowerShell
Se encontrar erros relacionados a políticas de execução no PowerShell, você pode:

1. Abrir o PowerShell como administrador e executar:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

2. Ou usar o Node.js Command Prompt em vez do PowerShell.

3. Use o script de inicialização alternativo:
```bash
npm run start:win
```

## Manutenção

Para limpar arquivos temporários:
```bash
npm run cleanup
```

## Estrutura do Projeto

```