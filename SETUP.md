# Configuração do Ambiente de Produção

Este documento contém as instruções para configurar o Scraper Server em um ambiente de produção.

## Requisitos

- Node.js versão 20.0.0 ou superior
- NPM 10.0.0 ou superior
- 2GB de RAM ou mais (recomendado)
- Conexão à internet estável

## Etapas de Instalação

### 1. Clonar o repositório

```bash
git clone https://github.com/seu-usuario/scraper-server.git
cd scraper-server
```

### 2. Instalar dependências

O projeto inclui um script para facilitar a instalação de todas as dependências necessárias, incluindo os plugins de evasão de detecção e as bibliotecas para proxy:

```bash
npm run setup
```

Este script também:
- Cria diretórios necessários (logs, screenshots, captchas, tokens)
- Configura os helpers para resolver dependências
- Cria um arquivo .env de exemplo se não existir
- Atualiza o package.json com scripts úteis

### 3. Configurar variáveis de ambiente

Edite o arquivo `.env` gerado automaticamente ou crie um novo:

```
# Configurações do servidor
PORT=3000
NODE_ENV=production

# Configurações do navegador
BROWSER_POOL_SIZE=2
MAX_CONCURRENT_SCRAPES=5
NAVIGATION_TIMEOUT=30000
WAIT_TIMEOUT=10000
SCRAPE_RETRIES=3
MEMORY_LIMIT_MB=400

# Configuração de proxy
USE_PROXIES=true
PROXY_ROTATION_STRATEGY=sequential

# Configuração de cache
CACHE_ENABLED=true
CACHE_TTL=3600

# Configuração de log
LOG_LEVEL=info
```

### 4. Configuração do proxy Bright Data (já implementada)

O projeto já está configurado para usar o proxy da Bright Data com as seguintes configurações:

- Host: `brd.superproxy.io`
- Porta: `33335`
- Usuário: `brd-customer-hl_aa4b1775-zone-residential_proxy1`
- Senha: `15blqlg7ljnm`

Estas configurações estão definidas no arquivo `src/config/index.js`. Não é necessário modificá-las a menos que você deseje usar um proxy diferente.

### 5. Iniciando o servidor em produção

Para iniciar o servidor em modo de produção:

```bash
npm run prod
```

Ou, usando o PM2 para gerenciar o processo (recomendado para produção):

```bash
npm install -g pm2
pm2 start server-start.js --name "scraper-server"
```

Para garantir que o serviço inicie automaticamente após reinicialização:

```bash
pm2 startup
pm2 save
```

## Comandos úteis

- `npm run dev`: Inicia o servidor em modo de desenvolvimento com recarregamento automático
- `npm run prod`: Inicia o servidor em modo de produção
- `npm run setup`: Executa a configuração inicial/reinstalação das dependências

## Estrutura de diretórios importantes

- `logs/`: Logs do sistema
- `screenshots/`: Capturas de tela geradas durante scraping
- `captchas/`: Imagens captcha que precisam de resolução manual
- `tokens/`: Tokens de autenticação armazenados

## Solução de problemas comuns

### Erro "Plugin dependency not found"

Se você encontrar erros relacionados às dependências do plugin stealth, execute:

```bash
npm run setup
```

Para reinstalar e configurar corretamente todas as dependências.

### Erros de conexão com o proxy

Verifique se o proxy da Bright Data está configurado corretamente e se sua conta está ativa.
Para testar o proxy manualmente:

```bash
curl -i --proxy brd.superproxy.io:33335 --proxy-user brd-customer-hl_aa4b1775-zone-residential_proxy1:15blqlg7ljnm --insecure "https://geo.brdtest.com/welcome.txt"
```

### Uso de memória elevado

Se o servidor estiver usando muita memória, ajuste os seguintes parâmetros no arquivo `.env`:

```
BROWSER_POOL_SIZE=1
MAX_CONCURRENT_SCRAPES=3
MEMORY_LIMIT_MB=300
```

## Monitoramento e manutenção

Recomendamos configurar monitoramento para o serviço, seja através do PM2 ou de uma ferramenta externa como o [Datadog](https://www.datadoghq.com/) ou [New Relic](https://newrelic.com/).

Para visualizar os logs em produção:

```bash
pm2 logs scraper-server
```

Para atualizar o serviço após mudanças no código:

```bash
git pull
npm run setup
pm2 restart scraper-server
``` 