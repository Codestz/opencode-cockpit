/**
 * Pairs of commands, each labelled with what a family rule must do with them. Every name here is made
 * up — projects, hosts, buckets, tickets — and stays that way.
 *
 * - `separate`: trusting one as a family must never trust the other. A different environment (dev
 *   and prod), or a read and a write, of the same tool.
 * - `together`: the same thing done to a different file, row or id. Splitting them costs only extra
 *   approvals, but a rule that splits everything makes widening useless.
 */

export interface Pair {
  a: string
  b: string
  want: "separate" | "together"
  /** In a word, why: shown beside a result that gets it wrong. */
  why: string
}

export const PAIRS: readonly Pair[] = [
  /* ─── environments: must be separate ─── */
  {
    a: 'mcpx db-local query "select 1"',
    b: 'mcpx db-prod query "select 1"',
    want: "separate",
    why: "server",
  },
  {
    a: "docker compose -p dev up -d",
    b: "docker compose -p prod up -d",
    want: "separate",
    why: "compose project",
  },
  {
    a: "docker compose --project-name dev logs web",
    b: "docker compose --project-name prod logs web",
    want: "separate",
    why: "compose project",
  },
  {
    a: "docker compose -f docker-compose.dev.yml up",
    b: "docker compose -f docker-compose.prod.yml up",
    want: "separate",
    why: "compose file",
  },
  {
    a: "kubectl --context dev-eu get pods",
    b: "kubectl --context prod-eu get pods",
    want: "separate",
    why: "cluster",
  },
  {
    a: "kubectl get pods -n staging",
    b: "kubectl get pods -n production",
    want: "separate",
    why: "namespace",
  },
  { a: "aws --profile dev s3 ls", b: "aws --profile prod s3 ls", want: "separate", why: "account" },
  {
    a: "gcloud --project acme-dev compute instances list",
    b: "gcloud --project acme-prod compute instances list",
    want: "separate",
    why: "project",
  },
  { a: "helm --kube-context dev list", b: "helm --kube-context prod list", want: "separate", why: "cluster" },
  {
    a: "terraform workspace select dev",
    b: "terraform workspace select prod",
    want: "separate",
    why: "workspace",
  },
  {
    a: "NODE_ENV=development npm run build",
    b: "NODE_ENV=production npm run build",
    want: "separate",
    why: "env var",
  },
  {
    a: 'psql -h localhost -c "select 1"',
    b: 'psql -h db.prod.acme.internal -c "select 1"',
    want: "separate",
    why: "database host",
  },
  { a: "ssh dev-box uptime", b: "ssh prod-box uptime", want: "separate", why: "host" },
  {
    a: "curl https://api.dev.acme.test/health",
    b: "curl https://api.acme.test/health",
    want: "separate",
    why: "url",
  },
  { a: "vercel deploy", b: "vercel deploy --prod", want: "separate", why: "flag" },
  { a: "fly deploy -a acme-staging", b: "fly deploy -a acme-prod", want: "separate", why: "app" },
  { a: "acmectl env use staging", b: "acmectl env use production", want: "separate", why: "unknown cli" },
  { a: "make deploy-dev", b: "make deploy-prod", want: "separate", why: "target" },

  /* ─── targets with no environment word in them: must be separate (held out: no rule was tuned on these) ─── */
  {
    a: "kubectl --context cluster-a get pods",
    b: "kubectl --context cluster-b get pods",
    want: "separate",
    why: "cluster, unnamed",
  },
  {
    a: "aws --profile acme s3 ls",
    b: "aws --profile acme-admin s3 ls",
    want: "separate",
    why: "account, unnamed",
  },
  {
    a: 'psql -h db1.internal -c "select 1"',
    b: 'psql -h db2.internal -c "select 1"',
    want: "separate",
    why: "host, unnamed",
  },
  {
    a: 'mcpx orders-db query "select 1"',
    b: 'mcpx billing-db query "select 1"',
    want: "separate",
    why: "server, unnamed",
  },
  {
    a: "docker compose -p shop up -d",
    b: "docker compose -p shop-blue up -d",
    want: "separate",
    why: "project, unnamed",
  },

  /* ─── read vs write of one tool: must be separate ─── */
  {
    a: 'mcpx db-local query "select 1"',
    b: 'mcpx db-local exec "drop table orders"',
    want: "separate",
    why: "read vs write",
  },
  { a: "kubectl get pods", b: "kubectl delete pods web-0", want: "separate", why: "read vs write" },
  { a: "aws s3 ls", b: "aws s3 rm s3://acme-assets/x.png", want: "separate", why: "read vs write" },
  { a: "terraform plan", b: "terraform apply", want: "separate", why: "read vs write" },
  { a: "npm run test", b: "npm run deploy", want: "separate", why: "script" },
  { a: "gh pr view 482", b: "gh pr merge 482", want: "separate", why: "read vs write" },
  { a: "acmectl orders list", b: "acmectl orders refund 1042", want: "separate", why: "unknown cli" },
  /* added after the first results: a flag between the tool and its subcommand */
  {
    a: "docker compose -p dev up -d",
    b: "docker compose -p dev down",
    want: "separate",
    why: "up vs down, added",
  },
  {
    a: "kubectl --context cluster-a get pods",
    b: "kubectl --context cluster-a delete pods web-0",
    want: "separate",
    why: "read vs write, added",
  },

  /* ─── the same thing, another argument: fine together ─── */
  { a: "tail -4 ~/logs/app.log", b: "tail -10 ~/logs/app.log", want: "together", why: "lines" },
  { a: "cat package.json", b: "cat README.md", want: "together", why: "file" },
  { a: "ls -la src", b: "ls -la docs", want: "together", why: "folder" },
  { a: "grep -rn TODO src", b: "grep -rn FIXME packages", want: "together", why: "pattern" },
  { a: "git status --short", b: "git status", want: "together", why: "flags" },
  { a: "git log --oneline -20", b: "git log --stat -3", want: "together", why: "flags" },
  { a: "jq '.name' package.json", b: "jq '.scripts' package.json", want: "together", why: "filter" },
  { a: "sed -n 1,40p src/a.ts", b: "sed -n 1,80p src/b.ts", want: "together", why: "range" },
  { a: "head -40 README.md", b: "head -5 CHANGELOG.md", want: "together", why: "file" },
  { a: "wc -l src/a.ts", b: "wc -l src/b.ts", want: "together", why: "file" },
  {
    a: 'mcpx db-local query "select 1"',
    b: 'mcpx db-local query "select count(*) from orders"',
    want: "together",
    why: "sql",
  },
  { a: "gh pr view 482", b: "gh pr view 519 --json url", want: "together", why: "pr number" },
  {
    a: "docker compose -p dev logs web",
    b: "docker compose -p dev logs api",
    want: "together",
    why: "service",
  },
  {
    a: "kubectl --context dev-eu get pods",
    b: "kubectl --context dev-eu get pods -o wide",
    want: "together",
    why: "output",
  },
  { a: "echo done", b: "echo ok", want: "together", why: "text" },
  { a: 'find . -name "*.md"', b: "find src -type f", want: "together", why: "query" },
  { a: "npm run test", b: "npm run test -- --watch", want: "together", why: "flags" },
  { a: "bun test", b: "bun test src/a.test.ts", want: "together", why: "file" },
  {
    a: "curl https://api.dev.acme.test/health",
    b: "curl https://api.dev.acme.test/version",
    want: "together",
    why: "same host",
  },
  { a: "rg TODO", b: "rg FIXME src", want: "together", why: "pattern" },
  { a: "acmectl orders list", b: "acmectl orders list --status open", want: "together", why: "unknown cli" },
  { a: "python scripts/a.py", b: "python scripts/b.py", want: "together", why: "script file" },
  /* held out: flags whose values change and do not matter */
  { a: "kubectl get pods -o wide", b: "kubectl get pods -o yaml", want: "together", why: "output, held out" },
  { a: "git log -n 5", b: "git log -n 20", want: "together", why: "count, held out" },
  {
    a: "docker compose logs --tail 50 web",
    b: "docker compose logs --tail 200 web",
    want: "together",
    why: "count, held out",
  },
  { a: "gh pr list --state open", b: "gh pr list --state closed", want: "together", why: "filter, held out" },
  /* held out: short flags that mean something else here */
  {
    a: "grep -c error build.log",
    b: "grep -c warn build.log",
    want: "together",
    why: "-c is count, held out",
  },
  { a: "ls -a src", b: "ls -a docs", want: "together", why: "-a is all, held out" },
  { a: "head -n 40 README.md", b: "head -n 5 CHANGELOG.md", want: "together", why: "-n is lines, held out" },
]

/** Every command in the corpus, for a strategy that learns from what it has seen (D). */
export const CORPUS_COMMANDS: readonly string[] = [...new Set(PAIRS.flatMap((pair) => [pair.a, pair.b]))]
