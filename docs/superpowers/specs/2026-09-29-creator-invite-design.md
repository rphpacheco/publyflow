# Convite do creator — acesso ao app (spec C de A→B→C→D)

**Status:** Aprovado para planejamento (2026-09-29)
**Sequência:**
- A (feita): cadastro.
- B (feita): permissões do papel CREATOR.
- **C (esta):** dar e revogar o acesso do creator e permitir que ele entre.
- D: aprovação do creator antes do envio.

## 1. Estado atual

- **Login:** existem só dois métodos, Google e e-mail com senha. Não há cadastro nem link mágico. Contas com senha só existem via script de provisionamento (service role, que não pode ir para o app).
- **Vínculo automático:** `resolveSessionForAuthUser` vincula o usuário de autenticação a um `users` sem `auth_user_id` pelo **e-mail verificado** e exige um vínculo (`organization_members`). Um CREATOR precisa ainda de um registro de creator na organização (spec B).
- **Onde a sessão é criada:** no login com senha (`src/app/(auth)/login/actions.ts`) e no `/auth/callback`, que troca o `code` pela sessão para o Google e serve igualmente para o link mágico (fluxo PKCE).
- **Creators da spec A:** têm um `users` sem `auth_user_id` e **nenhum** vínculo. O e-mail não é editável e não existe exclusão.
- **Organização da sessão:** `findOldestMembershipForUser` escolhe a organização mais antiga do usuário.

## 2. Decisões

- **Login do creator:** Google **ou** link mágico, sempre com o mesmo e-mail cadastrado no creator. O link mágico passa a valer para todos os usuários, não só para creators.
- **Convite sem token:** "convidar" cria na hora o vínculo CREATOR. Só entra quem controla aquele e-mail, e os dois métodos entregam o e-mail verificado.
- **Revogação imediata:** a sessão é resolvida a cada requisição, então remover o vínculo corta o acesso na próxima requisição.
- **Um usuário, uma organização (por enquanto):** o convite é recusado se o e-mail já tem vínculo em **outra** organização. Trocar de organização fica fora de escopo.
  > **Restrição temporária:** esta validação existe só porque hoje a sessão resolve uma única organização por usuário (`findOldestMembershipForUser`). Ela **deve ser removida** quando houver suporte a várias organizações por usuário e seleção de organização na sessão. O mesmo vale para a regra equivalente na correção de e-mail (§5.5).
- **Fonte de verdade do acesso:** `first_login_at` é a referência oficial de que o creator já entrou no app. O status `active` deriva só de `first_login_at IS NOT NULL`. `users.auth_user_id` indica que a identidade foi vinculada, mas não é usado sozinho para concluir que houve acesso.
- **E-mail corrigível antes do primeiro acesso.**
- **Datas de acesso** guardadas no vínculo: `first_login_at` e `last_login_at`.
- **O app não envia e-mail.** O link mágico é enviado pelo Supabase. A mensagem do convite é copiada ou enviada pela própria assessoria.

## 3. Dados — migration 0020

```sql
alter table organization_members add column first_login_at timestamptz;
alter table organization_members add column last_login_at timestamptz;
```

Status de acesso de um creator na organização:

| `access` | Quando |
|---|---|
| `none` | sem vínculo nesta organização |
| `invited` | vínculo CREATOR e `first_login_at` nulo |
| `active` | vínculo CREATOR e `first_login_at` preenchido |
| `team` | vínculo OWNER ou MANAGER nesta organização |

## 4. Login

### 4.1 Link mágico
- **Server action `sendMagicLink(formData)`** em `src/app/(auth)/login/actions.ts`:
  1. valida o e-mail;
  2. aplica **dois** rate limits, ambos com `checkRateLimit` da spec de rate limit, e os dois precisam permitir:
     - **5 a cada 600 s por IP** (`scope: "magic-link:ip"`, identificador = `clientIp`);
     - **5 a cada 600 s por e-mail** (`scope: "magic-link:email"`, identificador = e-mail normalizado em minúsculas, também guardado só como hash);
     - os dois contadores são incrementados a cada pedido, e basta um estourar para recusar;
  3. chama `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: \`${origin}/auth/callback\`, shouldCreateUser: true } })`.
- **Resposta:** sempre `{ sent: true }`, exista conta ou não e mesmo se o Supabase recusar, com exceção do limite local. Com o limite estourado: `{ error: "Muitas tentativas. Tente novamente em alguns minutos." }`. Uma falha do Supabase vai para o log, sem PII: só o código do erro.
- **Tela de login:** novo bloco "Entrar com link por e-mail", com o campo E-mail e o botão "Enviar link". Depois de enviar, a mensagem é "Se houver acesso para este e-mail, enviamos um link. Confira sua caixa de entrada."
- O link volta ao `/auth/callback` atual, sem mudança de fluxo.

