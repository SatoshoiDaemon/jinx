---
name: mongodb-modeling
description: Ative ao adicionar ou alterar coleções, índices, consultas, persistência ou migrações MongoDB.
---

# Modelagem MongoDB

1. Antes de propor schema, percorra os comandos, eventos, tarefas e serviços reais do bot. Registre para cada acesso o filtro, ordenação, gravação, escopo, volume e retenção necessários. Separe fatos encontrados de propostas; não finalize um schema antes de entender esses casos de uso. Para nomes, siga `naming-conventions` e trate padrões de fallback como propostas.
2. Modele o escopo de acordo com o comportamento: quando os dados pertencem a um servidor e usuário, filtre e imponha unicidade por ambos, usando os IDs estáveis do Discord. Diferencie explicitamente dados globais, por servidor, por usuário e por servidor-usuário.
3. Derive índices das consultas reais. Considere filtros, ordenação, paginação, seletividade e atualizações concorrentes; planeje índices compostos pela regra Equality-Sort-Range como ponto de partida, confira prefixos e unicidade exigida pelo domínio e valide consultas com `explain` quando houver dados representativos. Considere também o custo dos índices nas escritas.
4. Evite arrays que cresçam sem limite, como listas permanentes de transações, membros ou eventos dentro de um documento. Defina um limite comprovável ou use coleção referenciada/histórico separado, conforme os acessos do bot.
5. Faça atualizações concorrentes com operações atômicas e filtros condicionais; não use o padrão ler, calcular e sobrescrever para saldos, contadores ou cooldowns. Para saldos, valide o saldo disponível na própria escrita e confira o resultado. Registre transações em histórico append-only com chave idempotente e escopo; se saldo e histórico precisarem de consistência entre documentos, confirme o suporte transacional da topologia e trate retries sem duplicar efeitos. Para cooldowns, use uma aquisição condicional atômica com chave única no escopo correto.
6. Use TTL apenas para limpeza eventual de dados temporários, com campo de expiração `Date` e índice compatível. A remoção não é imediata: verifique a expiração nas consultas que decidem acesso ou cooldown e não use TTL como relógio de negócio.
7. Faça migrações versionadas e repetíveis: use filtros idempotentes, lotes limitados e checkpoints que permitam retomar após falha parcial; declare pré e pós-condições e valide índices/contagens. Não apague ou transforme dados de modo destrutivo, nem implemente migração destrutiva, sem autorização explícita do usuário.

## MongoDB da Square Cloud: TLS e certificados

- A [documentação da Square Cloud para sua base MongoDB](https://help.squarecloud.app/en-us/article/how-to-create-a-mongodb-database-and-connect-1xwlajj/) exige TLS: habilite `tls: true` e configure `certificate.pem` tanto em `tlsCAFile` quanto em `tlsCertificateKeyFile`. O arquivo combinado contém certificado e chave privada. A Square Cloud também disponibiliza `private-key.key` e `ca-certificate.crt` separados; use-os somente conforme a forma de configuração documentada para o driver instalado.
- Confira a versão efetivamente instalada do driver Node.js e consulte a [documentação oficial TLS correspondente](https://www.mongodb.com/docs/drivers/node/current/security/tls/) antes de escolher opções, formato ou caminhos. Confirme que os arquivos requeridos estarão acessíveis no runtime da hospedagem e coordene sua disponibilização privada com `squarecloud-deployment`; não suponha que um arquivo local estará no pacote ou no runtime.
- Trate `certificate.pem` e qualquer chave como credenciais: nunca leia, imprima, registre em logs ou comite o conteúdo. Não desative validação de certificado ou hostname para contornar falhas TLS. Nunca leia `.env` nem arquivos privados em `certs/`.

Referências: [modelagem de dados](https://www.mongodb.com/docs/manual/data-modeling/), [índices compostos](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/), [atomicidade e transações](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/), [arrays sem limite](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/unbounded-arrays/) e [índices TTL](https://www.mongodb.com/docs/manual/core/index-ttl/).
