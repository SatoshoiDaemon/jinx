---
name: documentation-maintenance
description: Use quando uma mudança alterar comportamento, comandos, configuração, banco de dados, instalação ou deploy e a documentação precisar acompanhar a implementação.
---

# Manutenção da documentação

1. Antes de editar, confira o código e a configuração alterados, os scripts, schemas e migrações envolvidos. Confirme o comportamento real; não deduza recursos a partir de planos, nomes ou documentação antiga.
2. Localize apenas os documentos relacionados: README, guias em `docs/`, exemplos de ambiente, referências de comandos e procedimentos de instalação ou deploy. Siga a estrutura e o idioma já usados; não reescreva documentos não afetados.
3. Confira cada nome, valor padrão, opção, caminho e comando em sua fonte no código/configuração. Use exemplos que possam ser executados no contexto correto do projeto; confirme script, diretório e argumentos antes de documentá-los.
4. Documente variáveis de ambiente a partir do código e de exemplos seguros, distinguindo obrigatórias, opcionais e padrões quando isso estiver definido. Nunca leia nem copie valores reais de `.env` ou material privado em `certs/`; use placeholders claros para segredos.
5. Para instalação e deploy, descreva somente os passos implementados e as configurações existentes. Diferencie preparação/empacotamento de operações remotas e não afirme que um deploy ou validação ocorreu sem evidência.
6. Atualize somente os documentos afetados. Não apresente planos, comportamento esperado ou recursos futuros como existentes; se houver uma pendência relevante, identifique-a como não implementada.
7. Revise links, comandos, nomes de variáveis e exemplos contra a implementação e os documentos relacionados. Relate quais documentos foram atualizados e qualquer limitação que não pôde ser confirmada.
