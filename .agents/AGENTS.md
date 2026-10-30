# Jinx — instruções do repositório

## Escopo

Jinx é um bot JavaScript para uma comunidade do Discord, inicialmente em uma guilda. O TDR-Bot é apenas uma referência conceitual antiga: não faça fork, migração nem cópia de código, estrutura ou banco de dados.

O escopo implementado nesta fase é comandos slash, níveis e XP, perfil Discord e configurações pelo painel no Discord. Não trate o projeto como SaaS, empresa, API genérica ou backend de propósito geral. Não crie servidor HTTP, comandos por prefixo, IA ou funcionalidades não solicitadas.

## Stack e arquitetura

- Use JavaScript ESM, `discord.js` e o driver oficial `mongodb`.
- `index.js` na raiz é o ponto de entrada da Square Cloud e inicializa módulos de `src/`.
- Mantenha o código em módulos pequenos por responsabilidade:
  - `src/commands/`: comandos slash e entrada de interações;
  - `src/events/`: eventos do Discord;
  - `src/models/`: acesso e estrutura dos dados MongoDB;
  - `src/modules/`: lógica por funcionalidade;
  - `src/database/`: conexão e inicialização MongoDB;
  - `src/config/`: configuração e validação do ambiente.
- Separe handlers de comandos, registro no Discord e lógica de negócio. Não concentre o bot em um arquivo central.
- Mantenha a base preparada para monorepo. Use `packages/` somente para pacote realmente reutilizável, com consumidor independente.
- Respeite o package manager e o lockfile adotados. Não mantenha lockfiles concorrentes.
- Prefira poucas dependências e soluções diretas. Não introduza Redis, TypeScript, servidores HTTP, camadas ou abstrações sem necessidade concreta.

## Discord

- Use somente comandos slash nesta fase e os intents necessários às funcionalidades implementadas. A concessão de XP usa o evento de mensagem sem ler seu conteúdo; não solicite Message Content Intent.
- Todas as mensagens destinadas aos membros devem usar Components V2. Não use `EmbedBuilder` nem misture embeds tradicionais com Components V2.
- Responda ou adie interações dentro do prazo do Discord. Componentes persistentes devem consultar o estado MongoDB e validar novamente a guilda, a pessoa e as permissões após cada reinício.
- Restrinja configurações e ajustes administrativos à permissão adequada e valide-a também no handler.

## MongoDB e Square Cloud

- Use o driver oficial `mongodb`; não adicione ODM sem necessidade concreta.
- A conexão MongoDB da Square Cloud usa TLS mútuo. Com o arquivo combinado `certs/certificate.pem`, defina `tls: true` e use o mesmo caminho em `tlsCAFile` e `tlsCertificateKeyFile`.
- Nunca leia, imprima, registre ou versione valores de `.env` ou o conteúdo de certificados.
- `.env`, `certs/` e `dist/` ficam ignorados pelo Git. Essa exclusão do Git não se aplica ao ZIP inicial da Square Cloud: o empacotador local deve incluir `.env` e `certs/certificate.pem` na raiz e no caminho esperados pelo runtime.
- A CI valida instalação e sintaxe/configuração sem secrets. Não crie deploy remoto nem publique artifact com credenciais nesta fase.
- Para uma futura reconstrução por GitHub Actions, os nomes previstos são `JINX_ENV_FILE_BASE64` e `JINX_MONGODB_CERTIFICATE_PEM_BASE64`. Base64 é codificação, não criptografia; jamais exponha os valores em código, logs, documentação ou artifacts públicos.

## Idioma

Comentários e logs devem ser escritos em português. Textos destinados aos membros devem estar em português do Brasil.
