# token-meter

Mod para o Claude Code que abre um painel com os tokens lidos e escritos na sessão atual e na
semana (todos os projetos), o custo estimado pelo preço de API, o preenchimento da janela de
contexto e os limites de uso (5h, semanal) com o tempo até o reset.

## Instalação

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install token-meter --marketplace Dumorro/token-meter
```

Responda `y` para adicionar o marketplace e escolha o scope `user`. O painel abre ao iniciar a
sessão; para reabri-lo, use `/tokens`.

## Requisitos

- `jq` no `PATH`. Ele lê os transcripts em `~/.claude/projects` para somar a sessão (incluindo
  subagentes) e a semana. Sem `jq`, o painel mostra só o que contou desde que o mod carregou e os
  totais salvos de sessões anteriores.

## Observações

- O custo é uma estimativa pela tabela de preços de API em `hooks/pricing.ts`, não o valor cobrado
  no plano. Modelos fora da tabela aparecem como "sem preço" em vez de serem contados como grátis.

## Desenvolvimento

```bash
claude plugin validate .
claude plugin test .
```
