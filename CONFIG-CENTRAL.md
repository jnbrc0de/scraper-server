# Configuração Centralizada do Sistema de Web Scraping

Este documento centraliza todas as configurações necessárias para o projeto de web scraping, incluindo chaves de API, configurações de proxy, banco de dados e serviços externos.

## Como Usar

1. Copie as variáveis abaixo para um arquivo `.env` na raiz do projeto
2. Substitua os valores pelos seus próprios dados
3. Reinicie a aplicação para que as mudanças tenham efeito

## Variáveis de Ambiente

```env
# Configurações do Servidor
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Configurações do Navegador
BROWSER_POOL_SIZE=5
MAX_CONCURRENT_SCRAPES=10
BROWSER_TIMEOUT=60000
BROWSER_HEADLESS=true
BROWSER_TYPE=chromium  # chromium, firefox, webkit

# Configurações de Proxy
USE_PROXIES=true
PROXY_FILE=./proxies.json
PROXY_ROTATION_STRATEGY=performance  # performance, random, sequential
PROXY_HEALTH_CHECK_INTERVAL=900000  # 15 minutos em ms
PROXY_HEALTH_CHECK_URL=https://httpbin.org/ip
PROXY_BAN_DURATION=1800000  # 30 minutos em ms

# Serviços de Captcha
CAPTCHA_SERVICE=2captcha  # 2captcha, anticaptcha, capmonster
CAPTCHA_API_KEY=your_captcha_service_api_key
CAPTCHA_TOKEN_HARVESTING=true
CAPTCHA_HARVEST_INTERVAL=300000  # 5 minutos em ms
MANUAL_CAPTCHA_RESOLUTION=false
MANUAL_CAPTCHA_WEBHOOK=https://your-webhook-url.com/captcha

# Configurações do Circuit Breaker
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RESET_TIMEOUT=60000  # 1 minuto em ms
CIRCUIT_BREAKER_HALF_OPEN_REQUESTS=3

# Configurações de Retry
MAX_RETRIES=3
BASE_RETRY_DELAY=1000
RETRY_BACKOFF_FACTOR=1.5
MAX_RETRY_DURATION=300000  # 5 minutos em ms

# Configurações de Cache
CACHE_ENABLED=true
CACHE_TTL=3600  # 1 hora em segundos
CACHE_MAX_SIZE=1000
CACHE_STORAGE=memory  # memory, redis

# Configurações do Redis (se CACHE_STORAGE=redis)
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_PREFIX=scraper:

# Configurações do Banco de Dados
DB_TYPE=supabase  # supabase, postgres, mongodb
SUPABASE_URL=https://your-supabase-url.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Para PostgreSQL (se DB_TYPE=postgres)
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=scraper
PG_USER=postgres
PG_PASSWORD=postgres

# Para MongoDB (se DB_TYPE=mongodb)
MONGODB_URI=mongodb://localhost:27017/scraper

# Configurações de Notificação
NOTIFICATION_ENABLED=false
EMAIL_NOTIFICATIONS=false
EMAIL_SERVICE=smtp  # smtp, sendgrid, mailgun
EMAIL_FROM=alerts@yourcompany.com
EMAIL_TO=admin@yourcompany.com
EMAIL_HOST=smtp.yourcompany.com
EMAIL_PORT=587
EMAIL_USER=smtp_user
EMAIL_PASSWORD=smtp_password

# Configurações de Monitoramento e Métricas
ENABLE_METRICS=true
METRICS_PORT=9090
HEALTH_CHECK_PATH=/health

# Configurações de Anti-Detecção
USER_AGENT_ROTATION=true
RANDOMIZE_VIEWPORT=true
EMULATE_USER_BEHAVIOR=true
JS_EXECUTION_DEFER=true

# Configurações de Recursos e Desempenho
CONNECTION_POOL_SIZE=100
REQUEST_TIMEOUT=30000
MAX_MEMORY_USAGE_MB=1024
PERFORMANCE_MODE=balanced  # balanced, aggressive, conservative
```

## Formato do Arquivo de Proxies (proxies.json)

