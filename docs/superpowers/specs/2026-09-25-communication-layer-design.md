# PublyFlow — Camada de Comunicação Omnichannel Design Spec

Status: Approved for planning — Fase 0 (2026-09-26). Fases 1–4 seguem como direção, cada uma com spec própria.
Owner: Raphael Pacheco
Depends on: Spec 2 — Envio e resposta da proposta (`2026-09-25-proposal-sending-design.md`).
Referência estudada: DeskcommCRM (`github.com/melgarafael/DeskcommCRM`, commit `462bd35`) —
`ARCHITECTURE.md`, `docs/specs/07-spec-events-workers.md`, `docs/specs/redes-sociais-nativas.md`,
`supabase/baseline.sql` (`channel_sessions`, `conversations`, `messages`, `meta_templates`,
`event_log`), migration `0368_redes_sociais_nativas`.

## 1. Objetivo e princípio central

Dar ao PublyFlow uma camada de comunicação **independente do domínio comercial**, capaz de
crescer para WhatsApp Cloud API, Instagram DM, e-mail e outros canais **sem** colocar nada de
canal dentro de `proposals`, `opportunities` ou `proposal_publications`.

```
Domínio comercial                       Camada de comunicação
(Proposal, Opportunity, Publication)    (Channel accounts, Conversations, Messages, Templates)

  publish / respond ──► domain_events ──► dispatcher ──► ChannelAdapter ──► Meta / Resend / …
        (mesma transação)    (outbox)      (decide canal,      (whatsapp_cloud,
                                            template, destino)  instagram, email)
                                  │
                                  └──► notificações in-app (creator)
```

**Regra de ouro:** o domínio comercial só **emite fatos** (`proposal.sent`,
`proposal.approved`…). Quem decide *se*, *por onde* e *como* comunicar é a camada de
comunicação. Proposta não conhece canal; canal não conhece regra comercial — só recebe um
"pedido de mensagem" com destinatário, conteúdo (ou template) e uma referência opaca ao assunto.

## 2. O que o PublyFlow já tem (ponto de partida)

| Tabela atual | Papel hoje | Destino nesta arquitetura |
|---|---|---|
| `conversations` (`creator_id`, `source` INSTAGRAM/WHATSAPP/TIKTOK, `external_contact_label`) | Conversas **coladas manualmente** no Inbox | Evolui: ganha vínculo opcional com conta de canal e identidade do contato. As manuais continuam válidas (`channel_account_id` nulo). |
| `messages` (`body`, `entered_manually`, `received_at`) | Mensagens coladas; alimentam a classificação de `commercial_inquiries` | Evolui: ganha `direction`, `status`, `external_id`, referência ao assunto. A classificação por IA continua consumindo mensagens *inbound*. |
| `contacts` (`email`, `phone`, `instagram_handle`) | Pessoa do lado da marca | Continua sendo "a pessoa". Os endereços por canal migram gradualmente para `contact_identities`. |
| `proposal_publications` / `proposal_responses` | Fato comercial: o que foi enviado e a resposta | Intocadas. São a origem dos eventos. |

Diferença importante em relação ao DeskcommCRM: lá o CRM **nasce** do atendimento (WhatsApp é o
núcleo, WAHA, fila de IA, handoff). No PublyFlow o núcleo é **comercial** (proposta → aceite →
pipeline) e a comunicação é **periférica e episódica** (mandar link, avisar resposta, lembrar).
Isso justifica copiar os **padrões** do Deskcomm (event log, adapters, credenciais cifradas,
webhooks com assinatura, templates sincronizados, idempotência por `external_id`) mas **não** o
tamanho (fila de IA, sessões com warmup, handoff, roteamento, RAG).

## 3. Modelo de domínio

### 3.1 Entidades

