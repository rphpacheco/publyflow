# PublyFlow — Auth v1 (Identidade e Sessão) Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Inbox, Pipeline e Proposal Builder (todos mergeados em `main`).
Blocks: Subprojeto 2 (Onboarding e convites), Subprojeto 3 (Papéis e permissões), Subprojeto 4
(Hardening de RLS).

## 1. Contexto

Hoje toda identidade é um stub de desenvolvimento: `getDevOrganizationId()` e `getDevUserId()`
(`src/lib/organization.ts`) leem `NEXT_PUBLIC_DEV_ORGANIZATION_ID`/`NEXT_PUBLIC_DEV_USER_ID`, e as
29 rotas de API aceitam `organizationId` (e, nas 6 mutações de proposta, `userId`) direto do
cliente, sem verificar quem está chamando. Não existe nenhum código de auth: nenhum pacote
Supabase instalado, nenhum `middleware.ts`/`proxy.ts`, nenhuma página de login, e `users` não tem
coluna ligando a um provedor de autenticação.

A spec do MVP (`2026-09-21-publyflow-mvp-design.md`) já decidiu Supabase Auth, hospedagem
Vercel + Supabase, e que "creator sempre tem conta de login própria". A spec de Proposals
(`2026-09-22-proposals-core-design.md`, decisão #8) já previa que `userId` passaria a vir da
sessão "sem mudança de semântica do campo".

**Divisão em subprojetos** (decidida com o usuário, nesta ordem):
1. **Auth v1 — identidade e sessão** (esta spec).
2. Onboarding e convites: signup cria organização, owner convida managers/creators, reset de
   senha.
3. Papéis e permissões: o que `OWNER`, `MANAGER` e `CREATOR` podem ver e fazer.
4. Hardening de RLS: a aplicação passa a conectar com um usuário sem privilégio de superuser,
   para que as políticas de RLS (já existentes) valham em runtime.

**Fora de escopo desta spec:** tudo dos subprojetos 2, 3 e 4; migrar os dados da aplicação para o
Postgres do Supabase (o banco da aplicação continua o Postgres atual); seletor de organização;
política de retenção LGPD (pendência registrada no MVP).

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Provedor | Supabase Auth, conforme a spec do MVP. Sessão por cookies via `@supabase/ssr`. O Supabase é usado só para autenticação; os dados da aplicação continuam no Postgres atual. |
| 2 | Métodos de login | E-mail + senha **e** Google OAuth. |
| 3 | Ambiente de dev | Um projeto Supabase na nuvem, dedicado a desenvolvimento. O usuário cria o projeto e configura o Google OAuth no dashboard (client id/secret, URL de callback `http://localhost:<porta>/auth/callback`). O `.env.example` documenta os passos. |
| 4 | Provisionamento de contas | Só contas pré-cadastradas. Não há signup nem convite no v1 (subprojeto 2). Contas são criadas por um script (Decisão #12). |
| 5 | Login desconhecido | Um login válido no Supabase (senha ou Google) cujo e-mail não corresponde a um `users` com membership vai para `/sem-acesso`, que encerra a sessão e explica que a conta ainda não tem acesso ao PublyFlow. Nenhuma linha é criada em `users`. |
| 6 | Vínculo com o provedor | `users` ganha a coluna `auth_user_id` (uuid, único, nullable). Nullable porque o vínculo pode ser gravado só no primeiro login (caso típico do Google). |
| 7 | Resolução da sessão | Módulo só de servidor `src/lib/auth/session.ts`. Passos: (1) o cliente `@supabase/ssr` lê o cookie e obtém o usuário autenticado (id e e-mail); (2) busca `users` por `auth_user_id`; se não achar, busca por e-mail; se a linha encontrada por e-mail tiver `auth_user_id` nulo, grava o vínculo; se já estiver vinculada a outro id, a resolução falha (sem acesso); (3) pega a membership mais antiga (`organization_members.created_at` ascendente) do usuário; (4) retorna `{ userId, organizationId, role }`. Sem `users` correspondente ou sem membership, o resultado é "sem acesso". |
| 8 | Helpers de sessão | `getSession(): Promise<Session \| null>` e `requireSession(): Promise<Session>`. `requireSession` lança um erro de domínio (`UnauthenticatedError`) que as rotas convertem em `401`. |
| 9 | Organização ativa | Uma organização por usuário no v1: a membership mais antiga. Usuários com mais de uma membership caem sempre na mais antiga (limitação conhecida). Seletor de organização fica para quando houver um caso real. |
| 10 | Proteção de páginas | `src/proxy.ts` (convenção de middleware do Next 16): renova os cookies de sessão do Supabase a cada request e redireciona páginas sem sessão para `/login`. Não redireciona `/api/*`, `/login`, `/auth/callback` nem `/sem-acesso`. Rotas de API respondem `401` por conta própria via `requireSession()`. |
| 11 | Páginas de auth | `/login`: formulário de e-mail + senha e botão "Entrar com Google". O login por senha acontece no servidor (server action); em caso de sucesso, aplica a mesma resolução da Decisão #7 e redireciona para `/pipeline` ou `/sem-acesso`; credenciais inválidas mostram erro no próprio formulário. `/auth/callback`: troca o código OAuth pela sessão e redireciona para `/pipeline` (ou para `/sem-acesso` se a resolução falhar). `/sem-acesso`: encerra a sessão e mostra a mensagem. O header ganha a ação "Sair", que encerra a sessão e recarrega em `/login`. |
| 12 | Script de provisionamento | `scripts/provision-user.ts`. Recebe e-mail, nome, papel (`OWNER`/`MANAGER`/`CREATOR`), organização (id existente ou nome para criar uma nova) e senha opcional. Usa a API admin do Supabase (`SUPABASE_SERVICE_ROLE_KEY`) para criar o usuário de auth quando houver senha, cria ou reaproveita a linha em `users` casando pelo e-mail, grava `auth_user_id` quando o usuário de auth foi criado, e cria a membership se ainda não existir. Reaproveitar pelo e-mail cobre creators já criados por `CreatorService.onboardCreator`, que cria `users` mas não cria membership. Sem senha, o vínculo é gravado no primeiro login com Google (Decisão #7). |
| 13 | Rotas de API | As 29 rotas removem `organizationId` e `userId` dos schemas Zod de query e body, chamam `requireSession()` no início e passam `session.organizationId`/`session.userId` para os services. Services e repositories não mudam de assinatura. As mutações de proposta continuam chamando `assertMember` com o `userId` da sessão. Não há camada de compatibilidade (não existe consumidor externo da API). |
| 14 | Frontend | Saem `getDevOrganizationId()`, `getDevUserId()` e as variáveis `NEXT_PUBLIC_DEV_ORGANIZATION_ID`/`NEXT_PUBLIC_DEV_USER_ID`. Os hooks param de receber `organizationId`: URLs e bodies ficam sem o campo, e as query keys deixam de incluí-lo (uma organização por sessão; o logout recarrega a página e limpa o cache). O `layout.tsx` (server component) obtém a sessão via `getSession()` e carrega os creators da organização da sessão. O `CreatorProvider` mantém a chave de `localStorage` por organização, com o id vindo da sessão. |
| 15 | Variáveis de ambiente | Entram `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` (usada só pelo script, nunca pelo app). Saem `NEXT_PUBLIC_DEV_ORGANIZATION_ID`, `NEXT_PUBLIC_DEV_USER_ID` e as antigas `SUPABASE_URL`/`SUPABASE_ANON_KEY` do `.env.example` (substituídas pelas versões `NEXT_PUBLIC_`). |
| 16 | Testes | A lógica de resolução (Decisão #7) fica numa função pura em relação ao Supabase, que recebe o usuário autenticado (`{ id, email }`) e o `db`, testada contra o banco de teste real: vínculo por `auth_user_id`, fallback por e-mail com gravação do vínculo, conflito de vínculo, membership mais antiga, sem `users`, sem membership. Os testes de rota mockam o módulo de sessão (fixture de org/usuário, e um caso sem sessão que espera `401`). Nenhum teste automatizado chama o Supabase. |

## 3. Limitações conhecidas do v1

- **Papel não é aplicado.** Um `CREATOR` logado vê e altera tudo da organização, igual a um
  `OWNER`. Como só entra quem foi pré-cadastrado pelo script, o dono controla quem recebe acesso
  até o subprojeto 3.
- **Mais de uma organização:** o usuário sempre cai na membership mais antiga.
- **RLS continua sem efeito em runtime:** a conexão da aplicação segue como superuser até o
  subprojeto 4. O isolamento continua dependendo dos filtros por `organizationId` nos
  repositories, agora com o valor vindo da sessão em vez do cliente.
- **Sem signup, convite ou reset de senha** (subprojeto 2).

## 4. Próximo Passo

Gerar o plano de implementação via `writing-plans`.
