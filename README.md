# Jinx

Bot privado de Discord, desenvolvido exclusivamente para uma guilda. `GUILD_ID` identifica a guilda autorizada: os slash commands são registrados nela, e mensagens e interações de outras guildas são ignoradas. O projeto usa JavaScript ESM, `discord.js` e o driver oficial `mongodb`.

## Desenvolvimento local

Requer Node.js 22 ou superior e npm.

```sh
npm ci
```

Em um checkout novo, crie `.env` somente se ainda não existir: `test -e .env || cp .env.example .env`. Preencha localmente `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `MONGODB_URI` e `GUILD_ID`. O `.env` já existente neste checkout pode ser mantido. Não compartilhe seus valores. A variável antiga `PREFIX`, se ainda existir no `.env`, não é usada.

Use a URI MongoDB da sua base e coloque o arquivo combinado `certificate.pem` fornecido pela Square Cloud em `certs/certificate.pem`. O driver usa TLS e aponta tanto `tlsCAFile` quanto `tlsCertificateKeyFile` para esse mesmo arquivo. O certificado é material privado e não deve ser copiado para documentação ou Git.

Inicie o bot com:

```sh
npm start
```

Ao iniciar, o bot conecta ao MongoDB, registra os comandos somente na guilda de `GUILD_ID` e conecta ao Gateway do Discord. No Discord Developer Portal, habilite os intents `Guilds`, `Guild Messages` e o intent privilegiado `Message Content` em **Bot → Privileged Gateway Intents**. O último é necessário para reconhecer expressões de dados enviadas como mensagens. Conceda ao bot acesso aos canais e permissão para responder e usar comandos. Pessoas que alteram configurações precisam de `Gerenciar servidor`.

## Comandos e utilitários

- `/choose opcoes`: escolhe uma alternativa entre opções separadas por vírgulas, por exemplo `pizza, hambúrguer, sushi`. Cada alternativa precisa ter conteúdo.
- Envie uma mensagem que contenha somente uma expressão de dados, como `1d20`, `2d6+3` ou `3d10-2`. A expressão inteira deve corresponder ao formato. São aceitos de 1 a 100 dados, de 2 a 1000 faces e modificadores entre -10000 e 10000.
- `/botinfo`, `/uptime`, `/ping` e `/help`: informações e ajuda.
- `/nivel consultar`: consulta seu nível e XP; informe `membro` para consultar outra pessoa.
- `/nivel adicionar` e `/nivel remover`: ajuste administrativo de níveis.
- `/xp adicionar` e `/xp remover`: ajuste administrativo de XP.
- `/perfil [membro]`: exibe informações básicas do perfil e o banner público, quando disponível.
- `/painel`: abre o centro administrativo, organizado em níveis e economia, tickets, boas-vindas públicas, sugestões, destaque de perfis, entrada de membros e núcleo do bot. Nesta etapa, os controles ativos são os de níveis e boosts; as demais funções são indicadas como indisponíveis até serem implementadas.

O XP total é a fonte de verdade. A pessoa começa no nível 1; o XP necessário para passar do nível `L` é `xpBase + L * xpStep`. O progresso atual é preservado ao ajustar níveis, limitado ao espaço disponível no nível de destino. Ao conceder XP em excesso, todos os níveis atingidos são calculados a partir do total.

Os valores iniciais são 5–15 XP por mensagem, cooldown de 60 segundos, `xpBase=100`, `xpStep=25` e boost máximo de 5×. Pessoas com permissão de `Gerenciar servidor` podem alterá-los no `/painel`.

Se vários cargos da pessoa tiverem boosts, vale o maior deles (ou 1 se nenhum se aplicar). Esse valor é multiplicado pelo boost do canal (ou 1). O XP sorteado é multiplicado pelo resultado e arredondado para baixo. O cooldown é atômico por membro. Bots e mensagens fora da guilda autorizada não recebem XP.

## Dados e configurações

As configurações ativas ficam no documento global `_id: "jinx:config"`, na coleção `bot_config`, agrupadas por módulo. O XP dos membros é armazenado por ID de usuário, sem `guildId` no documento.

Na primeira inicialização após esta versão, uma adaptação idempotente copia as configurações da guilda de `GUILD_ID` para `jinx:config`, converte os registros de XP dessa guilda preservando XP e timestamps e remove o índice composto antigo. Os documentos legados só são removidos após a cópia correspondente. A conexão MongoDB continua usando TLS mútuo.

## ZIP local da Square Cloud

O arquivo `squarecloud.app` usa `index.js` como entrada. Para preparar o ZIP inicial localmente, deixe `.env` e `certs/certificate.pem` presentes e execute:

```sh
npm run package:squarecloud
```

O script valida a presença dos dois arquivos sem abrir ou exibir seus conteúdos e grava um ZIP datado em `dist/`. O pacote inclui `.env` e o certificado no caminho esperado. `dist/`, `.env` e `certs/` são ignorados pelo Git, mas `.env` e o certificado são incluídos explicitamente no ZIP. Este comando apenas monta o arquivo; não faz upload nem chama a Square Cloud.

O empacotador usa o utilitário `zip` instalado localmente.

## CI e deploy

O workflow de CI roda em push e pull request, instala dependências e valida sintaxe/configuração sem acessar secrets.

O workflow `squarecloud-deploy.yml` atualiza a aplicação `e663fa87c2c646c5abfeca508851ef62` em push para `main` ou por execução manual nessa branch. Ele valida o projeto, reconstrói `.env` e `certs/certificate.pem` no runner, monta o ZIP e o envia diretamente à Square Cloud, sem publicar artifact.

Configure estes secrets de Actions no repositório:

- `SQUARECLOUD_API_KEY`: chave da API com os escopos `apps:deploy` e `apps:control`.
- `JINX_ENV_FILE_BASE64`: conteúdo do `.env` codificado em Base64.
- `JINX_MONGODB_CERTIFICATE_PEM_BASE64`: conteúdo de `certs/certificate.pem` codificado em Base64.

O script `npm run restore:github-secrets` exige `GITHUB_ACTIONS=true`, falha se os arquivos de destino já existirem e não imprime os valores. Base64 é apenas codificação, não criptografia; esses secrets nunca devem aparecer em logs, código ou artifacts públicos.