| Entidade | Responsabilidade | Fase |
|---|---|---|
| `domain_events` | Outbox append-only dos fatos de negócio (`proposal.sent`…). Escrita na mesma transação do fato. | **0 (agora)** |
| `notifications` | Avisos in-app ao creator/equipe (sino). Primeiro consumidor dos eventos. | **0 (agora)** |
| `channel_accounts` | Uma conta conectada de um canal por organização (número WhatsApp, conta Instagram, remetente de e-mail). Credencial cifrada, só server. | 1 |
| `message_templates` | Templates Meta aprovados, sincronizados da WABA (nome, idioma, status, componentes, hash de contrato). | 1 |
| `contact_identities` | Endereço de um contato num canal: telefone E.164, IGSID, e-mail. Único por `(organization, channel, address)`. | 1 |
| `conversations` (evoluída) | Fio entre uma conta de canal e uma identidade de contato. | 1 |
| `messages` (evoluída) | Toda mensagem, entrada ou saída, com status de entrega e referência opcional ao assunto de negócio. | 1 |
| `conversation_opportunities` | Vínculo N:N entre conversa e oportunidade (manual ou sugerido por IA). | 3 |

**Deliberadamente não criados:**

- **`communication_channels` como tabela.** Canal é um enum (`WHATSAPP`, `INSTAGRAM`, `EMAIL`) no código. Uma tabela de "tipos de canal" não carrega dado de negócio.
- **`message_deliveries` separada.** O status (`queued → sent → delivered → read | failed`) cabe na própria mensagem, porque cada mensagem tem um destinatário. O histórico de transições fica no event log. Separar só se um dia houver multi-destinatário ou retentativas por destino.
- **`communication_events` separado de `domain_events`.** Um só bus, com namespaces (`proposal.*`, `message.*`).

### 3.2 Esquema (proposto, Fase 0 e 1)

```sql
-- FASE 0 ---------------------------------------------------------------
create table domain_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_type      text not null check (event_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  entity_type     text not null,                 -- 'proposal', 'message', …
  entity_id       uuid,
  payload         jsonb not null default '{}',   -- fatos mínimos; nunca PII além do necessário
  actor           jsonb not null default '{}',   -- { kind: 'user'|'client'|'system', user_id?, name? }
  occurred_at     timestamptz not null default now(),
  -- consumo (pull com FOR UPDATE SKIP LOCKED)
  status          text not null default 'pending' check (status in ('pending','processing','done','dead')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz,
  last_error      text,
  processed_at    timestamptz
);
create index domain_events_pending_idx on domain_events (next_attempt_at nulls first, occurred_at)
  where status = 'pending';
create index domain_events_entity_idx on domain_events (entity_type, entity_id, occurred_at desc);

create table notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recipient_user_id uuid not null references users(id) on delete cascade,  -- uma linha por membro (lida é individual)
  kind            text not null,                 -- 'proposal.approved', …
  title           text not null,
  body            text,
  link_path       text,                          -- '/proposals/<id>'
  source_event_id uuid references domain_events(id) on delete set null,
  unique (source_event_id, recipient_user_id),   -- idempotência do fan-out
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- FASE 1 ---------------------------------------------------------------
create type channel_kind as enum ('WHATSAPP', 'INSTAGRAM', 'EMAIL');
create type channel_provider as enum ('META_WHATSAPP_CLOUD', 'META_INSTAGRAM', 'RESEND');

create table channel_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel         channel_kind not null,
  provider        channel_provider not null,
  display_name    text not null,                 -- "+55 11 9xxxx-xxxx", "@thais"
  status          text not null default 'CONNECTING'
                  check (status in ('CONNECTING','ACTIVE','DEGRADED','DISCONNECTED')),
  is_default      boolean not null default false, -- conta usada quando o chamador não escolhe
  -- identificadores do provedor: colunas nullable tipadas (padrão Deskcomm), não jsonb solto
  meta_waba_id           text,
  meta_phone_number_id   text unique,
  meta_ig_user_id        text unique,
  email_from_address     text,
  credential_encrypted   bytea,                  -- token de acesso; nunca sai do servidor
  credential_expires_at  timestamptz,
  webhook_verified_at    timestamptz,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint channel_accounts_provider_ref check (
    (provider = 'META_WHATSAPP_CLOUD' and meta_phone_number_id is not null and meta_waba_id is not null) or
    (provider = 'META_INSTAGRAM'      and meta_ig_user_id is not null) or
    (provider = 'RESEND'              and email_from_address is not null)
  )
);
create unique index channel_accounts_one_default_per_channel
  on channel_accounts (organization_id, channel) where is_default;

create table message_templates (             -- só WhatsApp; espelho do que está aprovado na Meta
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  purpose         text,                        -- 'proposal_share', 'proposal_reminder' (mapeamento interno)
  meta_name       text not null,
  language        text not null,               -- 'pt_BR'
  category        text not null,               -- UTILITY | MARKETING
  status          text not null,               -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED
  components      jsonb not null,
  contract_hash   text not null,               -- hash dos placeholders; muda → quebra de contrato visível
  synced_at       timestamptz not null default now(),
  unique (channel_account_id, meta_name, language)
);

create table contact_identities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  channel         channel_kind not null,
  address         text not null,               -- E.164 | IGSID (escopado à conta IG) | e-mail normalizado
  channel_account_id uuid references channel_accounts(id) on delete cascade, -- obrigatório p/ IGSID
  opted_in_at     timestamptz,                 -- consentimento para mensagens iniciadas pela empresa
  opted_out_at    timestamptz,
  unique (organization_id, channel, address, channel_account_id)
);

-- evolução das tabelas existentes (nullable = compatível com as conversas manuais)
alter table conversations
  add column channel_account_id  uuid references channel_accounts(id) on delete set null,
  add column contact_identity_id uuid references contact_identities(id) on delete set null,
  add column last_inbound_at     timestamptz,  -- abre/fecha a janela de 24h
  add column last_message_at     timestamptz;
create unique index conversations_account_identity_unique
  on conversations (channel_account_id, contact_identity_id)
  where channel_account_id is not null;

alter table messages
  add column direction        text not null default 'INBOUND' check (direction in ('INBOUND','OUTBOUND')),
  add column status           text not null default 'RECEIVED'
    check (status in ('RECEIVED','QUEUED','SENT','DELIVERED','READ','FAILED')),
  add column external_id      text,            -- wamid / mid do provedor
  add column template_id      uuid references message_templates(id),
  add column subject_type     text,            -- 'proposal_publication' (referência opaca ao negócio)
  add column subject_id       uuid,
  add column error_code       text,
  add column sent_by_user_id  uuid references users(id),
  add column status_changed_at timestamptz;
create unique index messages_external_unique on messages (organization_id, external_id)
  where external_id is not null;
```

