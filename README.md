# SPX Extension Hub

> **Distribuição atual:** [TRILHO na Chrome Web Store](https://chromewebstore.google.com/detail/TRILHO/mbeceoiffpjhcjkmfhbjmabfcdbgkeml). Esta documentação descreve também o loader local legado.
>
> **Migração obrigatória até sábado, 31/10/2026.** Após essa data, os módulos do loader local serão removidos e deixarão de funcionar. Para continuar utilizando o TRILHO, instale-o pela loja, remova **SPX Extension Loader** em `chrome://extensions` e recarregue as abas SPX. O catálogo remoto exibe um aviso permanente. **Suporte:** igor.camara@shopee.com.


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

## Conta SPX e registro de uso

O ícone de usuário no cabeçalho do catálogo mostra a conta autenticada, o HUB atual e o perfil de acesso às ferramentas. A coleta de adoção pode registrar atividade do catálogo e dos três módulos em uma planilha Google, sem formulário por acesso.

O catálogo exige o **Loader 1.2.5 ou superior**. A versão 1.2.5 permite tentar ativar ou desativar user scripts mesmo quando o Chrome não consegue informar o estado atual e trata IDs ainda não registrados durante a ativação; a API confirma ou rejeita a operação. O perfil do catálogo usa `account.read` para ler somente os três endpoints de identidade do SPX. Em versões anteriores, os agentes nas abas SPX podem registrar uso na planilha enquanto o perfil do catálogo permanece indisponível. Use **Atualizar loader** e recarregue a extensão para aplicar as correções. As permissões de host HTTP/HTTPS continuam opcionais e o Chrome só concede acesso às páginas que o usuário autorizar.

O receptor está em [Coleta_Hubs_SPX.gs](telemetry/Coleta_Hubs_SPX.gs). Consulte o [tutorial de implantação e configuração](telemetry/README.md). A configuração inicial em `launcher/usage-config.json` vem desativada até a publicação do WebApp e inclusão da URL `/exec`.

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

## PDF de descrição dos módulos

Cada módulo pode publicar um PDF próprio, exibido na sidebar à direita da central.

1. Adicione o arquivo dentro da pasta do módulo, por exemplo `modules/meu-modulo/descricao.pdf`.
2. No objeto correspondente em `catalog.json`, informe a URL pública no campo `descriptionPdf`.

Exemplo:

```json
{
  "id": "meu-modulo",
  "descriptionPdf": "https://iggr1.github.io/spx-extension-hub/modules/meu-modulo/descricao.pdf"
}
```

Quando o campo não estiver presente, o botão **Descrição** ficará desabilitado. O PDF é aberto dentro do launcher, sem criar uma nova aba.

## Acesso dos módulos

O **Importador de Planilhas** é livre e funciona no Google Sheets, com botão Importar e arraste de CSV/XLSX sobre a planilha. Oferece criar uma planilha, substituir a aba atual, adicionar abas ou substituir tudo, preparando o fluxo nativo para confirmação em **Importar dados**. Detalhes e limitações: [README do módulo](modules/importador-de-planilhas/README.md).

O Assistente de devoluções usa a sessão existente do SPX e exige e-mail válido `@shopee.com` mais os aliases `RESOLVE_EO` e `CANCEL_EO_REASON`. A regra é verificada no catálogo e durante a execução na página SPX. O Dock Flow continua livre no catálogo.

A autenticação anterior por código de e-mail/Sheets/Apps Script foi removida. O novo catálogo descarta as antigas sessões locais e não acessa mais o webapp. Implantações externas antigas podem ser desativadas pelo proprietário no Apps Script; removê-las do repositório não exclui a implantação nem a planilha.

A política está em `shared/spx-access.js` e é incorporada ao user script independente. Ao editá-la, sincronize a cópia incorporada; o teste verifica a igualdade. O bridge e o código do loader não foram alterados.
