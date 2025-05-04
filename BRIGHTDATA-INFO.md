# Informações sobre o Proxy Bright Data

Este documento contém informações detalhadas sobre o uso do proxy Bright Data neste projeto.

## Configuração Atual

O projeto está configurado para usar o proxy residencial da Bright Data com as seguintes credenciais:

- **Host**: `brd.superproxy.io`
- **Porta**: `33335` (nova porta obrigatória com o novo certificado)
- **Usuário**: `brd-customer-hl_aa4b1775-zone-residential_proxy1`
- **Senha**: `15blqlg7ljnm`

## Onde o Proxy é Utilizado

O proxy da Bright Data está integrado em três principais componentes do projeto:

1. **Browser Service** (`src/services/browser/browserService.js`):
   - No método `getBrowser()` para toda instância do navegador criada
   - No método `createIsolatedContext()` para contextos isolados

2. **Token Harvester** (`src/services/captcha/tokenHarvester.js`):
   - No método `_harvestWithBrowser()` para coleta de tokens de captcha

3. **StealthPlugin** (`src/services/browser/stealthPlugin.js`):
   - Contém a configuração principal do proxy
   - Fornece a função `getProxySettings()` para usar em outros componentes

## Como Funciona a Integração

O arquivo `src/services/browser/stealthPlugin.js` define a constante `PROXY_CONFIG` com os dados do proxy e exporta uma função `getProxySettings()` que é usada pelos outros componentes.

```javascript
const PROXY_CONFIG = {
  server: 'brd.superproxy.io:33335',
  username: 'brd-customer-hl_aa4b1775-zone-residential_proxy1',
  password: '15blqlg7ljnm'
};

function getProxySettings() {
  return {
    server: PROXY_CONFIG.server,
    username: PROXY_CONFIG.username,
    password: PROXY_CONFIG.password
  };
}
```

Esta configuração é então usada nas instâncias de browser:

```javascript
const browser = await playwright.chromium.launch({
  ...defaultOptions,
  proxy: getProxySettings()
});
```

## Tipos de Proxy Disponíveis

A Bright Data oferece vários tipos de proxies. Este projeto está configurado para usar o proxy residencial, que permite acesso da perspectiva de dispositivos residenciais reais.

### Outros Tipos de Proxy

Se necessário, você pode alterar a configuração para usar outros tipos de proxy da Bright Data:

1. **Datacenter**: Mais rápido, mas menos eficaz para evitar bloqueios
   ```
   brd.superproxy.io:22225 (ou nova porta 33335)
   ```

2. **ISP**: Equilibra velocidade e detecção
   ```
   brd.superproxy.io:22225 (ou nova porta 33335)
   ```

3. **Mobile**: IPs de dispositivos móveis 
   ```
   brd.superproxy.io:22225 (ou nova porta 33335)
   ```

## Configuração de Países Específicos

A Bright Data permite direcionar o tráfego por país. Para isso, modifique o nome de usuário seguindo este formato:

```
brd-customer-hl_aa4b1775-zone-residential_proxy1-country-br:15blqlg7ljnm
```

Onde `br` é o código do país (Brasil).

Exemplos de outros países:
- EUA: `country-us`
- Reino Unido: `country-gb`
- Alemanha: `country-de`
- França: `country-fr`

## Controle de Uso e Custos

A Bright Data cobra com base no tráfego utilizado. Para evitar custos excessivos:

1. **Limite de requisições**: Configure o `MAX_CONCURRENT_SCRAPES` no arquivo .env para controlar o número de conexões simultâneas
2. **Cache**: Mantenha o cache ativado (`CACHE_ENABLED=true`) para evitar requisições repetidas
3. **Otimização de tráfego**: Use o método `_setupResourceOptimization` no browser service para bloquear recursos desnecessários

## Teste de Conexão

Para testar se o proxy está funcionando corretamente, execute:

```bash
curl -i --proxy brd.superproxy.io:33335 --proxy-user brd-customer-hl_aa4b1775-zone-residential_proxy1:15blqlg7ljnm --insecure "https://geo.brdtest.com/welcome.txt"
```

Você deverá ver informações sobre o IP e localização usados.

## Solução de Problemas

### Proxy não autorizado

Se receber erros de autenticação:
- Verifique se as credenciais estão corretas
- Confirme se sua conta da Bright Data está ativa e com saldo

### Bloqueios em sites específicos

Se alguns sites continuarem bloqueando mesmo com o proxy:
1. Tente usar um país específico na configuração do usuário
2. Reduza a frequência de requisições
3. Utilize o módulo StealthPlugin para evitar detecção
4. Aplique a rotação de User-Agents disponível no projeto

### Erros de SSL/Certificado

- Garanta que está usando a porta 33335 para o novo certificado
- Se persistir, use a opção `ignoreHTTPSErrors: true` nas configurações do browser

## Rotação de Proxy

Se necessário configurar rotação de IPs mais frequente, você pode modificar o parâmetro username para incluir a opção `session-`:

```
brd-customer-hl_aa4b1775-zone-residential_proxy1-session-{RANDOM}:15blqlg7ljnm
```

Onde `{RANDOM}` é um valor aleatório ou incrementado a cada requisição para forçar uma nova sessão com IP diferente. 