- **RLS:** todas as tabelas novas seguem o padrão por organização.
- **Acesso a credenciais:**
  - `channel_accounts.credential_encrypted` nunca é devolvido pela API.
  - A cifra usa uma chave de ambiente (`CHANNEL_CREDENTIALS_KEY`, AES-GCM).
- **Referência ao negócio:** `subject_type/subject_id` é o **único** ponto de contato entre mensagem e negócio.
  - Mensagem aponta para a publicação, nunca o contrário.
  - `proposals` e `proposal_publications` continuam sem nenhuma coluna de canal.

## 4. Event Log (`domain_events`)

### 4.1 Vale criar agora?

**Sim, pequeno.** Vale como *outbox* transacional com um consumidor. Não vale como plataforma de eventos.

| | Criar agora (outbox mínimo) | Adiar |
|---|---|---|
| **Vantagens** | <ul><li>O fato e o evento são gravados **na mesma transação** de `publish`/`respond`. Não há "aprovou mas o aviso sumiu".</li><li>Desacopla o domínio de canal desde o dia 1.</li><li>Dá histórico/auditoria (linha do tempo da proposta).</li><li>Follow-up, lembrete e agentes de IA viram **consumidores novos, sem tocar em `publish`/`respond`**.</li><li>Replay possível.</li></ul> | <ul><li>Zero infraestrutura nova.</li></ul> |
| **Custos** | <ul><li>1 tabela.</li><li>1 linha de insert em 2 services (`publish`, `respond`) mais o respectivo teste.</li><li>1 rota de worker `/api/internal/events/drain` com `SKIP LOCKED`.</li><li>1 agendamento (Vercel Cron).</li><li>Retentativa com backoff e estado `dead`.</li></ul> | <ul><li>Os side effects entram direto nos services.</li><li>Na Fase 1 seria preciso extraí-los, com risco de regressão no fluxo de aceite que acabamos de blindar.</li></ul> |
| **Complexidade** | <ul><li>Baixa.</li><li>O worker é uma função pura `handle(event)` por consumidor.</li><li>Idempotência por `notifications.source_event_id unique`, e depois por `messages.external_id`.</li></ul> | — |
| **Impacto** | <ul><li>Nenhuma mudança de contrato.</li><li>`ProposalSendingService.publish` e `ProposalResponseService.respond` ganham `insert domain_events` dentro da transação que já existe e já tem lock.</li></ul> | — |

