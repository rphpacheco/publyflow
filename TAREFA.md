# TAREFA.md — Controle de execução do PublyFlow

Arquivo de acompanhamento de tudo que for executado a partir de 2026-10-04.
Legenda: `[ ]` pendente · `[~]` em andamento · `[x]` concluído · `[-]` descartado

## Em andamento

### 2. Dívida técnica (spec única, 6 itens)
- [x] Investigação: 1 cliente OpenAI criado no load; 2 índices faltando; 3 ids explícitos sem checagem de org na conversão; 4 concorrência de publish já coberta, falta exigir confirmação de reabertura no servidor; 5 prod sem duplicatas (org,user) em creators; 6 Criar desabilitado sem dica
- [x] Decisão item 4: exigir `reopen: true` no servidor quando a proposta está aceita/recusada (409 REOPEN_REQUIRED)
- [x] Design (aprovado)
- [x] Spec — `docs/superpowers/specs/2026-10-05-tech-debt-batch-design.md`
- [x] Revisão da spec + plano — `docs/superpowers/plans/2026-10-05-tech-debt-batch.md`
- [ ] Implementação (subagentes) + revisão final
  - [ ] T1 cliente de IA sob demanda + 503
  - [ ] T2 migration 0024 (índices + creators único)
  - [ ] T3 conversão: ids explícitos da org
  - [ ] T4 reopen exigido no publish
  - [ ] T5 dica no diálogo Nova Proposta
  - [ ] T6 verificação + navegador
- [ ] Merge + deploy (0024 antes do push)


## Concluído nesta fase (Mesclar duplicatas)

### 1c. Mesclar duplicatas
- [x] Contexto: company ← brands, contacts, leads, opportunities; contact ← leads (restrict); brand ← leads, opportunities; textos congelados das publicações não mudam
- [x] P1: escopo = **empresas e contatos** (brands fora)
- [x] P2: prevalece o registro que fica; campos vazios dele são preenchidos com os do duplicado; prévia antes de confirmar
- [x] P3: **apelidos só para empresas** (conversão do inbox procura empresa por nome; contato nunca é procurado por nome — commercial-inquiry.service.ts:56-74) → tabela nova de apelidos (migration), conversão procura nome + apelidos, apelidos visíveis/removíveis no detalhe da empresa
- [x] P4: **sem desfazer**; confirmação mostra o impacto (o que será movido, apelido criado, "não pode ser desfeita"); registro interno do que foi feito
- [x] P5: botão "Mesclar em…" no detalhe do duplicado → diálogo: escolher o que fica, prévia (dados finais + impacto), confirmar → vai para o que ficou
- [x] Abordagem: transação única no service (trava em ordem de id, reaponta FKs, completa vazios, apelido, apaga, evento) + endpoint de prévia
- [x] Design por seções
  - [x] Seção 1: dados (company_aliases, migration 0023), regras de apelido (rename + conversão), mesclar empresa/contato, rotas
  - [x] Seção 2: telas (Mesclar em… + diálogo com prévia e aviso; bloco Apelidos; contatos com campos "(do duplicado)")
  - [x] Seção 3: erros e testes (aprovada)
- [x] Spec — `docs/superpowers/specs/2026-10-05-merge-duplicates-design.md`
- [x] Revisão da spec pelo Raphael
- [x] Plano — `docs/superpowers/plans/2026-10-05-merge-duplicates.md` (6 tasks)
- [x] Implementação (subagentes) + revisão final
  - [x] T1 tabela company_aliases + migration 0023 + RLS
  - [x] T2 regras de apelido (conversão, renomear, remover, detalhe)
  - [x] T3 CrmMergeService (mesclar + prévia)
  - [x] T4 rotas da API
  - [x] T5 hooks, diálogos, bloco de apelidos, páginas
  - [x] T6 verificação: tsc ok, lint sem novidades, 0023 em test/dev, suíte 1324 verde (3 falhas ambientais de disco reexecutadas e verdes), build ok, revisão final (opus) + correções, navegador ok (mesclar empresa/contato, apelido, conversão do inbox pelo apelido, sem transbordar)
- [x] Merge + deploy (`7264882`; suíte 1331 verde no main; 0023 aplicada em produção antes do push — só cria a tabela, RLS ativo; rota confirmada em publyflow.vercel.app, 2026-10-05)

## Concluído nesta fase (Dashboard)

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
- [x] Merge + deploy (`f81cb41`; suíte 1231 verde no main; 0022 aplicada em produção antes do push — 0 linhas afetadas; rota confirmada em publyflow.vercel.app, 2026-10-05)

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
- [ ] Mesclagem: 1 busca 404 do detalhe do registro excluído entre a mesclagem e a navegação (invisível); prévia não lista leads na empresa
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
