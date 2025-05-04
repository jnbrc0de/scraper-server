# Scraper Server

High-performance, resilient, and modular web scraping server for price extraction.

## Principais Recursos

- **Anti-Detecção Avançada**: Bypass automático de medidas anti-bot usando técnicas de evasão
- **Proxy Residencial Integrado**: Integração com Bright Data para acesso via IPs residenciais
- **Gerenciamento de Proxies**: Rotação inteligente com base no desempenho
- **Detecção de Captcha**: Identificação e resolução automática de diferentes tipos de captcha
- **Arquitetura Modular**: Design extensível com adaptadores para diferentes sites
- **Gerenciamento de Recursos**: Otimização de uso de memória e processamento
- **Cache Inteligente**: Minimiza requisições repetidas
- **Tolerância a Falhas**: Múltiplas estratégias de retry e fallback

## Requisitos

- Node.js 20.0.0 ou superior
- NPM 10.0.0 ou superior

## Instalação

### Método padrão
```bash
npm install
```

### Solução para problemas de permissão em Windows PowerShell
Se você encontrar problemas ao executar o npm no PowerShell, como erros de permissão ou "Cannot find module 'helmet'", utilize o script de instalação de dependências:

```bash
node install-dependencies.js
```

Ou use o comando:
```bash
npm run fix-dependencies
```

## Uso

### Método padrão
Inicie o servidor:
```bash
npm start
```

### Método alternativo para Windows
Inicie com o script que verifica e instala dependências automaticamente:
```bash
npm run start:win
```
Ou diretamente:
```bash
node start-server.js
```

### Modo de desenvolvimento
```bash
npm run dev
```

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