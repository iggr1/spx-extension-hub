# SPX Extension Loader 1.1.0

Loader modular para ferramentas operacionais publicadas no repositório `iggr1/spx-extension-hub`.

## Novidades da versão 1.1.0

- Suporte genérico a módulos do tipo `user_script` com switch ligado/desligado no catálogo.
- Estado do switch persistido no Chrome.
- Registro e remoção dinâmica por `chrome.userScripts`.
- Recarregamento das abas compatíveis ao ativar ou desativar um módulo.
- Atualização automática do código remoto dos user scripts ativos quando o catálogo é sincronizado.

## Instalação

1. Extraia o ZIP.
2. Abra `chrome://extensions`.
3. Ative o modo do desenvolvedor.
4. Use **Carregar sem compactação** e selecione a pasta extraída.
5. Nos detalhes da extensão, ative **Permitir scripts de usuário**.

Quando um módulo exigir uma permissão ainda não prevista, contate `igor.camara@shopee.com`.
