/**
 * The words each language reserves for itself.
 *
 * Kept apart from the language table so that table stays readable as a table. A missing word costs one
 * run of colour and nothing else, so these are the common ones rather than the complete ones — being
 * exhaustive is what a real grammar is for, and that is the tree-sitter or Shiki upgrade, not this.
 */

const words = (list: string) => new Set(list.trim().split(/\s+/))

export const JS = words(`
  abstract as async await break case catch class const continue declare default delete do else enum
  export extends finally for from function get if implements import in infer instanceof interface is
  keyof let namespace new of override private protected public readonly return satisfies set static
  super switch this throw try type typeof var void while with yield
`)

export const JS_VALUES = words("true false null undefined NaN Infinity")

export const JSON_VALUES = words("true false null")

export const SHELL = words(`
  case do done elif else esac export fi for function if in local readonly return select shift then
  time until while alias source unset eval exec trap set
  FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD HEALTHCHECK SHELL
`)

export const PYTHON = words(`
  and as assert async await break class continue def del elif else except finally for from global if
  import in is lambda match nonlocal not or pass raise return try while with yield
`)

export const PYTHON_VALUES = words("True False None self cls")

export const GO = words(`
  break case chan const continue default defer else fallthrough for func go goto if import interface
  map package range return select struct switch type var
`)

export const GO_VALUES = words("true false nil iota")

export const RUST = words(`
  as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod
  move mut pub ref return self static struct super trait type unsafe use where while
`)

export const RUST_VALUES = words("true false None Some Ok Err")

/** C, C++, Java, C#, Kotlin, Swift — near enough the same words for the purpose of colouring a diff. */
export const CURLY = words(`
  abstract as assert auto bool break case catch char class const constexpr continue default defer
  delete do double else enum explicit extends extern false final finally float for friend func fun goto
  if implements import inline instanceof int interface internal let long namespace new operator
  override package private protected public register return short sizeof static struct super switch
  synchronized template this throw throws try typedef typename union unsigned using val var virtual
  void volatile where while
`)

export const CURLY_VALUES = words("true false null nil nullptr NULL this self")

export const SQL = words(`
  ALTER AND AS ASC BEGIN BY CASE COMMIT CONSTRAINT CREATE DEFAULT DELETE DESC DISTINCT DROP ELSE END
  EXISTS FOREIGN FROM GROUP HAVING IF IN INDEX INNER INSERT INTO JOIN KEY LEFT LIMIT NOT NULL ON OR
  ORDER OUTER PRIMARY REFERENCES RETURNING RIGHT ROLLBACK SELECT SET TABLE THEN TRANSACTION UNION
  UNIQUE UPDATE USING VALUES VIEW WHEN WHERE WITH
`)

export const CSS = words(`
  and important media supports keyframes import charset font-face not only from to
`)
