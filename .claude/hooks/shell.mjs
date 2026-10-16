// Just enough shell parsing to find the git commands in a Bash tool call, the directory each one runs in, and the
// paths the commands before a commit may write. Not a shell: no expansion beyond `~`, no aliases, no functions.
// Unparseable input yields fewer commands, never a crash; what cannot be known is reported as unknown.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OPERATORS = ["&&", "||", ";;", "$(", ";", "&", "|", "(", ")", "\n", "`"];
const SEGMENT_WORDS = new Set(["{", "}", "!", "then", "do", "else", "elif", "if", "while", "until", "fi", "done"]);
const PREFIX_WORDS = new Set(["time", "command", "builtin", "exec", "nohup", "nice", "env", "sudo", "xargs"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DYNAMIC = /[$`]/;

/**
 * Splits a command line into simple commands (arrays of words), respecting quotes. Each command array carries
 * `targets`: the files its output redirections (`>`, `>>`, `&>`, `>|`) write. Input redirections, here-strings and
 * heredoc bodies are dropped. With `groups`, a subshell or command substitution adds an empty array with
 * `group: "open"` or `"close"`, so a `cd` inside it can be scoped.
 */
export function splitCommands(line, { groups = false } = {}) {
  const commands = [];
  let words = [];
  let targets = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  // What the next word is: an argument, an output target, a word to drop, or a heredoc delimiter.
  let next = "arg";
  const heredocs = [];
  const endWord = () => {
    if (inWord) {
      if (next === "heredoc") heredocs.push(word);
      else if (next === "target") targets.push(word);
      else if (next === "drop") {
        // nothing
      } else if (!quoted && SEGMENT_WORDS.has(word)) endCommand();
      else words.push(word);
      next = "arg";
    }
    word = "";
    inWord = false;
    quoted = false;
  };
  const endCommand = () => {
    if (words.length > 0 || targets.length > 0) commands.push(Object.assign(words, { targets }));
    words = [];
    targets = [];
  };
  const mark = (group) => {
    if (groups) commands.push(Object.assign([], { targets: [], group }));
  };

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      if (line[i + 1] === "\n") {
        i++;
        continue;
      }
      word += line[i + 1] ?? "";
      inWord = true;
      i++;
      continue;
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      const stop = end === -1 ? line.length : end;
      word += line.slice(i + 1, stop);
      inWord = true;
      quoted = true;
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < line.length && line[j] !== '"'; j++) {
        if (line[j] === "\\" && j + 1 < line.length) j++;
        word += line[j];
      }
      inWord = true;
      quoted = true;
      i = j;
      continue;
    }
    if (c === "#" && !inWord) {
      const end = line.indexOf("\n", i);
      i = end === -1 ? line.length : end - 1;
      continue;
    }
    if (c === "<" && line[i + 1] === "<" && line[i + 2] !== "<") {
      // Heredoc: `<<EOF`, `<<-EOF`, `<<'EOF'`. The next word is the delimiter; the body follows the next newline.
      endWord();
      i += line[i + 2] === "-" ? 2 : 1;
      next = "heredoc";
      continue;
    }
    if (c === "\n" && (heredocs.length > 0 || next === "heredoc")) {
      endWord();
      endCommand();
      let pos = i + 1;
      for (const delimiter of heredocs.splice(0)) {
        for (;;) {
          const end = line.indexOf("\n", pos);
          const text = line.slice(pos, end === -1 ? line.length : end);
          pos = end === -1 ? line.length : end + 1;
          if (text.replace(/^\t+/, "") === delimiter || end === -1) break;
        }
      }
      i = pos - 1;
      continue;
    }
    const ampRedirect = c === "&" && line[i + 1] === ">";
    if (c === ">" || c === "<" || ampRedirect) {
      // `2>` and the like: the digits belong to the redirection, not to the arguments.
      if (inWord && !quoted && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      }
      endWord();
      let j = ampRedirect ? i + 1 : i;
      while (line[j + 1] === ">" || line[j + 1] === "<" || (line[j] === ">" && line[j + 1] === "|")) j++;
      const op = line.slice(i, j + 1);
      i = j;
      if (line[i + 1] === "&") {
        // `>&2`, `2>&1`, `>&-`: duplicates a descriptor, no file name follows.
        i++;
        while (/[0-9-]/.test(line[i + 1] ?? "")) i++;
        continue;
      }
      next = op.includes(">") && !op.startsWith("<<<") ? "target" : "drop";
      continue;
    }
    const op = OPERATORS.find((o) => line.startsWith(o, i));
    if (op) {
      endWord();
      endCommand();
      if (op === "(" || op === "$(") mark("open");
      else if (op === ")") mark("close");
      i += op.length - 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      continue;
    }
    word += c;
    inWord = true;
  }
  endWord();
  endCommand();
  return commands;
}

/** Options of the prefix programs that take a separate value, so the value is not mistaken for the program. */
const PREFIX_OPTIONS_WITH_VALUE = {
  sudo: new Set([
    "-u",
    "-g",
    "-h",
    "-p",
    "-C",
    "-D",
    "-U",
    "-r",
    "-t",
    "-R",
    "--user",
    "--group",
    "--host",
    "--chdir",
    "--chroot",
  ]),
  env: new Set(["-u", "-C", "-S", "--unset", "--chdir", "--split-string"]),
  nice: new Set(["-n"]),
  exec: new Set(["-a"]),
  xargs: new Set(["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a"]),
};

/** Drops `VAR=value`, `env`, `time`, `sudo` and the like in front of the actual program. */
export function stripPrefixes(words) {
  let i = 0;
  while (i < words.length && (ASSIGNMENT.test(words[i]) || PREFIX_WORDS.has(words[i]))) {
    if (PREFIX_WORDS.has(words[i])) {
      const withValue = PREFIX_OPTIONS_WITH_VALUE[words[i]] ?? new Set();
      i++;
      while (i < words.length && words[i].startsWith("-")) i += withValue.has(words[i]) ? 2 : 1;
    } else i++;
  }
  return words.slice(i);
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** The script of `sh -c '...'`, `bash -lc "..."` and the like, or null. */
function shellScript(words) {
  const program = (words[0] ?? "").split("/").pop();
  if (!SHELLS.has(program)) return null;
  for (let i = 1; i < words.length; i++) {
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(words[i])) return words[i + 1] ?? null;
    if (!words[i].startsWith("-")) return null;
  }
  return null;
}

function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Where `cd <word>` leads from `dir`. `~` expands to the home directory, `$(git rev-parse --show-toplevel)` to the
 * repo root; any other variable or substitution makes the directory unknown (null).
 */
function cdTarget(dir, word) {
  if (dir === null) return null;
  if (word === undefined || word === "~") return os.homedir();
  if (/^\$\(\s*git\s+rev-parse\s+--show-toplevel\s*\)$/.test(word)) return findRepoRoot(dir);
  if (DYNAMIC.test(word)) return null;
  if (word.startsWith("~/")) return path.join(os.homedir(), word.slice(2));
  return path.resolve(dir, word);
}

const GIT_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--exec-path",
]);

/**
 * The subcommand of a git invocation (words after `git`), skipping git's own options and their values.
 * @returns {{ sub: string, args: string[], dir: string | null } | null}
 */
export function gitSubcommand(words, dir) {
  let i = 1;
  let at = dir;
  while (i < words.length && words[i].startsWith("-")) {
    const opt = words[i];
    if (GIT_OPTIONS_WITH_VALUE.has(opt)) {
      if (opt === "-C") at = cdTarget(at, words[i + 1]);
      i += 2;
    } else i += 1;
  }
  return i < words.length ? { sub: words[i], args: words.slice(i + 1), dir: at } : null;
}

const isGit = (word) => word === "git" || /\/git$/.test(word ?? "");

/**
 * Walks the simple commands of a line with the directory each runs in. `cd` changes it for later commands; inside
 * a subshell or substitution the change ends with it. `sh -c '...'` is walked as part of the line.
 */
function walk(line, cwd, visit) {
  const stack = [];
  let dir = cwd;
  for (const raw of splitCommands(line, { groups: true })) {
    if (raw.group === "open") {
      stack.push(dir);
      continue;
    }
    if (raw.group === "close") {
      if (stack.length > 0) dir = stack.pop();
      continue;
    }
    const words = stripPrefixes(raw);
    const script = shellScript(words);
    if (script !== null) {
      walk(script, dir, visit);
      continue;
    }
    if (words[0] === "cd") {
      const target = words.find((w, k) => k > 0 && !w.startsWith("-"));
      dir = cdTarget(dir, target);
      continue;
    }
    visit(Object.assign(words, { targets: raw.targets }), dir);
  }
}

/**
 * Every git invocation in the command line, in order, with the directory it runs in (null when it comes from a
 * variable or substitution).
 * @returns {Array<{ sub: string, args: string[], dir: string | null }>}
 */
export function gitCommands(line, cwd) {
  const result = [];
  walk(line, cwd, (words, dir) => {
    if (!isGit(words[0])) return;
    const git = gitSubcommand(words, dir);
    if (git) result.push(git);
  });
  return result;
}

/** Long options of `git commit` (git 2.4x), for resolving the unique prefixes git accepts (`--am`, `--mess`). */
const COMMIT_LONG = [
  "--all",
  "--patch",
  "--reuse-message",
  "--reedit-message",
  "--fixup",
  "--squash",
  "--reset-author",
  "--short",
  "--branch",
  "--porcelain",
  "--long",
  "--null",
  "--file",
  "--author",
  "--date",
  "--message",
  "--template",
  "--signoff",
  "--no-signoff",
  "--trailer",
  "--no-verify",
  "--verify",
  "--allow-empty",
  "--allow-empty-message",
  "--cleanup",
  "--edit",
  "--no-edit",
  "--amend",
  "--no-post-rewrite",
  "--include",
  "--only",
  "--pathspec-from-file",
  "--pathspec-file-nul",
  "--untracked-files",
  "--verbose",
  "--quiet",
  "--dry-run",
  "--status",
  "--no-status",
  "--gpg-sign",
  "--no-gpg-sign",
  "--interactive",
];
const COMMIT_LONG_WITH_VALUE = new Set([
  "--message",
  "--file",
  "--reuse-message",
  "--reedit-message",
  "--author",
  "--date",
  "--cleanup",
  "--trailer",
  "--fixup",
  "--squash",
  "--template",
  "--pathspec-from-file",
]);

/** Full name of a long option from an exact name or a unique prefix, else null (git refuses those). */
export function resolveLongOption(key) {
  if (COMMIT_LONG.includes(key)) return key;
  const candidates = COMMIT_LONG.filter((o) => o.startsWith(key));
  return candidates.length === 1 ? candidates[0] : null;
}

const COMMIT_SHORT_WITH_VALUE = new Set(["m", "F", "C", "c", "t"]);
const COMMIT_SHORT_OPTIONAL_VALUE = new Set(["S", "u"]);

/** Parses `git commit` arguments into the parts that decide what gets committed. */
export function parseCommitArgs(args) {
  const out = { all: false, amend: false, pathspecs: [], messages: [], files: [], trailers: [] };
  const take = (key, value) => {
    if (key === "-m" || key === "--message") out.messages.push(value);
    else if (key === "-F" || key === "--file") out.files.push(value);
    else if (key === "--trailer") out.trailers.push(value);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      out.pathspecs.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = resolveLongOption(eq === -1 ? a : a.slice(0, eq));
      if (key === "--all") out.all = true;
      else if (key === "--amend") out.amend = true;
      if (key && COMMIT_LONG_WITH_VALUE.has(key)) {
        const value = eq === -1 ? (args[++i] ?? "") : a.slice(eq + 1);
        take(key, value);
      }
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (COMMIT_SHORT_WITH_VALUE.has(ch)) {
          const value = j + 1 < a.length ? a.slice(j + 1) : (args[++i] ?? "");
          take(`-${ch}`, value);
          break;
        }
        if (COMMIT_SHORT_OPTIONAL_VALUE.has(ch)) break;
        if (ch === "a") out.all = true;
      }
      continue;
    }
    out.pathspecs.push(a);
  }
  return out;
}

/** Parses `git add/rm/mv/stage` arguments: pathspecs, and whether the whole tree is staged. */
export function parseStageArgs(args) {
  const out = { everything: false, trackedOnly: false, force: false, pathspecs: [] };
  let afterDashes = false;
  for (const a of args) {
    if (!afterDashes && a === "--") afterDashes = true;
    else if (!afterDashes && (a === "-A" || a === "--all" || a === "--no-ignore-removal")) out.everything = true;
    else if (!afterDashes && (a === "-u" || a === "--update")) out.trackedOnly = true;
    else if (!afterDashes && (a === "-f" || a === "--force")) out.force = true;
    else if (!afterDashes && a.startsWith("-")) {
      if (/^-[a-zA-Z]*A/.test(a)) out.everything = true;
      else if (/^-[a-zA-Z]*u/.test(a)) out.trackedOnly = true;
    } else out.pathspecs.push(a);
  }
  return out;
}

/** Programs that write every path they are given (for chmod and friends, after the mode or owner). */
const WRITES_ALL = new Set(["rm", "rmdir", "unlink", "touch", "truncate", "shred", "tee", "mv"]);
const WRITES_AFTER_FIRST = new Set(["chmod", "chown", "chgrp", "chflags"]);
/** Programs that write only their last path argument. */
const WRITES_LAST = new Set(["cp", "ln", "install", "rsync", "ditto", "scp"]);
/** git subcommands that write named paths; others that rewrite the tree make the result unknown. */
const GIT_WRITES_PATHS = new Set(["rm", "mv"]);
const GIT_WRITES_TREE = new Set([
  "reset",
  "stash",
  "apply",
  "am",
  "clean",
  "merge",
  "rebase",
  "pull",
  "cherry-pick",
  "revert",
]);
const INTERPRETERS = new Set(["node", "python", "python3", "ruby", "perl", "deno", "bun", "osascript"]);

const plainArgs = (args) => args.filter((a) => !a.startsWith("-"));

/** The path words a command writes, or "unknown" when it may write files it does not name. */
function writes(words) {
  const program = (words[0] ?? "").split("/").pop();
  const args = words.slice(1);
  if (WRITES_ALL.has(program)) return plainArgs(args);
  if (WRITES_AFTER_FIRST.has(program)) return plainArgs(args).slice(1);
  if (WRITES_LAST.has(program)) return plainArgs(args).slice(-1);
  if (program === "dd") return args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3));
  if (program === "sed" || program === "perl") {
    if (!args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) return [];
    return plainArgs(args).filter((a) => !/^s(.).*\1.*\1[a-z]*$/.test(a));
  }
  if (program === "awk" || program === "gawk") return args.includes("inplace") ? plainArgs(args).slice(1) : [];
  if (program === "find") {
    if (!args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(a))) return [];
    const roots = [];
    for (const a of args) {
      if (a.startsWith("-") || a === "(" || a === "!") break;
      roots.push(a);
    }
    return roots;
  }
  if (program === "patch" || program === "unzip" || program === "tar") return "unknown";
  if (INTERPRETERS.has(program) && args.some((a) => /^-[a-zA-Z]*[ce]$/.test(a))) return "unknown";
  if (isGit(words[0])) {
    const git = gitSubcommand(words, ".");
    if (!git) return [];
    if (GIT_WRITES_PATHS.has(git.sub)) return plainArgs(git.args.filter((a) => a !== "--"));
    // A new branch changes no files; switching branches or restoring without named paths may change any.
    if (git.sub === "switch") return git.args.some((a) => /^(-c|-C|--create|--force-create)$/.test(a)) ? [] : "unknown";
    if (git.sub === "checkout" || git.sub === "restore") {
      if (git.args.some((a) => /^(-b|-B|--orphan)$/.test(a))) return [];
      const dashes = git.args.indexOf("--");
      if (dashes !== -1) return git.args.slice(dashes + 1);
      return git.sub === "restore" && plainArgs(git.args).length > 0 ? plainArgs(git.args) : "unknown";
    }
    return GIT_WRITES_TREE.has(git.sub) ? "unknown" : [];
  }
  return [];
}

/**
 * Paths that commands before the last `git commit` in the line may write: arguments of known writers (rm, mv,
 * cp/ln/rsync targets, tee, touch, dd of=, sed/perl -i, awk inplace, find -delete/-exec, git rm/mv/checkout/restore)
 * and every output redirection. `unknown` is set when a command may write files it does not name (patch, git
 * apply/pull/merge, inline interpreter code) or a path cannot be resolved (variables, unknown directory). Writes
 * after the last commit do not change it and are ignored. Programs not listed (formatters, build tools) are not
 * seen.
 * @returns {{ paths: string[], unknown: string | null }}
 */
export function writtenPaths(line, cwd) {
  const steps = [];
  walk(line, cwd, (words, dir) => steps.push({ words, dir }));
  let last = -1;
  steps.forEach((s, k) => {
    if (isGit(s.words[0]) && gitSubcommand(s.words, s.dir)?.sub === "commit") last = k;
  });
  const paths = [];
  let unknown = null;
  for (const { words, dir } of steps.slice(0, Math.max(last, 0))) {
    const named = writes(words);
    if (named === "unknown") {
      unknown ??= words.slice(0, 2).join(" ");
      continue;
    }
    for (const word of [...named, ...words.targets]) {
      if (word === "" || word === "/dev/null" || word.startsWith("/dev/")) continue;
      if (dir === null || DYNAMIC.test(word)) {
        unknown ??= word;
        continue;
      }
      paths.push(
        word === "~" || word.startsWith("~/") ? path.join(os.homedir(), word.slice(2)) : path.resolve(dir, word),
      );
    }
  }
  return { paths, unknown };
}