**Não copiar do Deskcomm agora:**

- **Triggers Postgres emitindo eventos.** Aqui a emissão explícita no service é mais legível e testável. O Deskcomm usa trigger porque tem muitos produtores.
- **`consumed_by text[]` com vários workers.** Com um consumidor, `status` basta. Evolui para uma tabela `event_consumptions(event_id, consumer)` quando surgir o 2º consumidor com ciclo de vida diferente.
- **pg_boss / Redis / Realtime.**

### 4.2 Catálogo inicial (Fase 0)

| Evento | Emitido em | Payload (mínimo) | Consumidores |
|---|---|---|---|
| `proposal.sent` | `publish` (created) | `proposal_id, publication_id, version_number, opportunity_id` | notificação (opcional); Fase 1: dispatcher de canal |
| `proposal.approved` | `respond` ACCEPT | `proposal_id, publication_id, respondent_name` | notificação |
| `proposal.changes_requested` | `respond` REQUEST_CHANGES | `…, message_excerpt` (≤140) | notificação |
| `proposal.rejected` | `respond` REJECT | `…, reason_excerpt` | notificação |

- **Nomenclatura:** `{entity}.{action}` em snake_case, validada por `CHECK`, como no Deskcomm.
- **Sem PII:** o e-mail do respondente fica em `proposal_responses`, não no evento.

**Eventos futuros:**
- `message.received`
- `message.status_changed`
- `proposal.viewed`
- `proposal.reminder_due`

### 4.3 Worker

```
Vercel Cron (1/min) ──► POST /api/internal/events/drain   (Bearer INTERNAL_CRON_SECRET, fail-closed)
                          loop até N eventos ou ~20s:
                            BEGIN; select … where status='pending' and (next_attempt_at is null or <= now())
                                   order by occurred_at limit 20 for update skip locked;
                            para cada: handlers[event_type](event) → ok: done | erro: attempts+1,
                                       next_attempt_at = now() + 2^attempts min (máx 5) → 'dead'
                            COMMIT
publish/respond, após commit ──► fetch fire-and-forget para /drain  (latência ~segundos em vez de 1 min)
```

O "chute" pós-commit é otimização. A **garantia** vem do cron. No ambiente Vercel não existe processo residente, e esse é o motivo de não copiar os workers de longa duração do Deskcomm.

## 5. WhatsApp Cloud API

### 5.1 Conexão (multi-organização)

- **Modelo:** o PublyFlow é *Tech Provider* na Meta, e cada organização conecta a própria WABA via **Embedded Signup**. Isso implica:
  - o número pertence ao cliente;
  - a cobrança das conversas é da WABA dele;
  - a reputação (quality rating) é dele.
- **Fluxo:** o SDK JS da Meta devolve um `code`, o backend troca pelo token do *business integration system user* e grava `meta_waba_id`, `meta_phone_number_id` e `credential_encrypted`. Em seguida, `subscribed_apps` na WABA e um `channel_accounts` com status `ACTIVE`.
- **Um número por organização** (`is_default`). **Vários números no futuro:** já suportado pelo schema (N `channel_accounts`), e o chamador escolhe ou cai no default.
- **Webhook:**
  - `/api/webhooks/meta` é **um só** para o app inteiro.
  - Verifica `X-Hub-Signature-256` com `META_APP_SECRET` antes de qualquer parse.
  - Roteia por `metadata.phone_number_id` para `channel_accounts`; se desconhecido, responde 200 e descarta (não vaza informação e não deixa a Meta em retry infinito).
  - Idempotência por `messages.external_id` (wamid).

### 5.2 Templates

