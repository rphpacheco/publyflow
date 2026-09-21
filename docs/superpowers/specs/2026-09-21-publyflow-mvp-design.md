# PublyFlow — MVP Design Spec

Status: Approved for planning (v2 — revisão de domínio incorporada 2026-09-21)
Owner: Raphael Pacheco

## 1. Visão do Produto

PublyFlow é o sistema operacional comercial de creators: centraliza e automatiza o fluxo
comercial completo, da mensagem recebida até a comissão paga.

Primeiro usuário real: Thais Miranda (@thaimiranda) e sua assessora comercial (comissão
configurável por organização/creator via `commission_rules` — nunca hardcoded).

Princípio de produto: entre "feature tecnicamente impressionante" e "resolver melhor o
problema da assessora", sempre a segunda. Critério de validação: a assessora consegue
trabalhar o dia inteiro no PublyFlow sem planilhas, prints e anotações paralelas.

Regra de UX (reforçada nesta revisão): a assessora não quer "gerenciar um CRM". Ela quer
respostas rápidas a perguntas como "chegou alguma publi?", "quem está interessado?", "quem
pediu mídia kit?", "quanto posso fechar?". Dashboard e Inbox são orientados a ações e
oportunidades, não a preenchimento de formulários administrativos.

## 2. Decisões Confirmadas

| # | Decisão | Resolução |
|---|---|---|
| 1 | Modelo Creator ↔ User | Creator sempre tem conta de login própria desde o MVP |
| 2 | Fonte do Inbox no MVP | Manual/Import como fonte real de conversas. Integração ao vivo (Instagram/WhatsApp/TikTok) é pendência principal de arquitetura (§8), adapters já desenhados para plugar sem retrabalho |
| 3 | Backend | Next.js 16 monólito modular (Route Handlers), camadas `domain/` → `services/` → `repositories/` → `app/api/` |
| 4 | AI Provider | OpenAI como provider padrão, atrás de interface `AIService` abstrata |
| 5 | Repositório | `/Users/raphaelpacheco/workspaces/saas/publyflow` |
| 6 | Commercial Inquiry como etapa própria | Mensagem com indício comercial vira `commercial_inquiry` antes de virar `lead` — nem toda mensagem comercial vira Lead/Opportunity automaticamente |
| 7 | Company ≠ Brand | Entidades separadas; oportunidade pode referenciar empresa, marca, ou ambas |
| 8 | Preços versionados | `rate_cards`/`rate_card_items` como fonte de preço; `proposal_items` copia o preço no momento da criação (histórico imutável) |
| 9 | Analytics multi-fonte | `analytics_sources` abstrai origem do dado (MANUAL/INSTAGRAM/TIKTOK/YOUTUBE); domínio agnóstico à origem |
| 10 | Media Kit | Web-first (página pública dinâmica); PDF é export gerado a partir da mesma página, não um documento paralelo mantido manualmente |

## 3. Fluxo de Domínio (revisado)

Fluxo conceitual completo:

```
Message
  -> AI Classification
  -> Commercial Inquiry
  -> Lead
  -> Opportunity
  -> Rate Card / Services
  -> Proposal
  -> Campaign
  -> Payment
  -> Commission
  -> Relationship / Client History
```

**Nem toda mensagem percorre o fluxo inteiro.** Transições modeladas explicitamente:

- **Fã**: `Message → AI Classification (FAN) → encerrado`. Não gera Commercial Inquiry.
- **Falso positivo / descartada**: `Message → AI Classification (COMMERCIAL_LEAD, baixa confiança ou revisão manual) → Commercial Inquiry → status DISCARDED/FALSE_POSITIVE (terminal)`.
- **Cliente existente**: `Message → AI Classification → Commercial Inquiry → contato resolvido para Company/Contact já existente → Lead auto-qualificado → nova Opportunity`. O Lead ainda é criado (mantém o pipeline consistente para relatórios), mas é auto-qualificado instantaneamente — sem fricção extra para a assessora.
- **Fluxo completo**: `Message → Commercial Inquiry → Lead → Opportunity → Proposal (preços copiados de Rate Card) → Campaign → Payment → Commission`.

Uma `Commercial Inquiry` pode, a qualquer momento: ser descartada, ser marcada falso
positivo, ser convertida em Lead, ou ser associada a um Lead/Opportunity já existente
(evita duplicar quando a mesma marca manda mais de uma mensagem).

## 4. Riscos Externos (Instagram / WhatsApp / TikTok)

*(sem alterações desta revisão — mantido da v1)*

- **Instagram**: mensageria via Graph API exige App Review da Meta, sem backfill de
  histórico. Insights tem permissões e rate limits próprios.
