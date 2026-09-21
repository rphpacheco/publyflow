# PublyFlow — MVP Design Spec

Status: Approved for planning (decisions confirmed 2026-09-21)
Owner: Raphael Pacheco

## 1. Visão do Produto

PublyFlow é o sistema operacional comercial de creators: centraliza e automatiza o fluxo
Mensagem → Identificação → Lead → Qualificação → Negociação → Métricas → Proposta →
Fechamento → Campanha → Pagamento → Comissão → Relacionamento.

Primeiro usuário real: Thais Miranda (@thaimiranda) e sua assessora comercial (comissão de
15%, configurável por organização/creator — nunca hardcoded).

Princípio de produto: entre "feature tecnicamente impressionante" e "resolver melhor o
problema da assessora", sempre a segunda. Critério de validação do MVP: a assessora
consegue trabalhar o dia inteiro no PublyFlow sem planilhas, prints e anotações paralelas.

A IA deve parecer uma camada de inteligência por trás de um SaaS premium — não um chatbot.

## 2. Decisões Confirmadas

| # | Decisão | Resolução |
|---|---|---|
| 1 | Modelo Creator ↔ User | Creator sempre tem conta de login própria desde o MVP (perfil "Creator" da seção de permissões acessa seus próprios dados) |
| 2 | Fonte do Inbox no MVP | **Manual/Import** como fonte real de conversas (colar texto; import de print via OCR é melhoria futura). Integração Instagram/WhatsApp/TikTok ao vivo fica registrada como **pendência principal de arquitetura** (ver §7) — o adapter `MessagingProvider` já nasce desenhado para plugar essas fontes sem retrabalho. O fluxo manual precisa ser rápido o suficiente para não virar fricção para a assessora (poucos cliques, atalhos de teclado, campos pré-preenchidos pela IA a partir do texto colado). |
| 3 | Backend | Next.js 16 monólito modular (Route Handlers), camadas `domain/` → `services/` → `repositories/` → `app/api/`. Sem NestJS/API separada no MVP. |
| 4 | AI Provider | **OpenAI** como provider padrão, atrás de uma interface `AIService` abstrata — nenhuma chamada ao SDK da OpenAI fora dessa camada, para permitir trocar/adicionar provider (ex. Anthropic) sem tocar no domínio. |
| 5 | Repositório | `/Users/raphaelpacheco/workspaces/saas/publyflow` (git inicializado) |

## 3. Riscos Externos (Instagram / WhatsApp / TikTok)

- **Instagram**: mensageria via Graph API exige Instagram Professional + Facebook Login for
  Business + permissão `instagram_manage_messages`, sujeita a App Review da Meta (semanas,
  pode ser recusada). Sem backfill de histórico — só mensagens novas após ativação do
  webhook. Insights (métricas) usa outro conjunto de permissões e tem rate limits próprios.
- **WhatsApp**: só viável via WhatsApp Cloud API oficial, número comercial verificado,
  templates aprovados para mensagens iniciadas pela empresa, janela de 24h para respostas
  livres. Não é uma API pensada para "monitorar DMs de fãs vs. marcas" no sentido amplo.
- **TikTok**: **não existe API pública de DM** para contas comerciais. Display/Content
  Posting API cobre postagens e métricas básicas, não mensageria — mensageria TikTok
  provavelmente fica manual indefinidamente.
- Implicação: o diferencial "Social Sales Intelligence" no MVP real roda sobre
  **entrada manual (todas as fontes) + Instagram parcial em P1**, não os três canais ao
  vivo desde o dia 1. Isso deve ficar explícito para a Thais/assessora.

## 4. Arquitetura Técnica

**Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui.

**Backend**: Next.js Route Handlers, organizado em camadas:
- `domain/` — entidades e regras de negócio puras (sem I/O)
- `services/` — casos de uso (orquestram domain + repositories + AIService)
- `repositories/` — acesso a dados via Drizzle
- `app/api/` — handlers finos (validação de input, chamam services)

**Database**: PostgreSQL via Supabase (Auth + Storage + RLS), ORM Drizzle. RLS por
`organization_id` em toda tabela de domínio, sem exceção, desde a primeira migration.

**Jobs**: Redis + BullMQ via Upstash (serverless) para: classificação IA de mensagens,
geração de PDF, sync de métricas (quando aplicável), notificações.

**AI Layer**: `AIService` com interface abstrata —
`classifyMessage()`, `extractLeadData()`, `scoreOpportunity()`, `summarizeConversation()`,
`generateProposal()`, `suggestFollowUp()`, `answerCRMQuestion()`. Cada operação: input/output
estruturado (JSON schema), validação, logging, tratamento de erro, controle de custo
(token/cost tracking). Provider padrão: OpenAI.