- **Quando o template é obrigatório:** mensagem iniciada pela empresa, fora da janela de 24h de atendimento, só com template aprovado. O envio de proposta costuma ser exatamente esse caso.
- **Sincronização:** via Graph (`GET /{waba_id}/message_templates`) no connect e sob demanda. O `purpose` mapeia template → uso interno. Se o `contract_hash` divergir, o uso fica bloqueado com erro visível, como no Deskcomm.
- **Template sugerido `proposta_enviada`:**
  - categoria: UTILITY;
  - idioma: pt_BR;
  - corpo: "Olá, {{1}}! {{2}} enviou a proposta "{{3}}". Toque para ver e responder.";
  - botão **URL dinâmica**: `https://app.publyflow.com/p/{{1}}`, com o token como sufixo.
- **Por que botão:** o token não vai no corpo do texto (menos vazamento em prévia de notificação e cópia) e o link fica rastreável.
- **Criação dos templates:** é trabalho do onboarding. Na V1, o PublyFlow cria os templates padrão automaticamente na WABA conectada via API e aguarda aprovação.

### 5.3 Envio de proposta

```
Builder: [Enviar por WhatsApp]  (depois de publicar; destinatário = contato da oportunidade)
  → POST /api/proposals/:id/share { channel: 'WHATSAPP', contact_id }
      1. exige publicação atual (Spec 2) — usa o public_token existente
      2. resolve channel_account default do canal + contact_identity (telefone E.164)
      3. valida consentimento (opted_in_at) e opt-out
      4. dentro da janela de 24h? texto livre com link : template 'proposal_share'
      5. cria messages (OUTBOUND, QUEUED, subject = publication) + domain_event message.queued
  → worker: adapter.send() → Graph /messages → grava external_id + SENT
  → webhook statuses → DELIVERED / READ / FAILED (+ error_code) → UI do builder mostra ✓✓
```

- **Uma ação explícita do creator.** Enviar por WhatsApp não é consequência automática de `publish`, porque o creator escolhe o canal. O evento `proposal.sent` continua acontecendo igual (o link é o mesmo).
- **Riscos:**
  - Verificação do negócio e restrição de WABA: a experiência do obra-facil em 2026-09 teve WABA restrita e migração parada.
  - Qualidade do número.
  - Custo por conversa iniciada.
  - O opt-in é exigência da Meta.
  - Tokens expiram, e o status `DEGRADED` mais um aviso ao creator cobrem isso.

## 6. Instagram DM

### 6.1 A conta conectada é do creator

No PublyFlow a organização é o creator ou a assessoria. A conta Instagram conectada é o **perfil profissional do creator**; a marca é a contraparte que conversa com ele. "Conectar a conta da marca" não se aplica, porque a marca não é usuária do PublyFlow.

### 6.2 Arquitetura

- **Conexão:** *Instagram API with Instagram Login* (conta Business ou Creator), OAuth, scopes de mensagens, token de longa duração cifrado em `channel_accounts` (`meta_ig_user_id`). Renovação agendada antes de `credential_expires_at`.
- **Receber:** o mesmo `/api/webhooks/meta` (objeto `instagram`) roteia por `meta_ig_user_id` e depois:
  - `contact_identities` (IGSID, escopado à conta);
  - `conversations`;
  - `messages` (INBOUND);
  - `domain_event message.received`.

  O classificador de `commercial_inquiries` que já existe consome o `message.received`, e é **aqui** que a IA de detecção de oportunidade ganha fonte automática.
- **Enviar:** só **responder** dentro da janela de 24h desde a última mensagem da pessoa. A tag `HUMAN_AGENT` estende para 7 dias quando elegível. Não existem templates nem mensagem iniciada pela empresa.
- **Consequência de produto:** "compartilhar proposta via Instagram" só existe como resposta numa conversa ativa com a marca. Fora da janela, a UI oferece copiar o link para o creator colar manualmente no app. Esse limite é da plataforma e não tem contorno legítimo.
- **Vincular a oportunidades:** quando a IA marca a conversa como consulta comercial, o fluxo existente (inquiry → lead → opportunity) cria o vínculo em `conversation_opportunities` (Fase 3).

## 7. E-mail

- **Provedor:** Resend (usado pelo Deskcomm para transacional).
- **Remetente na V1:** `propostas@publyflow.com`, com `Reply-To` do creator. Assim não há verificação de domínio por organização.
- **Domínio próprio da organização:** Fase 2+ (`channel_accounts` provider RESEND com domínio verificado).
- **Envio:** o mesmo fluxo `share` com `channel: 'EMAIL'`, sem janela nem template Meta, usando um template HTML interno.
- **Retorno do provedor:** bounce e complaint voltam por webhook do Resend, que marca a mensagem como `FAILED` e o `opted_out_at`.

