# Jinx

Bot de Discord para uma comunidade, inicialmente configurado para uma única guilda. O projeto usa JavaScript ESM, `discord.js` e o driver oficial `mongodb`.

## Desenvolvimento local

Requer Node.js 22 ou superior e npm.

```sh
npm ci
```

Em um checkout novo, crie `.env` somente se ainda não existir: `test -e .env || cp .env.example .env`. Preencha localmente `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `MONGODB_URI` e `GUILD_ID`. O `.env` já existente neste checkout pode ser mantido. Não compartilhe seus valores. A variável antiga `PREFIX`, se ainda existir no `.env`, não é usada: os comandos desta base são somente slash.

Use a URI MongoDB da sua base e coloque o arquivo combinado `certificate.pem` fornecido pela Square Cloud em `certs/certificate.pem`. O driver usa TLS e aponta tanto `tlsCAFile` quanto `tlsCertificateKeyFile` para esse mesmo arquivo. O certificado é material privado e não deve ser copiado para documentação ou Git.

Inicie o bot com:

```sh
npm start
```

Ao iniciar, o bot conecta ao MongoDB, registra os comandos na guilda de `GUILD_ID` e conecta ao Gateway do Discord. No Developer Portal, habilite somente os intents `Guilds` e `Guild Messages`; não habilite Message Content Intent. Conceda ao bot acesso aos canais e permissão para responder e usar comandos. Pessoas que alteram configurações precisam de `Gerenciar servidor`.

## Comandos

- `/choose opcoes`: escolhe uma alternativa entre opções separadas por `|`.
- `/roll expressao`: rola dados em formato como `2d6+3`; aceita de 1 a 100 dados, de 2 a 1000 faces e modificador entre -10000 e 10000. Expressões em mensagens comuns são ignoradas.
- `/botinfo`, `/uptime`, `/ping` e `/help`: informações e ajuda.
- `/nivel consultar`: consulta seu nível e XP; informe `membro` para consultar outra pessoa.
- `/nivel adicionar` e `/nivel remover`: ajuste administrativo de níveis.
- `/xp adicionar` e `/xp remover`: ajuste administrativo de XP.
- `/perfil [membro]`: exibe informações básicas do perfil e o banner público, quando disponível.
- `/painel`: configura curva, intervalo de XP, cooldown e boosts de cargo/canal.

O XP total é a fonte de verdade. A pessoa começa no nível 1; o XP necessário para passar do nível `L` é `xpBase + L * xpStep`. O progresso atual é preservado ao ajustar níveis, limitado ao espaço disponível no nível de destino. Ao conceder XP em excesso, todos os níveis atingidos são calculados a partir do total.

Os valores iniciais são 5–15 XP por mensagem, cooldown de 60 segundos, `xpBase=100`, `xpStep=25` e boost máximo de 5×. Pessoas com permissão de `Gerenciar servidor` podem alterá-los no `/painel`.

Se vários cargos da pessoa tiverem boosts, vale o maior deles (ou 1 se nenhum se aplicar). Esse valor é multiplicado pelo boost do canal (ou 1). O XP sorteado é multiplicado pelo resultado e arredondado para baixo. O cooldown é atômico por guilda e membro; bots e mensagens fora da guilda configurada não recebem XP.

As configurações e dados de membros são persistidos no MongoDB. O painel usa seletores e handlers registrados a cada inicialização; cada interação relê a configuração e revalida permissões, então os controles não dependem de collectors em memória.

## ZIP local da Square Cloud

O arquivo `squarecloud.app` usa `index.js` como entrada. Para preparar o ZIP inicial localmente, deixe `.env` e `certs/certificate.pem` presentes e execute:

```sh
npm run package:squarecloud
```

O script valida a presença dos dois arquivos sem abrir ou exibir seus conteúdos e grava um ZIP datado em `dist/`. O pacote inclui `.env` e o certificado no caminho esperado. `dist/`, `.env` e `certs/` são ignorados pelo Git, mas `.env` e o certificado são incluídos explicitamente no ZIP. Este comando apenas monta o arquivo; não faz upload nem chama a Square Cloud.

O empacotador usa o utilitário `zip` instalado localmente.

## CI e secrets futuros

O workflow de CI roda em push e pull request, instala dependências e valida sintaxe/configuração. Não acessa secrets e não publica artifacts ou deploys.

Uma etapa futura de entrega pode reconstruir os arquivos locais com os secrets `JINX_ENV_FILE_BASE64` e `JINX_MONGODB_CERTIFICATE_PEM_BASE64`, executando `npm run restore:github-secrets` em um runner isolado do GitHub Actions. O script exige `GITHUB_ACTIONS=true`, falha se os arquivos de destino já existirem e não imprime os valores. Base64 é apenas codificação, não criptografia; esses secrets nunca devem aparecer em logs, código ou artifacts públicos. O workflow atual não chama esse script.