- **WhatsApp**: só viável via Cloud API oficial, número verificado, templates aprovados,
  janela de 24h.
- **TikTok**: sem API pública de DM. Mensageria TikTok provavelmente fica manual
  indefinidamente; só analytics é automatizável.
- Implicação: "Social Sales Intelligence" no MVP real roda sobre entrada manual (todas as
  fontes) + Instagram parcial em P1.

## 5. Arquitetura Técnica

*(mantida da v1, com ajustes)*

**Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui.

**Backend**: Next.js Route Handlers em camadas `domain/` → `services/` → `repositories/` →
`app/api/`.

**Database**: PostgreSQL via Supabase (Auth + Storage + RLS), Drizzle ORM. RLS por
`organization_id` em toda tabela de domínio.

**Jobs**: Redis + BullMQ via Upstash — classificação IA, geração de PDF do Media Kit sob
demanda, sync futuro de métricas, notificações.

**AI Layer**: `AIService` abstrata — `classifyMessage()`, `extractLeadData()`,
`scoreOpportunity()`, `summarizeConversation()`, `generateProposal()`, `suggestFollowUp()`,
`answerCRMQuestion()`. Provider padrão: OpenAI. Input/output estruturado (JSON schema),
logging, tratamento de erro, controle de custo.

**Eventos**: event bus simples in-process para o MVP. Exemplo:
`message.received → ai.classified → commercial_inquiry.created → lead.created →
opportunity.created → notification.created`.