**Eventos**: event bus simples in-process (emitter + listeners) para o MVP — sem infra de
mensageria dedicada (YAGNI). Ex.: `message.received → ai.classified → lead.created →
opportunity.created → notification.created`. Migra para algo mais robusto só se o volume
justificar.

**Integrações**: adapters `SocialProvider` (Instagram/TikTok/YouTube) e `MessagingProvider`
(Instagram/WhatsApp/TikTok/**Manual**) — domínio nunca acoplado a API externa diretamente.
Never mock integrações reais como se fossem reais; provider `Manual` é uma fonte real de
dados, não um mock.

**Hospedagem**: Vercel (Next.js) + Supabase (DB/Auth/Storage) + Upstash (Redis).

**Segurança**: autenticação e autorização via Supabase Auth + RLS, isolamento multi-tenant
por `organization_id`, validação de input, secrets fora do código, logs estruturados,
audit trail (`audit_logs`), rate limiting, tokens de integrações sociais nunca em texto
puro (`pgcrypto`/Supabase Vault em `integration_credentials`).

**LGPD**: dados pessoais (nome, telefone, e-mail, mensagens, contatos) tratados com
finalidade explícita, minimização, retenção definida, exclusão e exportação sob pedido,
controle de acesso e auditoria. Política de retenção de conteúdo bruto de mensagens vs.
dados derivados (lead/score) fica como item a decidir na fase de implementação de
Auth/Organizations (não bloqueia o design geral).

## 5. MVP — Escopo

**MUST HAVE (P0):** Auth, Organizations, Creators (com login próprio), Companies, Contacts,
Leads, Opportunities, Pipeline Kanban, Inbox (fonte Manual/Import), Classificação IA
(categoria + score comercial + extração estruturada, nunca inventando dados —
null quando ausente), Dashboard, Tasks/Follow-ups, Catálogo de Serviços, Propostas (editor
em blocos, templates visuais, geração de PDF), Media Kit (dados de Analytics inseridos
manualmente/importados inicialmente), estrutura de Analytics pronta para sync futuro.

**SHOULD HAVE (P1):** Instagram API real (mensagens + insights, sujeito a aprovação Meta),
sync automático de métricas, histórico de métricas, proposta compartilhável por URL,
aprovação de proposta pelo cliente.

**COULD HAVE (P2):** WhatsApp Cloud API, Financeiro completo, contratos/assinatura
eletrônica, assistente de IA operacional, automações avançadas, múltiplos creators/agência
multiusuário avançada.

**LATER:** TikTok (analytics apenas — mensageria improvável via API pública), YouTube.

## 6. Modelo de Dados (ajustes ao modelo original)

Tabelas base (do brief original): `organizations`, `users`, `organization_members`,
`creators`, `social_accounts`, `social_platforms`, `companies`, `contacts`, `conversations`,
`messages`, `leads`, `opportunities`, `opportunity_stage_history`, `tasks`, `activities`,
`services`, `service_packages`, `proposals`, `proposal_items`, `proposal_blocks`,
`proposal_versions`, `campaigns`, `campaign_deliverables`, `analytics_snapshots`,
`analytics_metrics`, `media_kits`, `payments`, `commissions`, `ai_classifications`,
`ai_extractions`, `notifications`, `audit_logs`.

Adições recomendadas:
- `integration_credentials` — tokens OAuth criptografados, isolados das tabelas de domínio.
- `webhook_events` — idempotência e auditoria de eventos recebidos de plataformas.
- `ai_classification_feedback` — correções manuais do usuário sobre classificações da IA
  (insumo futuro de aprendizado/personalização).
- `proposal_view_events` — aberturas/visualizações de propostas.
- `commission_rules` — taxa de comissão configurável por organização/creator (nunca 15%
  hardcoded).

Regra não-negociável: toda tabela de domínio carrega `organization_id` com RLS desde a
primeira migration.

## 7. Pendências Registradas (não bloqueiam o início do desenvolvimento)

1. **Integração real Instagram/WhatsApp/TikTok** — pendência principal. `MessagingProvider`
   e `SocialProvider` nascem desenhados como adapters para plugar essas fontes assim que
   aprovadas/viáveis, sem precisar redesenhar o domínio. Até lá, fluxo manual precisa ser
   ergonômico o suficiente para uso diário real pela assessora.
2. Política de retenção de dados pessoais (LGPD) — definir durante a fase de
   Auth/Organizations.
3. Estratégia de OCR para import de prints de conversa — melhoria futura sobre o fluxo
   manual, não bloqueia o MVP (texto colado é suficiente no P0).

## 8. Próximo Passo

Gerar o plano de implementação em fases pequenas e verificáveis (schema → auth/orgs → CRM
core → inbox + IA → pipeline → propostas → media kit → dashboard), via skill
`writing-plans`.
