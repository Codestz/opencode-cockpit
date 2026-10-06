/** Environment words: shared by families (family.ts) and masks (secret.ts), which must agree on them. */

/**
 * Words that name an environment, as a whole word or a part of one: `db-prod`, `acme-staging`,
 * `api.dev.acme.test`. `test` and `testing` count only in a flag's value: in an argument they are
 * mostly a file name (`a.test.ts`).
 */
export const ENV = new Set([
  "prod",
  "production",
  "prd",
  "live",
  "staging",
  "stage",
  "stg",
  "preprod",
  "dev",
  "develop",
  "development",
  "local",
  "localhost",
  "qa",
  "uat",
  "sandbox",
  "test",
  "testing",
])
export const envWords = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => ENV.has(word))
