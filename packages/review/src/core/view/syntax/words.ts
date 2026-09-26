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

export const RUBY = words(`
  alias and begin break case class def defined? do else elsif end ensure for if in module next not or
  redo rescue retry return then undef unless until when while yield require require_relative include
  extend attr_reader attr_writer attr_accessor private protected public raise lambda proc
`)

export const RUBY_VALUES = words("true false nil self super __FILE__ __LINE__")

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

/** Terraform, Terragrunt, Nomad and the rest of HCL: blocks and the functions of its expressions. */
export const HCL = words(`
  resource data variable output locals module provider terraform backend required_providers include
  dependency dependencies inputs generate remote_state dynamic content for_each count depends_on
  lifecycle provisioner connection moved import check for in if else endif endfor source version
`)

export const LUA = words(`
  and break do else elseif end for function goto if in local not or repeat return then until while
  require
`)

export const ELIXIR = words(`
  def defp defmodule defmacro defmacrop defstruct defprotocol defimpl defguard do end if else unless
  case cond with fn when import alias require use quote unquote receive try rescue catch after raise
  in not and or
`)

/** Haskell and Elm: the same shapes. */
export const HASKELL = words(`
  module import where let in case of if then else data type newtype class instance deriving do
  qualified as hiding forall exposing port alias
`)

export const NIX = words("let in with inherit rec if then else assert import or")

export const GRAPHQL = words(`
  query mutation subscription fragment on type input enum interface union scalar schema extend
  directive implements repeatable
`)

export const PROTO = words(`
  syntax edition package import option message enum service rpc returns repeated optional required
  oneof map reserved extend stream public weak
`)

export const PERL = words(`
  my our local sub use no package require if elsif else unless foreach for while until last next
  redo return and or not eq ne lt gt le ge cmp do eval
`)

export const R = words(`
  function if else for while repeat break next return library require in
`)

export const JULIA = words(`
  function end if elseif else for while return module baremodule using import export struct mutable
  abstract primitive type begin let do try catch finally macro quote const global local in where
`)

/** Clojure, Emacs Lisp, Scheme, Common Lisp: what their forms usually open with. */
export const LISP = words(`
  def defn defn- defmacro defmulti defmethod defprotocol defrecord deftype defun defvar defparameter
  define lambda fn let let* letfn if when unless cond case do loop recur ns require import quote
`)

/** OCaml and F#. */
export const ML = words(`
  let in match with type module open fun function if then else rec begin end val mutable and or of
  struct sig functor when try raise exception namespace member
`)

export const CMAKE = words(`
  set unset if elseif else endif foreach endforeach while endwhile function endfunction macro endmacro
  return include project add_executable add_library add_subdirectory target_link_libraries
  target_include_directories target_compile_options find_package option message install
`)

export const PRISMA = words("model enum datasource generator type view")

export const BATCH = words(
  "echo set if else goto call exit for in do not exist defined errorlevel setlocal endlocal",
)

export const LUA_VALUES = words("nil true false self")
export const HASKELL_VALUES = words("True False Nothing Just Left Right otherwise")
export const PERL_VALUES = words("undef __PACKAGE__ __FILE__ __LINE__ STDIN STDOUT STDERR")
export const R_VALUES = words("TRUE FALSE NULL NA NaN Inf T F")
export const JULIA_VALUES = words("true false nothing missing Inf NaN")
export const LISP_VALUES = words("nil t true false")
export const ML_VALUES = words("true false None Some unit")
export const CMAKE_VALUES = words("ON OFF TRUE FALSE YES NO AND OR NOT DEFINED")
