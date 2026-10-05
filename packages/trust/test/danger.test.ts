import { describe, expect, test } from "bun:test"
import { dangerOf } from "../src/core/danger.ts"
import { parse } from "../src/core/shell.ts"

/** The reason the one command on `line` is dangerous, or undefined. */
function reason(line: string): string | undefined {
  const parsed = parse(line)
  if (parsed.kind === "opaque") throw new Error(`opaque: ${line}`)
  const [command] = parsed.commands
  if (!command) throw new Error(`no command: ${line}`)
  return dangerOf(command)
}

function table(cases: Record<string, string | undefined>) {
  for (const [line, expected] of Object.entries(cases)) test(line, () => expect(reason(line)).toBe(expected))
}

describe("programs that are dangerous whatever their arguments", () => {
  table({
    "rm file.txt": "rm",
    "rm -rf build": "rm",
    "/bin/rm -f x": "rm",
    "rmdir empty": "rmdir",
    "dd if=/dev/zero of=disk.img": "dd",
    "mkfs.ext4 /dev/sdb1": "mkfs.ext4",
    "mkfs -t ext4 /dev/sdb1": "mkfs",
    "kill 123": "kill",
    "killall node": "killall",
    "pkill -f vite": "pkill",
    "truncate -s 0 app.log": "truncate",
    "shred secrets.txt": "shred",
  })
})

describe("recursive permission changes, and only those", () => {
  table({
    "chmod -R 777 .": "chmod -R",
    "chmod --recursive u+w src": "chmod -R",
    "chown -R me:staff .": "chown -R",
    "chmod +x script.sh": undefined,
    "chown me file": undefined,
  })
})

describe("git", () => {
  table({
    "git push": "git push",
    "git push origin main": "git push",
    "git -C /tmp/repo push": "git push",
    "git -c user.name=x push": "git push",
    "git reset --hard HEAD~1": "git reset --hard",
    "git reset HEAD file": undefined,
    "git clean -fd": "git clean",
    "git checkout -- src/a.ts": "git checkout over files",
    "git checkout .": "git checkout over files",
    "git checkout -f main": "git checkout over files",
    "git checkout main": undefined,
    "git checkout -b feature": undefined,
    "git restore src/a.ts": "git restore",
    "git restore --staged src/a.ts": undefined,
    "git restore --staged --worktree src/a.ts": "git restore",
    "git branch -D old": "git branch -D",
    "git branch -d merged": undefined,
    "git branch --delete --force old": "git branch -D",
    "git stash drop": "git stash drop",
    "git stash": undefined,
    "git status": undefined,
    "git log --grep push": undefined,
    "git commit -m 'push the fix'": undefined,
    "git diff --stat": undefined,
  })
})

describe("--force is dangerous anywhere; -f is not", () => {
  table({
    "cp --force a b": "--force",
    "helm upgrade app ./chart --force": "--force",
    "git push --force-with-lease": "git push",
    "npm install --force": "--force",
    "tail -f app.log": undefined,
    "grep -f patterns.txt src": undefined,
    "docker compose -f docker-compose.yml up": undefined,
    "rm --no-preserve-root -rf /": "rm",
  })
})

describe("containers", () => {
  table({
    "docker rm web": "rm",
    "docker rmi node:20": "rmi",
    "docker -H tcp://x rm web": "rm",
    "docker system prune -af": "system prune",
    "docker volume prune": "volume prune",
    "docker container rm web": "container rm",
    "docker image rm node": "image rm",
    "docker compose -p cockpit up -d": undefined,
    "docker compose -p prod down -v": "compose down -v",
    "docker compose down --volumes": "compose down -v",
    "docker compose down": undefined,
    "docker compose -f a.yml -p rm up": undefined,
    "docker-compose down -v": "compose down -v",
    "podman rmi x": "rmi",
    "docker ps -a": undefined,
    "docker logs -f web": undefined,
  })
})

