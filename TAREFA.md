# TAREFA.md — Controle de execução do PublyFlow

Arquivo de acompanhamento de tudo que for executado a partir de 2026-10-04.
Legenda: `[ ]` pendente · `[~]` em andamento · `[x]` concluído · `[-]` descartado

## Em andamento

### 1b. Página Dashboard (spec própria)
- [x] Levantar contexto (dados disponíveis: inquiries por status, opportunities por estágio/status/valor/creator, propostas/publicações/respostas/aprovações, histórico de estágio; `/` redireciona p/ /pipeline; creator não vê o link)
- [x] P1: Dashboard responde as 3 perguntas — **A** comercial (funil + dinheiro), **B** o que requer ação, **C** desempenho por creator
- [x] P2: período — presets (este mês [padrão], mês passado, últimos 90 dias, este ano) **+ intervalo livre de/até**; fechado = data em que entrou em Fechado (histórico de estágio)
- [x] P3: valor — fechado = itens da versão aceita pelo link (fallback: estimado da oportunidade); em negociação = total da proposta mais recente (fallback: estimado)
- [x] P4: métricas (versão do Raphael)
  - Comercial: mensagens recebidas, oportunidades criadas, conversão inbox→oportunidade, fechadas (qtd+R$), perdidas, taxa de fechamento, ticket médio, em negociação (qtd+R$), funil por estágio, tempo médio até fechamento
  - Requer ação: sem triagem, ajustes pelo cliente, ajustes pelo creator, aguardando aprovação do creator, prontas p/ enviar
  - Acompanhamento: aguardando resposta do cliente
  - Creators: oportunidades abertas, propostas enviadas no período, fechadas (qtd+R$), taxa de aprovação da proposta = aceites ÷ (aceites + recusas)
  - Valores em R$ sempre pela regra do P3 (nada financeiro baseado em "propostas enviadas")
- [x] Definições: conversão = mensagens do período já CONVERTED ÷ mensagens do período; tempo até fechamento = média (entrada em Fechado − criação) das fechadas no período, "—" se zero; taxa de aprovação (cliente) = aceites ÷ (aceites + recusas) por respondedAt no período
- [x] Abordagem: 2 endpoints calculados na hora — `/api/dashboard/metrics?from&to` (Comercial + Creators) e `/api/dashboard/actions` (Requer ação + Acompanhamento, reaproveita a classificação da fila)
- [x] Bloco Creators filtrado pelo escopo do usuário quando o papel for CREATOR
- [x] P5: **CREATOR não acessa** (403, só OWNER/MANAGER); camada de dados aceita `creatorScope` mesmo assim (defensivo/futuro)
- [x] Design por seções
  - [x] Seção 1: API e cálculo (aprovada; registrar: data de fechamento/perda = entrada mais recente em FECHADO/PERDIDO no opportunity_stage_history; inquiriesConverted = status ATUAL das mensagens recebidas no período; valor ganho = publication mais recente com response.action = ACCEPT)
  - [x] Seção 2: tela (aprovada) — **layout B (duas colunas)** escolhido; referências visuais do Raphael (Dribbble ×4 + Coupler) analisadas; mockup v2 no visual companion; **entram os dois**: comparação vs período anterior em todos os cards históricos + gráfico "Fechado ao longo do período" (nova dependência recharts)
  - [x] Seção 3: erros e testes (aprovada)
- [x] Spec — `docs/superpowers/specs/2026-10-05-dashboard-design.md`
- [x] Revisão da spec pelo Raphael
- [x] Achado no planejamento: reabrir oportunidade não voltava `status` p/ OPEN → **corrigir na raiz** (updateStage + migration 0022 só de dados; aplicar 0022 em prod antes do push) — spec D14/D15 atualizada
- [x] Plano — `docs/superpowers/plans/2026-10-05-dashboard.md` (8 tasks; regra: sem emoji na UI, só lucide)
- [x] Implementação (subagentes) + revisão final (opus) + rodada de correções (proposta vazia → estimado; contagens exatas; comparação com trecho decorrido; rótulo sem seta; transbordamento corrigido)
  - [x] T1 status OPEN ao reabrir + migration 0022
  - [x] T2 period/value/delta
  - [x] T3 DashboardRepository
  - [x] T4 DashboardService
  - [x] T5 actions service + rotas
  - [x] T6 hooks + recharts + componentes
  - [x] T7 página /dashboard
  - [x] T8 verificação: tsc ok, lint ok nos arquivos novos, 0022 em test/dev, suíte 1228 verde, build ok, navegador ok (números conferidos, layout sem transbordar de 320 a 1920px)
- [ ] Merge + deploy

## Concluído nesta fase

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
- [x] Merge em main (`78cfeca`, suíte 1135 verde no resultado)
- [x] Push/deploy em produção (2026-10-05, sem migration; rota nova confirmada em publyflow.vercel.app)

## Próximos (na ordem combinada)


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
- [ ] Dashboard: somar itens do snapshot aceito no SQL (DISTINCT ON + jsonb) em vez de carregar o JSON inteiro; staleTime ~60s nas queries
- [ ] Dashboard: contagem de "Requer ação" carrega a fila inteira (limit null) — agregar no SQL se o volume crescer
- [ ] Dashboard: hooks disparam p/ creator antes do redirect (403); ErrorBox sem role=alert; gráfico sem texto alternativo
- [ ] CRM: teste defensivo cross-org cobrir brands/opportunities/proposals (hoje só contacts)
- [ ] CRM: erro de empresa no combobox sem aria-describedby; diálogos de contato/brand duplicam plumbing
- [ ] CRM: testes de páginas sem estado de erro/retry e toast de brand; 403/401 dos route tests chamam setup() 2x
- [ ] Rate limit: normalização IPv6 /64 e chave com HMAC
- [ ] Tabela `/creators` estoura em telas estreitas
- [ ] PATCH de creator (e-mail + update) em duas transações
- [ ] Origin ausente → `emailRedirectTo` relativo

## Housekeeping
- [x] Criar TAREFA.md versionado no git
- [x] Push do commit local `7693b82` (CLAUDE.md/AGENTS.md) — junto com o deploy de 2026-10-05

## Concluído (histórico recente)
- [x] Specs A/B/C/D de creators (cadastro, permissões, convite, aprovação) — em produção
- [x] Fila `/proposals` — em produção
- [x] Edição de inquiry antes de converter + erros legíveis — em produção