### 4.2 Registro de acesso
- **`OrganizationMembersRepository.recordLogin(db, organizationId, userId, now)`:** `first_login_at = coalesce(first_login_at, now)` e `last_login_at = now` no vínculo daquela organização e usuário.
- É chamado **só** onde o login acontece, depois de a sessão ser resolvida com sucesso:
  - `loginWithPassword`;
  - `/auth/callback`.
- Não é chamado a cada requisição.

## 5. Acesso do creator — API (OWNER e MANAGER; CREATOR recebe 403)

### 5.1 `POST /api/creators/[id]/access` — convidar
Ordem: sessão → `isUuid` → papel (`canManageOrganization`) → creator da organização (404 se não for).

Regras sobre o `users` do creator:
- tem vínculo em **outra** organização: **409** `{ "error": "Este e-mail já tem acesso a outra organização." }`;
- tem vínculo OWNER ou MANAGER **nesta** organização: **409** `{ "error": "Esta pessoa já faz parte da equipe." }`;
- já tem vínculo CREATOR aqui: segue sem criar outro (idempotente);
- caso contrário: cria o vínculo `{ organization_id, user_id, role: "CREATOR" }`.

Resposta **200** `{ loginUrl, message }` (seção 5.4). Este endpoint é o **único** ponto do app que cria vínculo CREATOR.

### 5.2 `DELETE /api/creators/[id]/access` — revogar
- Remove o vínculo **CREATOR** do usuário do creator nesta organização.
- Vínculos OWNER e MANAGER nunca são removidos aqui: nesse caso, **409** `{ "error": "Esta pessoa já faz parte da equipe." }`.
- Resposta **204**; sem vínculo, também 204 (idempotente).

### 5.3 `POST /api/creators/[id]/access/remind` — reenviar instruções
- Não envia nada. Com vínculo CREATOR, devolve **200** `{ loginUrl, message }`.
- Sem vínculo CREATOR: **409** `{ "error": "Este creator ainda não foi convidado." }`.

### 5.4 Mensagem
- `loginUrl = ${origin}/login`, onde `origin` vem de `new URL(request.url).origin`.
- `message = "Olá, {displayName}! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse {loginUrl} e entre com Google ou com um link enviado para {email}."`

### 5.5 Listagem e edição
- **`GET /api/creators` (OWNER e MANAGER)** acrescenta a cada item:
  - `access: "none" | "invited" | "active" | "team"`;
  - `lastLoginAt: string | null`;
  - `emailEditable: boolean`.

  Para CREATOR, a resposta não muda (spec B).
- **`emailEditable`** é verdadeiro quando, **ao mesmo tempo**:
  - nenhum vínculo do usuário tem `first_login_at` preenchido (nunca entrou, pela fonte de verdade da §2);
  - `users.auth_user_id` é nulo. A identidade de login ainda não está presa a este e-mail, então trocá-lo não quebra um login existente;
  - o usuário não tem vínculo OWNER ou MANAGER em nenhuma organização;
  - o usuário não é creator em outra organização.
- **`PATCH /api/creators/[id]`** passa a aceitar `email` (validação e normalização iguais às do cadastro):
  - se o creator não tem `emailEditable`: **409** `{ "error": "Não é possível alterar o e-mail de quem já acessou o app." }`;
  - se o novo e-mail é o mesmo, normalizado: nada muda;
  - se o novo e-mail pertence a **outro** `users`:
    - esse usuário tem vínculo em outra organização: **409** "Este e-mail já tem acesso a outra organização.";
    - já é creator nesta organização: **409** "Já existe um creator com este e-mail.";
    - caso contrário: **transferência**, descrita abaixo;
  - senão: atualiza `users.email` do usuário do creator.

  Tudo numa transação, com os `users` envolvidos travados (`FOR UPDATE`).

- **Transferência para outro `users`:** uma única transação que:
  1. atualiza `creators.user_id` para o novo usuário;
  2. se existia vínculo CREATOR do usuário antigo nesta organização, **move esse mesmo registro** para o novo usuário (`UPDATE organization_members SET user_id = novo WHERE id = vínculo`);
  3. com isso, o vínculo antigo deixa de existir.

  **Invariante:** em nenhum momento o creator fica associado a dois vínculos CREATOR ao mesmo tempo. Mover o registro existente em vez de inserir um novo e apagar o antigo elimina essa janela. Se qualquer passo falhar, a transação desfaz tudo e o estado original é mantido.

