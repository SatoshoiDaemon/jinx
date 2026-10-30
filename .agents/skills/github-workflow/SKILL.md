---
name: github-workflow
description: Ative ao iniciar alterações de código, sincronizar branches, preparar commits ou investigar GitHub Actions.
---

# Fluxo de Git e GitHub

1. Antes de agir, confira as instruções do repositório, a raiz, a branch atual e `git status --short --branch`, incluindo arquivos não rastreados. Identifique a branch padrão, os remotos e o upstream sem expor credenciais presentes em URLs. Inspecione os workflows existentes antes de investigar Actions; não suponha que haja workflows ou convenções que não encontrou.
2. Preserve todo trabalho preexistente. Não use `reset`, `clean`, descarte, stash destrutivo ou operações equivalentes. Mantenha a alteração na branch de trabalho; se não houver uma adequada, crie uma branch descritiva seguindo convenções encontradas. Não envie alterações diretamente à branch padrão.
3. Examine o fluxo real e os scripts de verificação relevantes antes de alterar código. Mantenha o escopo solicitado; prepare o commit somente depois das verificações apropriadas. Se não for possível separar com segurança mudanças preexistentes, não as inclua e relate o impedimento.
4. Faça commits pequenos e coesos, com mensagens Conventional Commits, por exemplo `feat(escopo): adicionar recurso`, `fix(escopo): corrigir falha`, `docs(escopo): atualizar guia` ou `ci(escopo): ajustar workflow`. Selecione explicitamente os caminhos da tarefa ao preparar o commit; não inclua trabalho alheio nem altere commits existentes.
5. Depois do commit, sincronize a branch de trabalho com o remoto quando houver upstream e acesso configurado. Nunca use force push. Se autenticação, upstream ou acesso de escrita não estiver disponível, preserve a branch e o commit locais e informe isso.
6. Para GitHub Actions, examine os arquivos em `.github/workflows/`, seus gatilhos, permissões, jobs e scripts chamados. Com acesso ao GitHub, consulte a execução relevante e seus logs; relate o resultado observado. Sucesso de workflow, por si só, não comprova deploy nem funcionamento hospedado: só declare deploy bem-sucedido com evidência correspondente.
