# TAREFA.md — Controle de execução do PublyFlow

Arquivo de acompanhamento de tudo que for executado a partir de 2026-10-04.
Legenda: `[ ]` pendente · `[~]` em andamento · `[x]` concluído · `[-]` descartado

## Em andamento

### F. Reset e troca de senha
- [x] Escopo: "Esqueci minha senha" no /login + "Alterar senha" no app (também cria a 1ª senha)
- [x] Decisão: troca no app também por link no e-mail (prova a caixa de e-mail); página de nova senha exige comprovante assinado (cookie 15 min, uso único)
- [x] Design (aprovado)
- [x] Spec — `docs/superpowers/specs/2026-10-11-password-reset-design.md`
- [ ] Revisão da spec pelo usuário
- [ ] Plano de implementação
- [ ] Implementação (subagentes) + revisão final
- [ ] Merge + deploy (conferir Redirect URLs no Supabase; traduzir template de e-mail — opcional, usuário)

## Concluído nesta fase (Equipe)

### E. Equipe + convite de gestor
- [x] Escopo: página Equipe (lista OWNER/MANAGER, convidar, reenviar, remover), sem mudar papéis
- [x] Decisão: só o OWNER convida/reenvia/remove; MANAGER só lê; CREATOR 403
- [x] Design (aprovado com ajustes do usuário: concorrência por índices únicos + lock único, convite idempotente p/ gestor existente (recupera 502), revogação efetiva por releitura da membership, vínculo só do usuário criado agora, mensagem só com dados do servidor, contrato `member` = item da lista, sem vazar dados de outra org, ordem determinística, `isSelf` no servidor, 409 p/ remover OWNER/a si mesmo)
- [x] Spec — `docs/superpowers/specs/2026-10-11-manager-invite-design.md`
- [x] Revisão da spec pelo usuário (verificações: retentativa sem depender de `created: true`; retry 23505 em transação nova, um único `member.invited`; notificações/autoria preservadas e fan-out só p/ memberships atuais)
- [x] Plano — `docs/superpowers/plans/2026-10-11-manager-invite.md` (T1 domínio+convite, T2 reenviar/remover, T3 rotas, T4 página/hooks/sidebar, T5 verificação)
- [x] Implementação (subagentes) + revisão final — T1–T4 revisadas (achado: estado "nenhum gestor"); intermitência antiga do teste 503 de companies corrigida (mock único de sessão); revisão final "com ajustes" aplicada: creator de outra organização → 409 `OTHER_ORGANIZATION` (decisão do usuário), ordem das regras da spec, corrida remover×reconvidar (lock membership → users), trim do e-mail, testes do retry 23505 e do payload
- [x] Verificação: tsc ok, lint sem erros, suíte 1555 verde, build ok; verificação no navegador pulada a pedido do usuário (testar convite/remoção direto em produção)
- [x] Merge + deploy (`b20609b`, 2026-10-11): 0025 já em produção (26 migrations); Vercel ok; `/api/team` 401 e `/team` → `/login` sem sessão

## Concluído nesta fase (Auth hardening)

### 3. Auth hardening (follow-ups da revisão do Auth v1)
- [x] Escopo: só os 6 follow-ups (opção A); manager/reset/RLS viram specs E, F, G
- [x] Decisão: servidor cria usuário do Supabase confirmado (service-role) + backfill; signup público desligado depois do checkpoint
- [x] Design (aprovado, com ajustes do usuário: vínculo imediato quando criado, estado recuperável, checkpoint `--check`, logout só POST / GET 405, aviso de sem acesso no /login, texto da UI sem citar autenticação)
- [x] Spec — `docs/superpowers/specs/2026-10-06-auth-hardening-design.md`
- [x] Revisão da spec pelo usuário (ajuste: creator não vincula `auth_user_id` no convite — travaria a edição de e-mail; só provisionamento vincula; `--check` bloqueia só e-mail ausente no Supabase)
- [x] Plano — `docs/superpowers/plans/2026-10-06-auth-hardening.md` (T1 admin+provisionamento, T2 convite/lembrete/e-mail + magic link, T3 0025, T4 backfill, T5 sessão/proxy/indisponível, T6 49 rotas + guarda, T7 logout/sem-acesso/login, T8 verificação)
- [x] Implementação (subagentes) + revisão final — T1–T7 revisadas; achados corrigidos (PATCH com e-mail igual re-provisiona creator convidado — decisão A; teste de rota dependente de ordem; backfill sem causa de falha; `decision.ts` fora do `getRouteSession`); revisão final "com ajustes" aplicada (callback `signup_disabled` → `/sem-acesso`, log de queda, linha `Target` no backfill, ordem do deploy na spec); `server-only` não adicionado (pacote ausente quebra scripts tsx)
- [x] Verificação: tsc ok, lint sem erros novos, suíte 1474 verde, build ok; navegador: GET signout 405 sem deslogar, `/login` → `/pipeline`, 1 `getUser` por render (inclusive preview), queda simulada → tela de indisponível + 503 `AUTH_UNAVAILABLE` + log, sessão sobrevive; convite cria usuário no Supabase sem vincular
- [x] Merge + deploy (`3a0cec6`, 2026-10-11): chave na Vercel → 0 duplicatas de e-mail → 0025 em produção (26 migrations) → `--check` = 0 → push (Vercel ok; GET signout 405, `signup_disabled` → `/sem-acesso`) → backfill (nada a criar) + `--check` bloqueante 0 → signup desligado (`disable_signup = true`) → usuário testou Google, magic link, Google sem cadastro → `/sem-acesso`, Google de creator convidado → entra; chaves de assinatura já assimétricas (ES256)

