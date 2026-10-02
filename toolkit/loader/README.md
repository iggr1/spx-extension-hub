# SPX Toolkit Loader

O Loader instala a extensão em `%LOCALAPPDATA%\SPXToolkit\extension` e registra o Native Messaging host `com.spx.toolkit.updater` apenas para o usuário atual.

## Instalar

1. Extraia o ZIP completo.
2. Execute `Instalar SPX Toolkit.bat`.
3. Carregue `%LOCALAPPDATA%\SPXToolkit\extension` em `chrome://extensions/` usando **Carregar sem compactação**.

O canal de atualização usa o repositório público `iggr1/spx-extension-hub`, portanto os computadores não precisam armazenar token do GitHub.

A extensão possui ID estável definido pelo campo `key` do `manifest.json`; o mesmo ID é usado no `allowed_origins` do Native Messaging host.

## Atualização

A extensão chama o Loader a cada 10 minutos. O Loader lê `toolkit/update.json`, baixa `toolkit/update-package`, valida SHA-256, cria backup, aplica a atualização e a extensão executa `chrome.runtime.reload()`.

O builder suporta arquivos de código e também assets binários, incluindo PNG/JPG/ZIP.
