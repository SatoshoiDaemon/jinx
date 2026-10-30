---
name: squarecloud-deployment
description: Ativa ao usar @squarecloud/api, preparar o ZIP de um bot, fazer deploy ou investigar falhas de hospedagem na Square Cloud.
---

# Square Cloud

## Versão e APIs

Em 2026-10-29, a versão publicada mais recente confirmada de `@squarecloud/api` é `6.0.0`, com requisito `Node.js >=22.0.0`. Antes de cada tarefa, confira a versão resolvida no pacote que executa o SDK e consulte a documentação oficial correspondente; não atualize dependências nem copie exemplos v5 sem pedido. No v6, os métodos ficam no cliente (`api.apps.*`), os resultados são dados simples, e não se deve usar exemplos antigos de instâncias `app`, cache ou eventos removidos.

## Preparação do pacote

Empacotar é uma operação local: montar um ZIP não o envia para a Square Cloud. A chamada do SDK é uma operação de rede separada que envia o arquivo.

- Coloque `squarecloud.app` na raiz do ZIP. Confira se `MAIN` aponta para um arquivo principal existente dentro do pacote e se `package.json` lista as dependências necessárias. Inclua o código-fonte/build e os assets requeridos, preservando os caminhos usados pelo projeto.
- Exclua `node_modules`, `.git`, `.env` e chaves/certificados privados de `certs/`. Não abra nem imprima `.env` ou conteúdo de certificados privados; só inclua material público de `certs/` quando for comprovadamente necessário ao runtime.
- A plataforma instala dependências a partir de `package.json`; não inclua `node_modules` no arquivo.
- Se usar a CLI para criar o pacote, confira as regras existentes de `squarecloud.ignore`; para ZIP manual, aplique as exclusões ao conjunto de arquivos selecionado e confira a estrutura final sem abrir arquivos privados.

## Operações do SDK v6

Use os métodos documentados para a versão efetiva do projeto:

- Nova aplicação e upload/deploy: `api.apps.create(zipPath)`.
- Atualizar aplicação existente: `api.apps.commit(appId, zipPath)`. O ZIP é descompactado na raiz do app por padrão; o commit não reinicia o processo.
- Aplicar atualização: `api.apps.restart(appId)`.
- Consultar estado: `api.apps.status(appId)`.
- Ler saída recente do console: `api.apps.logs(appId)`; a resposta é uma string e pode conter dados sensíveis.

`create`, `commit` e `restart` alteram a hospedagem. Só os invoque quando o usuário tiver pedido explicitamente a operação correspondente. Para diagnosticar, use status/logs conforme solicitado e oculte qualquer segredo encontrado antes de compartilhar a saída.

Mantenha `SQUARECLOUD_API_KEY` em variável de ambiente ou armazenamento de segredos. Nunca inclua o valor no código, no ZIP, em comandos/logs ou na resposta. Trate `SquareCloudAPIError` pela versão instalada (no v6, use `status` e `code` para classificar); não engula falhas nem exponha mensagens que contenham credenciais.

Referências oficiais: [SDK JavaScript e requisitos](https://docs.squarecloud.app/en/sdks/js/client), [upload e commit](https://docs.squarecloud.app/en/sdks/js/commit_and_upload), [controle, status e logs](https://docs.squarecloud.app/en/sdks/js/managing_application), [guia de Node.js e bots](https://docs.squarecloud.app/en/articles/getting-started-with-nodejs), [configuração `squarecloud.app`](https://docs.squarecloud.app/en/getting-started/config-file), [regras de empacotamento da CLI](https://docs.squarecloud.app/en/getting-started/squarecloud-ignore), [changelog/release v6](https://docs.squarecloud.app/en/changelog) e [metadados da versão no npm](https://registry.npmjs.org/@squarecloud%2fapi/latest).