```json
[
  {
    "id": "proxy_1",
    "url": "http://username:password@proxy1.example.com:8080",
    "type": "http",
    "country": "US",
    "city": "New York",
    "isp": "Example ISP",
    "tags": ["shopping", "residential"],
    "enabled": true
  },
  {
    "id": "proxy_2",
    "url": "http://username:password@proxy2.example.com:8080",
    "type": "http",
    "country": "UK",
    "city": "London",
    "isp": "Example ISP 2",
    "tags": ["social", "datacenter"],
    "enabled": true
  },
  {
    "id": "proxy_3",
    "url": "socks5://username:password@proxy3.example.com:1080",
    "type": "socks5",
    "country": "DE",
    "city": "Berlin",
    "isp": "Example ISP 3",
    "tags": ["backup", "residential"],
    "enabled": true
  }
]
```

## Guia de Configuração por Serviço

### Serviços de Captcha

#### 2Captcha
1. Crie uma conta em [2captcha.com](https://2captcha.com)
2. Obtenha sua chave API na seção de configurações da conta
3. Defina `CAPTCHA_SERVICE=2captcha` e `CAPTCHA_API_KEY=sua_chave_api`

#### AntiCaptcha
1. Crie uma conta em [anti-captcha.com](https://anti-captcha.com)
2. Obtenha sua chave API na seção de configurações da conta
3. Defina `CAPTCHA_SERVICE=anticaptcha` e `CAPTCHA_API_KEY=sua_chave_api`

#### CapMonster
1. Crie uma conta em [capmonster.cloud](https://capmonster.cloud)
2. Obtenha sua chave API na seção de configurações da conta
3. Defina `CAPTCHA_SERVICE=capmonster` e `CAPTCHA_API_KEY=sua_chave_api`

### Banco de Dados

#### Supabase
1. Crie um projeto em [supabase.com](https://supabase.com)
2. Obtenha a URL e as chaves de API na seção de configurações do projeto
3. Defina as variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_KEY`

#### PostgreSQL
1. Configure um servidor PostgreSQL
2. Defina as variáveis `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER` e `PG_PASSWORD`
3. Defina `DB_TYPE=postgres`

#### MongoDB
1. Configure um servidor MongoDB ou use MongoDB Atlas
2. Defina a variável `MONGODB_URI` com a string de conexão
3. Defina `DB_TYPE=mongodb`

### Serviços de Email

#### SMTP
1. Configure as variáveis `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER` e `EMAIL_PASSWORD`
2. Defina `EMAIL_SERVICE=smtp`

#### SendGrid
1. Crie uma conta em [sendgrid.com](https://sendgrid.com)
2. Obtenha sua chave API
3. Defina `EMAIL_SERVICE=sendgrid` e adicione a chave API em `EMAIL_PASSWORD`

#### Mailgun
1. Crie uma conta em [mailgun.com](https://mailgun.com)
2. Obtenha sua chave API e domínio
3. Defina `EMAIL_SERVICE=mailgun` e adicione a chave API em `EMAIL_PASSWORD`

## Exemplos de Configuração para Casos de Uso Específicos

### Configuração para Alta Performance
```
MAX_CONCURRENT_SCRAPES=20
BROWSER_POOL_SIZE=10
CONNECTION_POOL_SIZE=200
PERFORMANCE_MODE=aggressive
CACHE_ENABLED=true
CACHE_STORAGE=redis
```

### Configuração para Anti-Detecção Avançada
```
USER_AGENT_ROTATION=true
RANDOMIZE_VIEWPORT=true
EMULATE_USER_BEHAVIOR=true
JS_EXECUTION_DEFER=true
USE_PROXIES=true
PROXY_ROTATION_STRATEGY=random
CAPTCHA_TOKEN_HARVESTING=true
```

### Configuração para Economia de Recursos
```
BROWSER_POOL_SIZE=2
MAX_CONCURRENT_SCRAPES=5
PERFORMANCE_MODE=conservative
BROWSER_HEADLESS=true
MAX_MEMORY_USAGE_MB=512
``` 