## 8. Conversas: vale criar o módulo agora?

**Não como módulo novo.** Evoluir as tabelas `conversations`/`messages` que já existem, e só na Fase 1.

| Opção | Vantagens | Desvantagens |
|---|---|---|
| **Conversation → Opportunity → Proposal** (conversa pertence à oportunidade) | Contexto comercial direto | Uma marca conversa sobre vários deals no mesmo fio (WhatsApp/IG têm **um** fio por par conta↔pessoa). Forçar 1 conversa = 1 oportunidade fragmenta o histórico ou exige inventar threads que o canal não tem. Mensagens antes de existir oportunidade ficam órfãs. |
| **Conversation → Contact(identity) (+ N:N Opportunity)** ✅ | Espelha o canal real (1 fio por conta↔identidade, como no Deskcomm). A conversa existe antes do deal e sobrevive a vários deals. As oportunidades se ligam por `conversation_opportunities` (N:N), e cada mensagem enviada já aponta para o assunto (`subject`). | Um vínculo a mais para montar a linha do tempo da oportunidade (join). |

**Recomendação:** `conversation` = par (`channel_account`, `contact_identity`). Oportunidade e proposta ligam-se **por referência** (`messages.subject_*` agora; `conversation_opportunities` na Fase 3), nunca por posse.

## 9. APIs (visão)

| Rota | Fase | Descrição |
|---|---|---|
| `GET /api/notifications`, `PATCH /api/notifications/:id` (lida) | 0 | Sino in-app |
| `POST /api/internal/events/drain` | 0 | Worker do outbox (Bearer secret, fail-closed) |
| `GET/POST /api/channel-accounts`, `POST /api/channel-accounts/whatsapp/connect` (code do Embedded Signup), `DELETE /api/channel-accounts/:id` | 1 | Conexões (OWNER/MANAGER quando papéis existirem) |
| `POST /api/channel-accounts/:id/templates/sync` | 1 | Sincroniza templates |
| `POST /api/proposals/:id/share` `{ channel, contact_id }` | 1 | Envia a publicação atual pelo canal |
| `GET /api/proposals/:id/messages` | 1 | Mensagens com `subject` = publicações da proposta (status de entrega) |
| `GET/POST /api/webhooks/meta` | 1 | Verificação (hub.challenge) e eventos assinados |
| `POST /api/webhooks/resend` | 1 | Bounce/complaint |
| `GET /api/conversations`, `POST /api/conversations/:id/messages` | 3 | Inbox unificada |

- **Organização:** todas as rotas do creator tiram a organização da sessão (Auth v1).
- **Webhooks:** tiram a organização da conta roteada, nunca do corpo.

## 10. Roadmap incremental

### Fase 0 — agora (sem nenhuma API de canal)
Entrega valor imediato e cria a espinha dorsal:
- `domain_events`, emitido em `publish`/`respond` na mesma transação.
- Worker `drain` com Vercel Cron, mais o chute pós-commit.
- `notifications` com sino no header: "Maria aceitou 'Campanha Verão'", com link para o builder.
- **Compartilhar sem API** no diálogo pós-envio e no painel:
  - **WhatsApp** por *click-to-chat*: `https://wa.me/<telefone>?text=<mensagem + link>`, abre o app do creator com a mensagem pronta;
  - **e-mail** por `mailto:` com assunto e corpo;
  - **Instagram:** copiar a mensagem e o link.

  Nada é gravado como "mensagem enviada", porque não há confirmação. No máximo `proposal.share_opened` para métrica, e isso é opcional.

Sem Meta, sem template, sem risco de WABA. O creator já envia pelo próprio WhatsApp em 1 clique.

### Fase 1 — WhatsApp Cloud API (envio de proposta)
- `channel_accounts`, conexão por Embedded Signup e cifra de credencial.
- `message_templates`, com sync e criação dos templates padrão.
- `contact_identities` (telefone), com opt-in registrado no contato.
- Evolução de `conversations`/`messages` e `POST /share` com `WHATSAPP`.
- Webhook Meta: status de entrega e, no mínimo, persistir o inbound para abrir a janela de 24h.
- Status de entrega no painel de envio.
- E-mail via Resend entra aqui também: é barato e usa o mesmo `share`.

