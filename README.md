# SPX Extension Hub

Este repositório contém todo o conteúdo remoto usado pelo **SPX Extension Loader**:

- `catalog.json`: catálogo e permissões declaradas pelos módulos.
- `launcher/`: central que lista os módulos disponíveis.
- `shared/loader-bridge.js`: cliente da ponte entre as páginas remotas e o loader.
- `modules/`: interfaces e regras de cada módulo.

## Publicação inicial

Crie o repositório público `iggr1/spx-extension-hub` e envie o conteúdo desta pasta para a branch `main`.

Depois, em **Settings > Pages**:

1. Selecione **Deploy from a branch**.
2. Escolha a branch `main`.
3. Escolha a pasta `/ (root)`.
4. Salve.

A página deverá ficar disponível em:

`https://iggr1.github.io/spx-extension-hub/launcher/`

O catálogo consumido pelo loader será:

`https://raw.githubusercontent.com/iggr1/spx-extension-hub/main/catalog.json`

## Atualizar um módulo

Altere os arquivos do módulo e incremente o campo `version` correspondente em `catalog.json`. O loader busca o catálogo novamente a cada cinco minutos e também permite atualização manual.

## Adicionar um módulo web

1. Crie uma pasta em `modules/<id>/`.
2. Publique sua página HTML, CSS e JavaScript nessa pasta.
3. Use `shared/loader-bridge.js` para solicitar capacidades ao loader.
4. Adicione uma entrada ao array `modules` de `catalog.json`.
5. Declare somente as capacidades, permissões, hosts e perfis de autenticação necessários.

Exemplo de chamada:

```js
const response = await LoaderBridge.request('storage.get', {
  keys: ['minhaConfiguracao']
});
```

## Adicionar um user script

O loader também suporta módulos do tipo `user_script`. O catálogo deve fornecer a URL HTTPS do código, os padrões de página e o contexto de execução. O usuário terá de ativar **Permitir scripts de usuário** nos detalhes da extensão.

## Permissões ausentes

Quando um novo módulo solicitar uma API do Chrome que não esteja prevista no `manifest.json` do loader, o módulo será bloqueado e a interface orientará o usuário a contatar:

`igor.camara@shopee.com`

Nesse caso específico, será necessária uma nova versão do loader. Alterações comuns em telas, regras, endpoints, estilos, módulos e versões não exigem alteração da extensão.

## Distribuição

O repositório remoto permite atualizar módulos sem empacotar novamente a extensão. Para publicação na Chrome Web Store, valide previamente a política de código remoto e o uso pretendido da API `chrome.userScripts`. Para uso interno, prefira uma política empresarial de instalação e controle do repositório.