## Concluído nesta fase (Dívida técnica)

### 2. Dívida técnica (spec única, 6 itens)
- [x] Investigação: 1 cliente OpenAI criado no load; 2 índices faltando; 3 ids explícitos sem checagem de org na conversão; 4 concorrência de publish já coberta, falta exigir confirmação de reabertura no servidor; 5 prod sem duplicatas (org,user) em creators; 6 Criar desabilitado sem dica
- [x] Decisão item 4: exigir `reopen: true` no servidor quando a proposta está aceita/recusada (409 REOPEN_REQUIRED)
- [x] Design (aprovado)
- [x] Spec — `docs/superpowers/specs/2026-10-05-tech-debt-batch-design.md`
- [x] Revisão da spec + plano — `docs/superpowers/plans/2026-10-05-tech-debt-batch.md`
- [x] Implementação (subagentes) + revisão final
  - [x] T1 cliente de IA sob demanda + 503
  - [x] T2 migration 0024 (índices + creators único)
  - [x] T3 conversão: ids explícitos da org
  - [x] T4 reopen exigido no publish
  - [x] T5 dica no diálogo Nova Proposta
  - [x] T6 verificação: tsc ok, lint = base, 0024 em test/dev, suíte 1353 verde, build ok, revisão final (opus: pronto) + ajustes, navegador ok (503 sem chave da OpenAI; dica do Nova Proposta)
- [x] Merge + deploy (`3d7b919`; suíte 1353 verde no main; 0 duplicatas (org,user) em creators re-checado; 0024 aplicada em produção antes do push — 3 índices criados; Vercel "Deployment has completed", 2026-10-06)

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

### G. RLS valendo em runtime (spec própria)
### Não priorizado
- [ ] Signup self-service que cria organização

### 4. Omnichannel — pré-requisitos da Fase 1 (WhatsApp Cloud API)
- [ ] Visibilidade de eventos mortos (dead events)
- [ ] Retenção das linhas `done` do outbox
- [ ] Leitura de notificações via `runInTenantContext`
- [ ] Spec da Fase 1

### Menores / adiados
- [x] Equipe: testado em produção pelo usuário (2026-10-11) — convite de gestor, login como MANAGER e remoção → `/sem-acesso` funcionaram
- [ ] Equipe: diálogo de convite mantém rascunho ao cancelar; cards sem rótulos Papel/Situação p/ leitor de tela; sem teste determinístico da corrida remover×reconvidar
- [ ] Auth: usuário de teste `bruno.dev@publyflow.test` criado no Supabase compartilhado (dev = prod) pelo teste de convite — apagar se quiser
- [ ] Auth: `isAuthServiceFailure` trata qualquer `TypeError` como queda (agora logado); `import "server-only"` no auth-admin exige instalar o pacote e tratar tsx
- [ ] Auth: magic link em queda responde "enviado"; rejeição permanente do Supabase (422) vira 502 "tente novamente"
- [ ] Investigar lookup administrativo por e-mail no Supabase para vincular `auth_user_id` imediatamente quando o usuário já existir em `auth.users`
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