## 6. Interface — `/creators` (OWNER e MANAGER)

- **Novas colunas:**
  - **Acesso:** badge "Sem acesso" / "Convite enviado" / "Ativo" / "Equipe";
  - **Último acesso:** data curta `pt-BR` ou "—".
- **Ações por linha:**
  - `none`: **Convidar**. Abre uma confirmação: "{nome} poderá entrar no PublyFlow e ver as próprias demandas, oportunidades e propostas." Botões "Cancelar" / "Convidar".
  - `invited` e `active`: **Reenviar instruções** e **Revogar acesso**. Revogar pede confirmação: "{nome} perderá o acesso imediatamente."
  - `team`: nenhuma ação de acesso.
- **Diálogo de instruções** (depois de convidar ou reenviar):
  - título "Instruções de acesso";
  - a mensagem numa caixa só de leitura;
  - botões "Copiar mensagem" (toast "Mensagem copiada.") e "E-mail" (`mailto:{email}?subject=Acesso ao PublyFlow&body={message}`, codificado).
- **Toasts:** "Convite criado." / "Acesso revogado."
- **Erros 409:** aparecem com o texto do servidor, em toast de erro.
- **Diálogo de edição:** o campo E-mail fica habilitado quando `emailEditable` é verdadeiro. O 409 aparece embaixo do E-mail.

## 7. Testes

- **Serviço e rotas de acesso:**
  - convidar cria o vínculo, e repetir não duplica;
  - 409 para outra organização;
  - 409 para quem é da equipe;
  - 404 para creator de outra organização;
  - 403 para CREATOR;
  - revogar remove só o vínculo CREATOR, e em seguida `resolveSessionForAuthUser` do creator devolve `null`;
  - `remind` devolve a mensagem, com 409 se não houver convite.
- **Listagem:** `access`, `lastLoginAt` e `emailEditable` corretos em cada cenário (sem acesso, convidado, ativo, equipe, usuário vinculado a outra organização).
- **Correção de e-mail:**
  - `users` sem vínculo: redireciona o creator e transfere o vínculo;
  - **invariante da transferência:** depois de transferir, existe **exatamente um** vínculo CREATOR para o creator nesta organização, no novo usuário, e nenhum no antigo;
  - uma falha forçada no meio da transferência (por exemplo, o update do vínculo lançando erro) deixa o estado **exatamente** como antes: o mesmo `creators.user_id` e o mesmo vínculo;
  - usuário de outra organização: 409;
  - creator já existente: 409;
  - `emailEditable` falso: 409;
  - e-mail novo: atualiza.
- **`recordLogin`:** `first_login_at` só na primeira vez e `last_login_at` sempre, chamado pelo login com senha e pelo callback.
- **Link mágico:** a resposta é sempre `{ sent: true }`; `signInWithOtp` é chamado com `emailRedirectTo` para `/auth/callback` e `shouldCreateUser: true`; o limite por IP dá o erro na sexta tentativa; o limite por e-mail dá o erro na sexta tentativa para o mesmo e-mail vinda de IPs diferentes; um e-mail diferente do mesmo IP continua sujeito ao limite por IP.
- **Interface:** badges e ações por status; a confirmação ao convidar; o diálogo de instruções; o campo E-mail habilitado ou não; o bloco de link mágico no login.
- **Verificação real no navegador (controller + usuário):**
  1. no ambiente local, cadastrar um creator de teste com um e-mail que o usuário recebe (alias `+creator`);
  2. convidar;
  3. o usuário pede o link mágico e abre;
  4. conferir a visão de CREATOR da spec B: sidebar reduzida, telas só de leitura, proposta com compartilhar;
  5. revogar e confirmar que o acesso cai.

## 8. Deploy

1. Migration 0020 aplicada em produção pelo controller antes do push. É aditiva.
2. **Requisito:** SMTP do Supabase configurado com **Resend** (painel do Supabase → Authentication → SMTP). Sem isso, o link mágico em produção fica limitado à cota do envio padrão.
3. Push.

## 9. Fora de escopo

- Trocar de organização; um usuário em várias organizações.
- Convite com token, validade e uso único.
- Envio de e-mail pelo próprio app.
- Excluir ou arquivar creator.
- Usar o nome digitado pela agência (`users.full_name`) em qualquer tela. Ele é considerado não confiável até ser confirmado pela própria pessoa.
