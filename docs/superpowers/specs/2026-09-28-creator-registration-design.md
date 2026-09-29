# Cadastro de creator (spec A de 3)

**Status:** Aprovado para planejamento (2026-09-28)
**Contexto:** em produção não há como cadastrar creator; sem creator, Inbox e Pipeline ficam inutilizáveis.
O acesso do creator ao app foi decomposto em três specs, nesta ordem:
- **A (esta):** cadastro de creator.
- **B:** papel CREATOR (permissões).
- **C:** convite (vínculo `CREATOR` + link de login).

Esta spec **não** dá acesso ao creator.

## 1. Estado atual

- `creators` (`id`, `organization_id`, `user_id` NOT NULL → `users`, `display_name`, `instagram_handle`, `created_at`).
- `users.email` é único no sistema todo.
- `CreatorService.onboardCreator` cria `users` e `creators` na mesma transação, mas **não** cria `organization_members`. Por isso o usuário do creator não entra no app, mesmo que faça login com aquele e-mail: `resolveSessionForAuthUser` exige vínculo com a organização.
- `GET /api/creators` só lista.
- O seletor do header (`CreatorSwitcher`) recebe a lista do layout (renderizado no servidor, via `CreatorProvider`). Sem creators, mostra "Nenhum creator cadastrado".
- A sidebar não tem item para creators.

## 2. Escopo

**Em escopo:**
- tela `/creators` com lista, criar e editar;
- `POST /api/creators` e `PATCH /api/creators/[id]`;
- reaproveitar o usuário quando o e-mail já existe;
- permissão por papel (OWNER e MANAGER);
- item na sidebar e atalho no seletor vazio.

**Fora de escopo:**
- excluir ou arquivar creator;
- editar o e-mail;
- rate cards e serviços por creator;
- dar acesso ao creator, que fica para as specs B e C.

## 3. Regras

**Campos do formulário** (validação no servidor com zod e mensagens em português):

| Campo | Regras | Mensagem de erro |
|---|---|---|
| Nome completo (`fullName`) | trim, obrigatório, até 120 | "Informe o nome completo." / "Use no máximo 120 caracteres." |
| Nome de exibição (`displayName`) | trim, obrigatório, até 80 | "Informe o nome de exibição." / "Use no máximo 80 caracteres." |
| @Instagram (`instagramHandle`) | opcional; ver abaixo | "Use só letras, números, ponto e sublinhado (até 30)." |
| E-mail (`email`) | trim, minúsculas, formato de e-mail, até 254 | "Informe um e-mail válido." |

**@Instagram:**
- remove espaços e `@` iniciais;
- depois disso, precisa casar com `^[A-Za-z0-9._]{1,30}$`;
- é gravado como `@<handle>`;
- vazio vira `null`.

**Criar (`POST /api/creators`):**
1. Busca `users` pelo e-mail (já em minúsculas).
2. Se o usuário existe e **já tem creator nesta organização**: 409 `{ "error": "Já existe um creator com este e-mail." }`.
3. Se o usuário existe (sem creator nesta organização): reaproveita o `user_id` sem alterar nada no usuário, nem o nome.
4. Se não existe: cria o usuário com `fullName` e `email`.
5. Cria o creator com `displayName` e `instagramHandle`.

Tudo acontece numa transação no contexto da organização. Resposta 201 com o creator.

Se duas criações simultâneas usarem o mesmo e-mail novo, a violação de unicidade (`23505`) vira o mesmo 409.

**Editar (`PATCH /api/creators/[id]`):**
- altera só `displayName` e `instagramHandle`, com as mesmas regras de validação;
- o e-mail não é editável: se vier no corpo, é ignorado;
- creator inexistente ou de outra organização: 404 `{ error: new CreatorNotFoundError(id).message }`;
- `id` malformado: o mesmo 404, pelo guard `isUuid`;
- resposta 200 com o creator atualizado.

**Permissão:**
- só `session.role` OWNER ou MANAGER podem criar e editar;
- CREATOR recebe 403 `{ "error": "Sem permissão." }`;
- ordem de checagem: sessão (401) → UUID (404, no PATCH) → papel (403) → corpo.

**Listagem:**
- `GET /api/creators` passa a devolver também o e-mail do usuário (`email`), para a tela;
- ordem alfabética por `displayName`;
- o seletor continua usando só `id` e `displayName`.

**Validação:** um 400 devolve `{ errors: { campo: [mensagens] } }`, igual ao formulário público de resposta.

## 4. Telas

**Sidebar:** novo item "Creators" (`/creators`, ícone `Users`) entre "Pipeline" e "Proposals".

**Página `/creators`:**
- título "Creators" e botão **Novo creator**;
- tabela com as colunas Nome de exibição, @Instagram, E-mail e Cadastrado em;
- cada linha tem o botão **Editar**;
- sem creators: o estado vazio "Nenhum creator cadastrado" com o botão **Novo creator**.

**Diálogo de criar e editar:**
- os quatro campos da seção 3;
- ao criar, "Nome de exibição" é pré-preenchido com o nome completo enquanto o usuário não o tiver editado;
- ao editar, "E-mail" aparece desabilitado;
- erros por campo aparecem embaixo de cada campo (`aria-invalid` e `aria-describedby`); o 409 aparece sob o campo E-mail;
- botões: "Cadastrar" ao criar e "Salvar" ao editar;
- ao salvar com sucesso:
  1. fecha o diálogo;
  2. mostra `toast.success("Creator cadastrado.")` ou `"Creator atualizado."`;
  3. atualiza a lista;
  4. roda `router.refresh()` para o seletor do header receber a lista nova;
  5. ao criar, se nenhum creator estava selecionado, seleciona o novo (`selectCreator`).

**Seletor vazio:** "Nenhum creator cadastrado" vira um link **Cadastrar creator** para `/creators`.

## 5. Testes

- **Serviço:**
  - cria usuário e creator;
  - reaproveita o usuário existente sem mudar o nome dele;
  - dá 409 para e-mail já com creator na organização;
  - trata a corrida (`23505`) como 409;
  - o PATCH altera só os campos permitidos;
  - não enxerga creator de outra organização.
- **Validação do @Instagram:** normaliza `" @Thais.Rocha "` para `@Thais.Rocha`; rejeita `thais rocha` e 31 caracteres; vazio vira `null`.
- **Rotas:**
  - 401 sem sessão;
  - 403 para CREATOR;
  - 201 e 400 com erros por campo;
  - 409;
  - PATCH 200, 404 (outra organização ou id malformado) e e-mail ignorado;
  - GET inclui `email` e vem ordenado.
- **Tela:**
  - lista e estado vazio;
  - criar (pré-preenchimento do nome de exibição, toast, refresh, seleção);
  - editar com e-mail desabilitado;
  - 409 sob o E-mail.
- **Seletor:** o link "Cadastrar creator" aparece quando não há creators.
- **Sidebar:** o item "Creators" aparece.

## 6. Deploy

Sem migration. Depois do push, o creator de teste para produção pode ser criado pela própria tela.
