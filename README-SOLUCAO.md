# Solução para o erro de instalação do Playwright no Windows

Este documento explica como resolver o erro:
```
error installing Playwright browsers: Command failed: npx playwright install --with-deps chromium
```

## Solução rápida

Execute o comando:

```bash
npm run fix-playwright
```

## O que a solução faz

1. Detecta automaticamente sua instalação do Google Chrome
2. Configura o ambiente para usar o Chrome local ao invés de baixar o browser do Playwright
3. Cria os arquivos e diretórios necessários para compatibilidade
4. Remove arquivos desnecessários de tentativas anteriores de solução

## Requisitos

- Ter o Google Chrome instalado
- Permissões para acessar arquivos no diretório do projeto

## Como usar o servidor após a correção

Após executar a solução, inicie o servidor com:

```bash
npm run start:win
```

## Solução manual (se o script não funcionar)

1. Verifique se o Google Chrome está instalado
2. Crie um arquivo `browser-config.json` na raiz do projeto com o conteúdo:
   ```json
   {"chromiumPath":"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"}
   ```
3. Crie um arquivo `.env.local` com as variáveis:
   ```
   CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
   PLAYWRIGHT_BROWSERS_PATH=0
   ```

## Verificação

Para verificar se a solução funcionou, execute o servidor e confirme que ele inicia sem erro de instalação do Playwright. 