### Fase 2 — Instagram
- Conexão por Instagram Login, com renovação de token.
- Webhook `instagram` → conversas e mensagens inbound.
- Resposta dentro da janela, com `share` restrito a conversa ativa.
- A classificação de consulta comercial passa a receber DMs automaticamente.

### Fase 3 — Inbox unificada
- A tela de Inbox passa a listar conversas reais (WhatsApp, IG, e-mail) e as manuais.
- Resposta pela própria tela.
- `conversation_opportunities`.
- Linha do tempo da oportunidade: mensagens, publicações e respostas.

### Fase 4 — Agentes de IA
- Consumidores de eventos:
  - lembrete de proposta sem resposta (evento agendado `proposal.reminder_due` N dias após `proposal.sent` sem resposta);
  - follow-up;
  - reengajamento.
- Rascunhos gerados por IA **aprovados pelo creator** antes de sair; nada é enviado sozinho na V1 do agente.
- Guardrails:
  - opt-out;
  - janela de 24h;
  - limite de envios por contato.

## 11. Riscos e trade-offs

| Risco / trade-off | Mitigação / decisão |
|---|---|
| Restrição da WABA / verificação da Meta (vivido no obra-facil) | A Fase 0 não depende da Meta. A Fase 1 começa por 1 organização piloto. O status `DEGRADED` fica visível, e o *click-to-chat* serve de fallback. |
| Dispatch no ambiente serverless (sem worker residente) | Cron de 1 min mais o chute pós-commit. Os side effects são idempotentes e o estado `dead` é inspecionável. |
| Link da proposta vazado via canal | O token vai só em botão de URL dinâmica ou no link; nada de cabeçalho `Referer` (Spec 2). A Spec 2 já registra o risco de consumo da resposta. |
| Consentimento e LGPD em mensagens iniciadas pela empresa | Tratados pelo `opted_in_at`/`opted_out_at` em `contact_identities`. Os eventos não carregam PII. |
| Instagram não permite iniciar conversa | Aceito como limite da plataforma, e o produto se adapta (resposta na janela ou cópia do link). |
| `domain_events` cresce | Índice parcial nos pendentes e retenção de 90 dias para `done` (job mensal) quando o volume justificar. |
| `subject_type/subject_id` polimórfico (sem FK) | Conjunto fechado validado no código (`proposal_publication`). É o preço do desacoplamento, e é o mesmo padrão do `entity_kind/entity_id` do Deskcomm. |
| Dois modelos de conversa convivendo (manual × canal) | São colunas nullable, e a Fase 3 unifica a tela. Não há migração de dados. |

## 12. Recomendação

**Implementar AGORA (Fase 0), numa spec/plano próprio e pequeno:**
1. **`domain_events` como outbox**:
   - emitido em `ProposalSendingService.publish` (quando `created`) e `ProposalResponseService.respond`, dentro das transações que já existem;
   - com teste de que o evento e o fato são atômicos.
2. **Worker `drain`**, com Vercel Cron, `SKIP LOCKED`, retentativa e `dead`.
3. **`notifications` e o sino** no header, que é o primeiro consumidor. Isso resolve o "aviso só dentro do app" da Spec 2 de verdade: hoje o creator só descobre a resposta abrindo o builder.
4. **Botões de compartilhar sem API** (WhatsApp click-to-chat, `mailto:`, copiar para Instagram) no diálogo pós-envio.

Custo estimado: 1 migration, cerca de 6 tasks. Não toca em `proposals`. Não depende da Meta.

**Deixar para depois** (com o schema já desenhado aqui, então sem dívida):
- `channel_accounts`, templates, identidades e a evolução de conversas/mensagens: Fase 1, quando houver um piloto disposto a conectar a WABA.
- Instagram: Fase 2.
- Inbox unificada: Fase 3.
- Agentes: Fase 4.

Por que isso não gera dívida: a única costura entre o domínio comercial e a comunicação é o **evento** (Fase 0) e a **referência de assunto** na mensagem (Fase 1). Nenhuma das duas exige mudar `proposals` quando os canais chegarem.
