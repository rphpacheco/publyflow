# TAREFA.md — Controle de execução do PublyFlow

Arquivo de acompanhamento de tudo que for executado a partir de 2026-10-04.
Legenda: `[ ]` pendente · `[~]` em andamento · `[x]` concluído · `[-]` descartado

## Em andamento

### 1. Páginas da sidebar sem tela (Companies, Contacts, Dashboard — hoje 404)
- [x] Levantar contexto (links na sidebar, APIs existentes: só GET em companies/contacts/brands)
- [x] Brainstorming — decidido: **A) Companies + Contacts juntas** numa spec; Dashboard fica para spec própria depois
- [~] Perguntas de esclarecimento
  - [x] Escopo: **consulta + edição** (lista com busca, detalhe com relações, editar dados; criação segue vindo do inbox; sem excluir)
  - [x] Brands: **dentro do detalhe da company** (listar, renomear, mover de company; grupo "Sem empresa"; sem página /brands)
  - [x] Duplicatas: **fora desta versão** (vira spec própria — ver "Próximos")
- [x] Perguntas de esclarecimento concluídas
- [x] Abordagem: **lista + página de detalhe** (`/companies`, `/companies/[id]`, `/contacts`, `/contacts/[id]`; edição em diálogo)
- [x] Apresentar o design por seções
  - [x] Seção 1: API e backend (aprovada, incl. 409 p/ nome de company repetido)
  - [x] Seção 2: telas (aprovada)
  - [x] Seção 3: erros e testes (aprovada)
- [x] Escrever spec — `docs/superpowers/specs/2026-10-04-companies-contacts-design.md`
- [x] Revisão da spec pelo Raphael
- [x] Plano de implementação — `docs/superpowers/plans/2026-10-04-companies-contacts.md` (9 tasks)
- [x] Implementação + testes (subagent-driven) — branch `companies-contacts`, 1135 testes verdes
  - [x] T1 erros, schemas, busca, mapper
  - [x] T2 read model (listas c/ contagem, detalhes)
  - [x] T3 repositórios de escrita + CrmService
  - [x] T4 rotas API + id-guard
  - [x] T5 hooks
  - [x] T6 componentes (diálogos, tabela de oportunidades)
  - [x] T7 páginas /companies
  - [x] T8 páginas /contacts
  - [x] T9 verificação completa + checagem no navegador (listas, busca, detalhe, 409 de nome, brand movida, e-mail inválido, contato vinculado)
- [x] Revisão final (opus): sem Critical/Important; 4 ajustes aplicados (409 só por COMPANY_NAME_TAKEN, Cmd-click nas linhas, lint, ordem no spec)
- [ ] Merge em main
- [ ] Push/deploy (feito pelo Raphael)

## Próximos (na ordem combinada)

### 1b. Página Dashboard (spec própria, depois de Companies + Contacts)
- [ ] Brainstorming (métricas, backend)

### 1c. Mesclar duplicatas (companies e contacts)
- [ ] Brainstorming (reapontar leads/opportunities/brands/contacts numa transação)

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
- [ ] CRM: teste defensivo cross-org cobrir brands/opportunities/proposals (hoje só contacts)
- [ ] CRM: erro de empresa no combobox sem aria-describedby; diálogos de contato/brand duplicam plumbing
- [ ] CRM: testes de páginas sem estado de erro/retry e toast de brand; 403/401 dos route tests chamam setup() 2x
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
