# Advanced Web Scraping System

Este repositório contém um sistema avançado de web scraping com recursos sofisticados para lidar com medidas anti-scraping, gerenciamento de erros e otimização de desempenho.

## Visão Geral

Uma solução de web scraping de alto desempenho, resiliente e modular construída com Node.js.

## Principais Recursos

### Serviços Principais

- **Tratamento de Captcha**: Integração com serviços externos de resolução de captcha como 2Captcha, AntiCaptcha e CapMonster.
- **Padrão Circuit Breaker**: Previne solicitações repetidas a domínios com falha, com recuperação automática.
- **Classificação de Erros**: Detecção e classificação sofisticada de erros com estratégias condicionais de retry.
- **Rotação de Proxies**: Gerenciamento inteligente de proxies com monitoramento de saúde e rastreamento de desempenho.
- **Medidas Anti-Detecção**: Rotação de user-agent, mascaramento de impressão digital, suporte a proxy.
- **Controle de Concorrência**: Scraping paralelo gerenciado com limites configuráveis.
- **Monitoramento e Logging**: Logs JSON estruturados e métricas de desempenho.

### Destaques da Arquitetura

- **Registro de Serviços**: Acesso centralizado a todos os serviços com inicialização e limpeza eficientes.
- **Utilitários Compartilhados**: Funções comuns extraídas para evitar duplicação de código.
- **Carregamento Lazy**: Serviços são carregados sob demanda para minimizar o tempo de inicialização.
- **Estratégia de Cache**: Cache em múltiplos níveis para reduzir chamadas de API externas e melhorar desempenho.
- **Arquitetura Modular**: Clara separação entre componentes (adaptadores, serviços, controladores).
- **Padrão Adapter**: Suporte para múltiplos marketplaces com interface unificada.

## Exemplos de Uso

### Scraping Básico com Retries e Tratamento de Erros

```javascript
const { retry, proxyRotation } = require('./src/services');

async function scrapeWebsite(url) {
  return retry.withRetry(async (state) => {
    // Obter uma instância axios habilitada para proxy
    const axios = proxyRotation.createAxiosInstanceWithProxy(url);
    
    // Fazer a solicitação com o estado atual
    const response = await axios.get(url);
    
    // Processar a resposta
    return processHtml(response.data);
  }, {
    context: { url },
    maxRetries: 5
  });
}
```

### Usando o Padrão Circuit Breaker

```javascript
const { circuitBreaker } = require('./src/services');

async function scrapeWithCircuitBreaker(url) {
  return circuitBreaker.executeWithCircuitBreaker(url, async () => {
    // Sua lógica de scraping aqui
    const response = await axios.get(url);
    return response.data;
  });
}
```

### Resolvendo Captchas

```javascript
const { captcha } = require('./src/services');

async function solveCaptchaAndSubmit(url, sitekey) {
  // Resolver reCAPTCHA
  const token = await captcha.solveRecaptchaV2({
    sitekey,
    url
  });
  
  // Enviar formulário com token
  return submitForm(url, { 'g-recaptcha-response': token });
}
```

## Estrutura do Projeto

```
src/
├── adapters/            # Adaptadores específicos para sites
│   ├── AbstractAdapter.js    # Interface base do adaptador
│   ├── AdapterFactory.js     # Fábrica para criar/gerenciar adaptadores
├── config/              # Gerenciamento de configuração
├── controllers/         # Controladores principais da aplicação
├── middlewares/         # Middlewares Express
├── models/              # Modelos de dados
├── services/            # Serviços compartilhados
│   ├── browser/              # Gerenciamento de navegador
│   ├── cache/                # Caching
│   ├── captcha/              # Tratamento de captcha
│   │   └── captchaService.js  # Serviço de captcha
│   ├── circuitBreaker/       # Implementação do circuit breaker
│   │   └── circuitBreakerService.js # Serviço de circuit breaker
│   ├── error/                # Classificação de erros
│   │   └── errorClassificationService.js # Serviço de classificação de erros
│   ├── proxy/                # Gerenciamento de proxy
│   │   └── proxyRotationService.js # Serviço de rotação de proxy
│   ├── retry/                # Lógica de retry
│   │   └── retryService.js    # Serviço de retry
│   └── index.js              # Registro central de serviços
├── utils/               # Utilitários
│   ├── logger.js             # Utilitário de logging
│   ├── shared.js             # Funções compartilhadas
│   └── retry.js              # Lógica de retry com backoff exponencial
└── index.js             # Ponto de entrada principal da aplicação
```

## Visão Geral da Arquitetura

O sistema segue uma arquitetura modular com os seguintes componentes:

- **Serviços**: A funcionalidade principal é organizada em módulos de serviço que lidam com aspectos específicos do processo de scraping.
- **Utilitários**: Funções comuns usadas em todos os serviços.
- **Adaptadores**: Interfaces para serviços externos como solucionadores de captcha e proxies.

Cada serviço é implementado como um singleton para garantir o uso eficiente de recursos em toda a aplicação.

## Otimizações de Desempenho

- **Cache**: Múltiplas camadas de cache para reduzir operações redundantes.
- **Pool de Conexões**: Reutilização eficiente de conexões HTTP.
- **Gerenciamento de Recursos**: Alocação e liberação inteligente de recursos.
- **Concorrência Adaptativa**: Ajusta dinamicamente o número de solicitações simultâneas com base na resposta do site alvo.

## Tratamento de Erros e Recuperação

O sistema fornece tratamento robusto de erros com:

- **Classificação Detalhada de Erros**: Tipos de erro personalizados para diferentes cenários.
- **Lógica de Retry Condicional**: Diferentes estratégias de retry baseadas no tipo de erro.
- **Circuit Breaker**: Proteção automática contra sobrecarregar serviços com falha.
- **Degradação Graciosa**: Mecanismos de fallback quando os métodos primários falham.

## Configuração

A maioria dos serviços pode ser configurada através de variáveis de ambiente ou passando opções para os construtores de serviço.

Exemplo de arquivo `.env`:

```
CAPTCHA_SERVICE=2captcha
CAPTCHA_API_KEY=your_api_key
CAPTCHA_TOKEN_HARVESTING=true
PROXY_FILE=./proxies.json
```

## Instalação e Uso

### Pré-requisitos

- Node.js 20.0.0 ou superior
- npm ou yarn

### Instalação

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Copie o exemplo de variáveis de ambiente:
   ```bash
   cp .env.example .env
   ```
4. Personalize o arquivo `.env` com suas configurações

### Executando os Exemplos

Para testar o sistema, execute os exemplos fornecidos:

```bash
node examples/basic-test.js
```

## Adicionando Novos Adaptadores de Sites

Para adicionar suporte a um novo marketplace, crie uma nova classe adaptadora que estende `AbstractAdapter`:

1. Crie um arquivo em `src/adapters/<NomeSite>Adapter.js`
2. Implemente os métodos necessários (`extract`, `extractPriceFromHTML`, etc.)
3. Registre o adaptador em `AdapterFactory.js`

## Melhorias Futuras

- Migração para TypeScript para melhor segurança de tipo
- Suporte ao Puppeteer Cluster para melhor gerenciamento de recursos
- Implementação de fila de tarefas distribuída baseada em Redis
- Adição de técnicas mais sofisticadas de anti-fingerprinting
- Criação de um painel web para monitoramento e gerenciamento
- Implementação de frameworks de rotação de proxy

## Licença

MIT
