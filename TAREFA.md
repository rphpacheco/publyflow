# TAREFA.md — Controle de execução do PublyFlow

Arquivo de acompanhamento de tudo que for executado a partir de 2026-10-04.
Legenda: `[ ]` pendente · `[~]` em andamento · `[x]` concluído · `[-]` descartado

## Em andamento

### 1. Páginas da sidebar sem tela (Companies, Contacts, Dashboard — hoje 404)
- [x] Levantar contexto (links na sidebar, APIs existentes: só GET em companies/contacts/brands)
- [x] Brainstorming — decidido: **A) Companies + Contacts juntas** numa spec; Dashboard fica para spec própria depois
- [~] Perguntas de esclarecimento (escopo: só leitura ou CRUD, filtros, detalhe)
- [ ] Propor abordagens e apresentar o design
- [ ] Escrever spec em `docs/superpowers/specs/` e commitar
- [ ] Revisão da spec pelo Raphael
- [ ] Plano de implementação (`docs/superpowers/plans/`)
- [ ] Implementação + testes
- [ ] Revisão final
- [ ] Merge em main
- [ ] Push/deploy (feito pelo Raphael)

## Próximos (na ordem combinada)

### 1b. Página Dashboard (spec própria, depois de Companies + Contacts)
- [ ] Brainstorming (métricas, backend)

### 2. Dívida técnica
- [ ] Cliente OpenAI lazy (sem `OPENAI_API_KEY` o POST do inbox quebra no load do módulo)
- [ ] Índices `proposals(organization_id, created_at)` e `proposal_items(proposal_id)`
- [ ] Convert do inbox: validar que `companyId`/`brandId` explícitos são da mesma org
- [ ] Publish sem guarda de status esperado (race check-then-act)
- [ ] `UNIQUE(organization_id, user_id)` em creators
- [ ] Diálogo "Nova Proposta": botão Criar desabilitado sem dica quando não há tema

### 3. Auth — subprojetos 2 a 4
- [ ] Provisionamento sempre cria auth user confirmado (para desligar sign-up público)
- [ ] Logout CSRF via GET em `/auth/signout`
- [ ] Usuário logado ainda vê `/login`
- [ ] `users.email` sem índice único case-insensitive
- [ ] `getUser()` chamado 2x por página (avaliar `getClaims()`)
- [ ] Queda do Supabase aparece como "sem acesso"

### 4. Omnichannel — pré-requisitos da Fase 1 (WhatsApp Cloud API)
- [ ] Visibilidade de eventos mortos (dead events)
- [ ] Retenção das linhas `done` do outbox
- [ ] Leitura de notificações via `runInTenantContext`
- [ ] Spec da Fase 1

### Menores / adiados
- [ ] Rate limit: normalização IPv6 /64 e chave com HMAC
- [ ] Tabela `/creators` estoura em telas estreitas
- [ ] PATCH de creator (e-mail + update) em duas transações
- [ ] Origin ausente → `emailRedirectTo` relativo

## Housekeeping
- [x] Criar TAREFA.md versionado no git
- [ ] Push do commit local `7693b82` (CLAUDE.md/AGENTS.md) — feito pelo Raphael

## Concluído (histórico recente)
- [x] Specs A/B/C/D de creators (cadastro, permissões, convite, aprovação) — em produção
- [x] Fila `/proposals` — em produção
- [x] Edição de inquiry antes de converter + erros legíveis — em produção
