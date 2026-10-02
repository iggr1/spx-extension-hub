# Código-fonte do SPX Toolkit

O ZIP de distribuição contém a pasta `toolkit/extension` completa, incluindo as etiquetas e demais assets binários.

Para desenvolver pelo GitHub, copie essa pasta completa para este diretório, altere os arquivos, incremente `version` em `manifest.json` e execute `../publish-update.ps1`. O script gera `update-package/` com código e assets e envia a nova versão para `main`.

O canal ativo consumido pelos computadores é `toolkit/update.json` + `toolkit/update-package/`.
