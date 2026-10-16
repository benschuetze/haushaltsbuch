// Just enough shell parsing to find the git commands in a Bash tool call and the directory each one runs in.
// Not a shell: no expansion, no aliases, no functions. Unparseable input yields fewer commands, never a crash.

import path from "node:path";

const OPERATORS = ["&&", "||", ";;", "$(", ";", "&", "|", "(", ")", "\n", "`"];
const SEGMENT_WORDS = new Set(["{", "}", "!", "then", "do", "else", "elif"]);
const PREFIX_WORDS = new Set(["time", "command", "builtin", "exec", "nohup", "env", "sudo", "xargs"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Splits a command line into simple commands (arrays of words), respecting quotes. Redirection targets are dropped,
 * unless `keepRedirects` is set: then they stay as words, which is what a scan for written paths needs.
 */
export function splitCommands(line, { keepRedirects = false } = {}) {
  const commands = [];
  let words = [];
  let word = "";
  let inWord = false;
  let quoted = false;
  // The word after `>`, `>>` or `<` is a redirection target, not an argument.
  let dropNext = false;
  // Heredoc delimiters seen on the current line; their bodies start at the next newline and are skipped.
  const heredocs = [];
  let readDelimiter = false;
  const endWord = () => {
    if (inWord && readDelimiter) {
      heredocs.push(word);
      readDelimiter = false;
      word = "";
      inWord = false;
      quoted = false;
      return;
    }
    if (inWord) {
      if (dropNext) dropNext = false;
      else if (!quoted && SEGMENT_WORDS.has(word)) endCommand();
      else words.push(word);
    }
    word = "";
    inWord = false;
    quoted = false;
  };
  const endCommand = () => {
    if (words.length > 0) commands.push(words);
    words = [];
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
      // Heredoc: `<<EOF`, `<<-EOF`, `<<'EOF'`. The next word is the delimiter, not an argument.
      endWord();
      i += line[i + 2] === "-" ? 2 : 1;
      readDelimiter = true;
      continue;
    }
    if (c === "\n" && (heredocs.length > 0 || readDelimiter)) {
      endWord();
      endCommand();
      // Skip each body up to the line that holds only its delimiter (leading tabs allowed for `<<-`).
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
    if (c === ">" || c === "<") {
      // `2>` and the like: the digits belong to the redirection, not to the arguments.
      if (inWord && !quoted && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      }
      endWord();
      while (line[i + 1] === ">" || line[i + 1] === "<") i++;
      if (line[i + 1] === "&") {
        // `>&2`, `2>&1`, `>&-`: duplicates a descriptor, no file name follows.
        i++;
        while (/[0-9-]/.test(line[i + 1] ?? "")) i++;
      } else dropNext = !keepRedirects;
      continue;
    }
    const op = OPERATORS.find((o) => line.startsWith(o, i));
    if (op) {
      endWord();
      endCommand();
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
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-U", "-r", "-t"]),
  env: new Set(["-u", "-C", "-S", "--unset", "--chdir", "--split-string"]),
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

const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);

/**
 * Every git invocation in the command line, in order, with the directory it runs in. `cd dir` earlier in the line
 * changes that directory for later commands, which is right for `cd x && git commit` and close enough otherwise.
 * @returns {Array<{ sub: string, args: string[], dir: string }>}
 */
export function gitCommands(line, cwd) {
  const result = [];
  let dir = cwd;
  for (const raw of splitCommands(line)) {
    const words = stripPrefixes(raw);
    const script = shellScript(words);
    if (script !== null) {
      result.push(...gitCommands(script, dir));
      continue;
    }
    if (words[0] === "cd" && words[1] && !words[1].startsWith("-")) {
      dir = path.resolve(dir, words[1]);
      continue;
    }
    if (words[0] !== "git" && !/\/git$/.test(words[0] ?? "")) continue;
    let i = 1;
    let gitDir = dir;
    while (i < words.length && words[i].startsWith("-")) {
      const opt = words[i];
      if (GIT_OPTIONS_WITH_VALUE.has(opt)) {
        if (opt === "-C" && words[i + 1]) gitDir = path.resolve(gitDir, words[i + 1]);
        i += 2;
      } else i += 1;
    }
    if (i < words.length) result.push({ sub: words[i], args: words.slice(i + 1), dir: gitDir });
  }
  return result;
}

const COMMIT_SHORT_WITH_VALUE = new Set(["m", "F", "C", "c", "t"]);
const COMMIT_SHORT_OPTIONAL_VALUE = new Set(["S", "u"]);
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
      const key = eq === -1 ? a : a.slice(0, eq);
      // git accepts unique prefixes of long options (`--amen`, `--al`).
      if (key.length >= 4 && "--all".startsWith(key)) out.all = true;
      else if (key.length >= 5 && "--amend".startsWith(key)) out.amend = true;
      if (COMMIT_LONG_WITH_VALUE.has(key)) {
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