describe("clusters, clouds and infrastructure", () => {
  table({
    "kubectl delete pod x": "kubectl delete",
    "kubectl -n prod delete pod x": "kubectl delete",
    "kubectl --context prod drain node-1": "kubectl drain",
    /** Reading production is still production: it costs the higher count, and no widening covers it. */
    "kubectl -n prod get pods": "production",
    "kubectl -n staging get pods": undefined,
    "terraform destroy": "terraform destroy",
    "terraform apply -auto-approve": "terraform apply",
    "terraform -chdir=infra apply": "terraform apply",
    "terraform plan": undefined,
    "terraform state rm aws_s3_bucket.x": "terraform state rm",
    "helm uninstall app": "helm uninstall",
    "aws s3 rm s3://bucket/key": "aws s3 rm",
    "aws --profile prod ec2 terminate-instances --instance-ids i-1": "aws terminate-instances",
    "aws s3 ls": undefined,
    "gh repo delete me/x": "gh … delete",
    "gh pr list": undefined,
  })
})

describe("databases", () => {
  table({
    "psql -c 'DROP TABLE users'": "drop",
    "psql -d app -c 'truncate events'": "truncate",
    "mysql -e 'delete from users where 1'": "delete",
    "sqlite3 app.db 'drop table x'": "drop",
    "psql -c 'select * from drop_log'": undefined,
    "psql -d dropbox": undefined,
    "redis-cli FLUSHALL": "flushall",
  })
})

describe("publishing", () => {
  table({
    "npm publish": "publish",
    "npm publish --access public": "publish",
    "bun publish": "publish",
    "pnpm publish": "publish",
    "yarn npm publish": "publish",
    "npm unpublish x@1.0.0": "unpublish",
    "npm run publish": undefined,
    "npm install": undefined,
    "cargo publish": "cargo publish",
  })
})

describe("wrappers are judged by what they run", () => {
  table({
    "sudo ls": "sudo",
    "sudo rm -rf /var/x": "sudo rm",
    "sudo -u postgres psql": "sudo",
    "env FOO=1 rm x": "rm",
    "env -u HOME git push": "git push",
    "time git push": "git push",
    "nohup rm -rf x": "rm",
    "timeout 5 rm x": "rm",
    "timeout -s KILL 5 git push": "git push",
    "nice -n 10 rm x": "rm",
    "xargs rm": "rm",
    "xargs -I {} rm {}": "rm",
    "time ls": undefined,
    "env FOO=1 bun test": undefined,
    "timeout 30 bun test": undefined,
  })
})

describe("find", () => {
  table({
    "find . -name '*.tmp' -delete": "find -delete",
    "find . -name '*.tmp' -exec rm {} ;": "find -exec rm",
    "find . -name '*.ts' -exec grep -l x {} +": undefined,
    "find . -name '*.ts'": undefined,
  })
})

describe("everyday commands stay ordinary", () => {
  table({
    ls: undefined,
    "ls -la": undefined,
    "bun test": undefined,
    "bun run build": undefined,
    "cat package.json": undefined,
    "mkdir -p build": undefined,
    "mv a b": undefined,
    "echo rm": undefined,
    "rsync -a src/ dst/": undefined,
    "rsync -a --delete src/ dst/": "rsync --delete",
  })
})

test("environment prefixes do not hide a dangerous program", () => {
  expect(reason("NODE_ENV=production npm publish")).toBe("publish")
})

describe("production, wherever it is named", () => {
  table({
    'mcpx db-prod execute_sql --sql "select 1"': "production",
    "docker compose -p prod up -d": "production",
    "aws --profile production s3 ls": "production",
    "ssh -p 2222 prod-box uptime": "production",
    "mcpx db-local list_tables": undefined,
    "ls products": undefined,
    "git log --oneline": undefined,
  })

  test("an env var that names it", () => {
    expect(dangerOf({ env: ["NODE_ENV=production"], argv: ["npm", "run", "build"] })).toBe("production")
    expect(dangerOf({ env: ["NODE_ENV=development"], argv: ["npm", "run", "build"] })).toBeUndefined()
  })
})

describe("SQL that writes, in any program's argument", () => {
  table({
    'mcpx db-local execute_sql --sql "delete from orders where id = 4"': "sql delete",
    'mcpx db-local execute_sql --sql "update orders set paid = true"': "sql update",
    'mcpx db-local execute_sql --sql "insert into orders values (1)"': "sql insert",
    'mcpx db-local execute_sql --sql "select 1; drop table orders"': "sql drop",
    'mcpx db-local execute_sql --sql "select * from orders"': undefined,
    /** Not SQL: one word, or words that only start like it. */
    'git commit -m "update readme"': undefined,
    "acmectl drop cache": undefined,
  })
})
