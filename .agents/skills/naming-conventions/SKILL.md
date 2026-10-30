---
name: naming-conventions
description: Ative ao criar ou renomear comandos, arquivos, funções, variáveis, modelos ou campos persistidos no MongoDB; aplique ou revise convenções de nomes.
---

# Convenções de nomes

## Antes de nomear ou renomear

1. Inspecione os arquivos próximos, procure usos do identificador e confira documentação, manifestos, exemplos de ambiente, schemas, índices e testes pertinentes. Nunca leia `.env` nem material privado em `certs/`.
2. Preserve um padrão coerente que esteja realmente presente no projeto. Diferencie no relato o que foi encontrado do que está sendo proposto.
3. Se não houver exemplos ou padrões locais verificáveis, trate os padrões abaixo como propostas de fallback, nunca como convenções já adotadas pelo projeto.
4. Não faça renomeações em massa. Para nomes persistidos, verifique todos os leitores, escritores, consultas, índices e migrações antes de alterar o contrato armazenado.

## Propostas quando não houver padrão local

- JavaScript: use `camelCase` para variáveis, parâmetros e funções; `PascalCase` para classes e construtores; `UPPER_SNAKE_CASE` para constantes de módulo imutáveis com significado estável. Proponha `kebab-case` para arquivos e diretórios novos.
- Variáveis de ambiente: use `UPPER_SNAKE_CASE` e documente os nomes em exemplos seguros, sem copiar valores secretos.
- MongoDB: proponha modelos com nome singular em `PascalCase`, campos persistidos em `camelCase` e nomes de coleção plurais em `lower_snake_case`. Se houver ODM, confira e declare o mapeamento da coleção em vez de presumir sua pluralização.
- Comandos slash: nomes de comandos e opções exibidos no Discord não precisam usar `kebab-case` ou `snake_case`. Escolha nomes curtos e legíveis e valide-os contra as restrições atuais da API do Discord (1–32 caracteres e regras de `CHAT_INPUT`). Use a documentação oficial de [Application Commands](https://docs.discord.com/developers/docs/interactions/slash-commands). A organização dos arquivos de comando pertence à skill específica de comandos slash.
- Mantenha identificadores técnicos consistentes com o vocabulário e o padrão local; não crie sinônimos para o mesmo conceito. Escreva comentários de código e logs em português. Use português do Brasil nos textos destinados aos membros, salvo padrão documentado diferente no projeto.

## Ao concluir

Revise os nomes novos e renomeados junto aos usos afetados. No resumo, separe convenções encontradas de propostas e registre inconsistências preexistentes fora do escopo sem corrigi-las em lote.
