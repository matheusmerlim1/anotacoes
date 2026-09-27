🔗 **Site:** https://matheusmerlim1.github.io/anotacoes/

# 📝 Anotações

Bloco de notas no estilo **dontpad**, hospedado no **GitHub Pages**. Cada anotação tem um endereço próprio e é salva automaticamente como um arquivo `.md` em um repositório do GitHub, com histórico de todas as versões.

```
https://SEU-USUARIO.github.io/anotacoes/#/faculdade/calculo
https://SEU-USUARIO.github.io/anotacoes/faculdade/calculo      ← também funciona
```

## Como funciona

| Onde | O quê |
|------|-------|
| Repositório **`anotacoes`** (público) | O site: `index.html`, `app.js`, `styles.css`, `404.html`. Publicado pelo GitHub Pages. |
| Repositório **`anotacoes-dados`** (privado) | As anotações 🔒 **só eu vejo**, em `notas/<nome>.md`. Cada salvamento é um commit. |
| Repositório **`anotacoes-publicas`** (público, opcional) | As anotações 🌐 **qualquer um vê**, no mesmo formato. Os visitantes do site leem daqui, sem token. |

O site conversa direto com a API do GitHub usando um token que fica guardado **só no seu navegador**. Sem token, o site funciona em **modo local** (anotações só naquele navegador). Quando você conectar depois, ele oferece enviar essas notas para o GitHub.

## Recursos

- **Quem pode ver**: cada página tem um botão **🔒 Só eu vejo / 🌐 Qualquer um vê**. Toda página nova começa como *só eu*. Ao trocar, o arquivo é movido de um repositório para o outro.
  - Quem abre o site **sem token** vê só as páginas públicas, em modo *somente leitura*, e pode criar as próprias anotações locais.
  - Uma página que já foi pública continua no **histórico** do repositório público, mesmo depois de voltar a ser privada.

- **Endereço por anotação**: `#/nome`, com pastas (`#/faculdade/calculo`, `#/sites/ler-depois`). Acentos e espaços são normalizados (`Cálculo I` → `calculo-i`).
- **Salvamento automático** 1,2 s depois de parar de digitar (ou `Ctrl+S`).
- **Rascunho local**: se a internet cair ou a aba fechar antes de salvar, o texto é retomado na próxima vez.
- **Conflitos**: se a mesma página for editada em dois aparelhos, o site avisa e deixa você escolher qual versão manter.
- **Sincronização**: ao voltar para a aba, a página é atualizada se foi alterada em outro aparelho.
- **Modo leitura** (`Ctrl+E`): links `https://…`, `www.…` e `#/outra-pagina` ficam clicáveis.
- **Lista e busca**: todas as páginas, filtro por nome e busca no conteúdo com trecho destacado.
- **Subpáginas**: ao abrir `faculdade`, aparecem `faculdade/calculo`, `faculdade/fisica`…
- **Recentes**, **copiar link** e **excluir** (o conteúdo continua no histórico do Git).
- Tema claro/escuro automático e layout para celular.

## Instalação

### 1. Repositório do site (público)

```bash
cd "16 - Anotações"
git init -b main
git add .
git commit -m "Anotações: primeira versão"
git remote add origin https://github.com/SEU-USUARIO/anotacoes.git
git push -u origin main
```

No GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.

### 2. Repositório dos dados (privado)

Crie `anotacoes-dados` como **privado** e marque **Add a README** (o repositório precisa ter pelo menos um commit).

Para ter páginas públicas, crie também `anotacoes-publicas` como **público**, do mesmo jeito (com README). Sem ele, todas as páginas ficam privadas.

### 3. Token

1. https://github.com/settings/personal-access-tokens/new (token *fine-grained*)
2. **Repository access → Only select repositories →** `anotacoes-dados` e `anotacoes-publicas`
3. **Permissions → Repository permissions → Contents: Read and write**
4. Gere e copie o token.

### 4. Conectar

Abra o site, clique em **⚙** e preencha usuário, `anotacoes-dados`, `anotacoes-publicas` (ou deixe vazio), branch `main` e o token. Repita isso uma vez em cada aparelho (computador, celular…).

> **Segurança:** o token fica no `localStorage` do navegador. Use um token *fine-grained* limitado ao repositório de dados. Assim, mesmo que ele vaze, só dá acesso às anotações. Não configure o token em computadores públicos. Se precisar, clique em **⚙ → Usar só neste navegador** para removê-lo.

## Testar localmente

```bash
python -m http.server 8000
# abra http://localhost:8000
```

Endereços sem `#` (`/anotacoes/faculdade`) só funcionam no GitHub Pages, via `404.html`. Localmente, use `#/faculdade`.

Se usar domínio próprio ou o repositório `SEU-USUARIO.github.io`, mude `segmentosBase` para `0` no `404.html`.

## Estrutura

```
index.html   telas (início, anotação, configurações)
styles.css   visual (claro/escuro, responsivo)
app.js       rotas, editor, salvamento, API do GitHub, modo local
404.html     transforma /anotacoes/x/y em /anotacoes/#/x/y
.nojekyll    faz o GitHub Pages servir os arquivos como estão
```
