# SPX Toolkit

Extensão Chrome Manifest V3 com atualização automática a partir do repositório `iggr1/spx-extension-hub`.

## Estrutura

- `toolkit/extension/`: código-fonte da extensão.
- `toolkit/loader/`: instalador Windows e Native Messaging host.
- `toolkit/update.json`: versão publicada no canal estável.
- `toolkit/update-package/`: pacote aplicado pelos computadores instalados.
- `toolkit/build-update.ps1`: gera um pacote novo a partir de `extension/`.
- `toolkit/publish-update.ps1`: gera, commita e envia a atualização para `main`.

## Instalação

1. Baixe o pacote de distribuição do SPX Toolkit.
2. Execute `toolkit/loader/Instalar SPX Toolkit.bat`.
3. Abra `chrome://extensions/`, habilite o modo do desenvolvedor e carregue `%LOCALAPPDATA%\SPXToolkit\extension` sem compactação.

O ID é fixado pelo `key` do manifest e também é usado no Native Messaging host.

## Atualizações

A extensão consulta o Loader a cada 10 minutos. O Loader:

1. lê `toolkit/update.json`;
2. baixa `toolkit/update-package/package.json` e suas partes;
3. valida SHA-256 e a versão do manifest;
4. cria backup local;
5. aplica os arquivos do pacote;
6. mantém até 3 backups;
7. responde à extensão, que executa `chrome.runtime.reload()`.

Para publicar uma versão nova, altere a extensão, incremente `version` no `manifest.json` e execute `toolkit/publish-update.ps1` em um clone completo do repositório.

## Assets binários

O builder empacota **todos** os arquivos existentes em `toolkit/extension`, inclusive PNG/JPG/ZIP. Assim, futuras alterações de imagens também são propagadas. O pacote publicado nesta migração usa modo `overlay` para preservar as etiquetas grandes já instaladas e atualizar apenas código/configuração/ícones.

## Manifest V3

Nenhum JavaScript remoto é executado. O código é baixado pelo Loader para o disco local, validado e só então a extensão local é recarregada. Isso evita depender de código hospedado remotamente dentro do runtime da extensão.
