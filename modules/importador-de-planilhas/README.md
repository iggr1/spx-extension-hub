# Importador de Planilhas

Módulo livre do catálogo, com liga/desliga, executado no Google Sheets. Não usa a autenticação SPX, Apps Script, chaves de API ou um servidor de importação. Não armazena os arquivos no navegador nem os envia ao SPX.

## Uso

Se o loader informar que faltam permissões, clique em **Atualizar loader** no topo do HUB. O [tutorial de atualização](../../launcher/atualizar-loader.html) disponibiliza o ZIP completo e explica como substituir os arquivos da extensão.

1. Atualize o catálogo e ative **Importador de Planilhas** no launcher. Autorize os domínios do Google quando solicitado pelo loader.
2. Abra ou recarregue uma planilha editável no Google Sheets.
3. Clique em **Importar**, no canto inferior direito, ou arraste um CSV/XLSX sobre o meio da planilha. O arraste abre o painel com o arquivo selecionado.
4. Escolha **Criar nova planilha**, **Substituir aba atual**, **Adicionar novas abas** ou **Substituir tudo** e clique em **Continuar**.
5. O módulo abre a importação nativa, encaminha o arquivo e seleciona o destino. Confira as opções do Google (inclusive separador e conversão de números/datas) e clique em **Importar dados** para concluir.

CSV e XLSX: um arquivo por vez, até 50 MB. O Google aplica seus próprios limites de importação. **Adicionar novas abas** é o destino inicial e preserva as abas existentes.

## Excel e aba atual

O Google não oferece substituir somente a aba atual com XLSX. Nesse destino, o módulo lê o Excel localmente, permite escolher uma aba e gera um CSV com seus valores, incluindo resultados de fórmulas salvos no arquivo. Não conserva formatação, imagens, comentários, macros ou fórmulas. Datas são normalizadas. Até 2 milhões de células nessa conversão; arquivos protegidos por senha, ZIP64 e compressão diferente de DEFLATE/STORE não são suportados. Fórmulas sem resultado salvo são recusadas; abra e salve o Excel antes de importar.

Nos outros três destinos, o XLSX original é enviado ao importador do Google, que realiza a conversão habitual e importa todas as abas.

## Integração e limites

O script usa os controles visíveis do importador nativo (português/inglês). O auxiliar nos frames `docs.google.com` e `drive.google.com` encaminha o arquivo para o seletor de upload. As mensagens são restritas à janela da planilha, aos domínios declarados, a frames descendentes e a uma identificação temporária de cada importação.

O módulo não clica automaticamente na confirmação final nem anuncia sucesso de gravação apenas porque o upload terminou. Se a interface do Google mudar, faltar acesso a um frame, a planilha não permitir edição ou o upload expirar, mostra uma orientação para continuar na janela nativa. Para Excel convertido, também disponibiliza **Baixar CSV preparado**, permitindo selecionar o arquivo correto manualmente. Cancelar interrompe a preparação; se o seletor do Google já estiver aberto, feche-o também. O arraste próprio não intercepta o upload enquanto um diálogo do Google está aberto.

O loader precisa permitir scripts nos dois domínios declarados e registrar o script com `allFrames: true`. Esse repositório contém o catálogo remoto; caso o manifesto do loader restrinja esses domínios, será necessário habilitá-los na extensão.

## Testes

```sh
cd modules/importador-de-planilhas
npm ci
npm test
```

`jsdom` e Playwright são usados somente nos testes. O parser SAX 1.6.1 é incorporado ao script publicado, com licença em `SAX-LICENSE.md`; nenhum código é baixado durante a importação. Edite `src/importer.js` e execute `npm run build` para gerar o arquivo distribuído. A interface usa construção DOM e o XML é lido como dados, sem `innerHTML`, `DOMParser` ou criação de políticas Trusted Types. Os testes cobrem arquivos ZIP inválidos, compressão, valores do Excel, células esparsas, limites, abertura por arraste e seleção do destino no diálogo simulado. A validação final do seletor nativo deve ser feita em uma sessão Google editável.

Para testar em Chromium com Trusted Types obrigatório e criação de políticas bloqueada:

```sh
npx playwright install chromium
npm run test:browser
```

Também é possível apontar `CHROMIUM_EXECUTABLE_PATH` para um Chromium existente. O teste verifica CSV, XLSX compactado, seleção de aba, transferência entre frames e confirmação final manual em uma interface simulada.