**Integrações**: adapters `SocialProvider` (Instagram/TikTok/YouTube) e
`MessagingProvider` (Instagram/WhatsApp/TikTok/**Manual**). `analytics_sources` cumpre o
mesmo papel de abstração do lado de métricas — o domínio nunca sabe se um dado veio de
input manual ou de uma API.

**Media Kit — arquitetura web-first**: `media_kits` define conteúdo/layout (blocos,
template, slug público). A página pública (`/m/:slug`) renderiza os dados mais recentes
resolvidos a partir de `analytics_snapshots`/`analytics_metrics` no momento do acesso
(cache curto, não live-fetch em API externa). O PDF é gerado sob demanda a partir dessa
mesma página (render headless → PDF), garantindo uma única fonte de verdade — não existe
"documento PDF" mantido em paralelo.

**Hospedagem**: Vercel + Supabase + Upstash.

**Segurança / LGPD**: mantido da v1 — RLS por organização, `integration_credentials`
criptografadas, `audit_logs`, retenção de dados pessoais a definir na fase de
Auth/Organizations.

## 6. Modelo de Dados (v2)

### Núcleo / Organização
`organizations`, `users`, `organization_members`, `creators` (com `user_id` — sempre tem
login próprio).

### Redes Sociais / Analytics
- `social_platforms`, `social_accounts`
- `analytics_sources` (MANUAL, INSTAGRAM, TIKTOK, YOUTUBE) — abstrai origem
- `analytics_snapshots` (creator_id, source_id, collected_at)
- `analytics_metrics` (snapshot_id, metric_name, value, unit)

### Empresa / Marca / Contato
- `companies` — cliente contratante (empresa, agência ou holding)
- `brands` — marca específica; `company_id` **nullable** (marca pode existir antes de
  sabermos a empresa dona, comum quando a mensagem só cita "somos da Eudora")
- `contacts` — pessoa física; `company_id` **nullable**

### Conversas / Qualificação
- `conversations`, `messages`
- `commercial_inquiries` — `conversation_id`/`message_id` de origem, `creator_id`,
  `status` (NEW, DISCARDED, FALSE_POSITIVE, CONVERTED), campos extraídos pela IA
  (`company_guess`, `brand_guess`, `contact_name_guess`, `budget_guess`, etc. — todos
  nullable, nunca inventados), `converted_lead_id` nullable, `linked_lead_id`/
  `linked_opportunity_id` nullable (associação a registro existente)
- `leads` — `inquiry_id` nullable (pode nascer de uma inquiry ou ser criado manualmente),
  `contact_id`, `company_id` nullable, `brand_id` nullable
- `opportunities` — `lead_id`, `company_id` nullable, `brand_id` nullable (regra de
  domínio: ao menos um dos dois deve estar presente), `rate_card_id` nullable (tabela de
  referência usada)
- `opportunity_stage_history`

### Tarefas
`tasks`, `activities`

### Catálogo / Precificação
- `services`, `service_packages`
- `rate_cards` (`organization_id`, `creator_id` nullable = tabela geral da org, `name`,
  `valid_from`/`valid_to`, `is_active`)
- `rate_card_items` (`rate_card_id`, `service_id`, `price`, `unit_description`)

### Propostas
- `proposals` (`opportunity_id`, `rate_card_id` referência informativa, `template`,
  `status`)
- `proposal_items` (`proposal_id`, `service_id` nullable, `description`, `quantity`,
  `unit_price` — **copiado da rate card no momento da criação**, nunca recalculado a
  partir do preço atual)
- `proposal_blocks` (conteúdo do editor em blocos)
- `proposal_versions` (snapshot completo do conteúdo a cada edição relevante)
- `proposal_view_events`

### Campanhas / Financeiro
- `campaigns` (`opportunity_id`, briefing, arquivos, contrato)
- `campaign_deliverables`
- `payments`
- `commission_rules` (`organization_id`, `creator_id` nullable = default da org,
  `percentage`, `valid_from`/`valid_to`)
- `commissions` (`campaign_id`/`payment_id`, `rate_applied` — **copiado de
  commission_rules no momento do cálculo**, `amount`)

### Media Kit
`media_kits` (`creator_id`, `slug`, `template`, `blocks` JSON, `is_published`) — PDF não é
uma tabela própria; é um artefato gerado sob demanda a partir do media kit.

### IA / Observabilidade
`ai_classifications`, `ai_extractions`, `ai_classification_feedback` (correções manuais —
insumo futuro de aprendizado), `notifications`, `audit_logs`, `integration_credentials`,
`webhook_events`.

**Regra não-negociável**: toda tabela de domínio carrega `organization_id` com RLS desde a
primeira migration.

### Histórico e Versionamento — onde se aplica

| Dado | Estratégia |
|---|---|
| Preço de serviço em proposta | Copiado para `proposal_items.unit_price` na criação |
| Conteúdo completo da proposta | Snapshot em `proposal_versions` a cada edição relevante |
| Taxa de comissão aplicada | Copiada para `commissions.rate_applied` no cálculo |
| Métricas usadas em proposta/media kit histórico | `analytics_snapshots` já é histórico por natureza (append-only, nunca sobrescrito) |
| Estágios do pipeline | `opportunity_stage_history` já registra a trilha completa |
| Tabela de preços (`rate_cards`) | Nunca editada in-place para itens já usados — nova versão/tabela quando os preços mudam; `rate_card_items` antigos permanecem intactos para referência |

## 7. MVP — Escopo (v2)

**P0**: Auth, Organizations, Creators, Companies, Brands, Contacts, Inbox Manual, Messages,
AI Classification, Commercial Inquiry, Leads, Opportunities, Pipeline, Tasks, Services,
Rate Cards, Proposals, Media Kit Web, Analytics Manual, Dashboard.

**P1**: Instagram API, Instagram Insights, sincronização automática de métricas, proposta
compartilhável, aprovação de proposta.

**P2**: WhatsApp Cloud API, Financeiro completo, contratos, assinatura eletrônica, AI
Assistant operacional, automações avançadas, multi-creator/agência avançada.

**LATER**: TikTok analytics, YouTube.

*(PDF export do Media Kit entra no P0 como parte de "Media Kit Web", já que é apenas uma
renderização derivada — não é escopo adicional relevante.)*

## 8. UX — Inbox e Dashboard orientados a ação

**Dashboard** responde diretamente: leads novos, negociações em andamento (R$), propostas
enviadas, fechado no mês, comissão do mês, oportunidades paradas precisando de follow-up.
Sem telas administrativas de preenchimento — cada card leva direto à ação pendente.

**Inbox manual — fluxo alvo (mínimo de cliques):**
1. Abrir Inbox.
2. Colar a mensagem.
3. Selecionar origem (Instagram / WhatsApp / TikTok).
4. Processar (IA classifica: categoria, intenção, empresa, contato, marca, score,
   campos extraídos).
5. Assessora confirma ou corrige inline.
6. Sistema cria/associa `Commercial Inquiry` (ou a descarta como fã/falso positivo).

Atalhos de teclado e campos pré-preenchidos pela IA são requisito de design, não
"nice to have" — esse fluxo é usado diariamente antes de qualquer integração oficial
existir, então a fricção aqui tem custo direto no dia a dia da assessora.

## 9. Pendências Registradas

1. **Integração real Instagram/WhatsApp/TikTok** — pendência principal de arquitetura.
   Adapters já desenhados (§5) para plugar sem redesenho do domínio.
2. Política de retenção de dados pessoais (LGPD) — definir na fase de Auth/Organizations.
3. OCR para import de prints — melhoria futura sobre o fluxo manual (texto colado é
   suficiente no P0).
4. Regra de negócio "Opportunity precisa de company_id OU brand_id" — validar na camada de
   domínio (services), não apenas como constraint de banco, para permitir mensagens de
   erro claras na UI.

## 10. Próximo Passo

Gerar o plano de implementação em fases pequenas e verificáveis via skill `writing-plans`.
