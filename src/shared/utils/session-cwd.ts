export interface ResolvePreferredSessionCwdInput {
  isSshSession: boolean
  hintedCwd: string | null | undefined
  refreshedCwd: string | null | undefined
}

export function normalizeSessionCwdValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
}

export function expandHomePathWithKnownBase(pathLike: string, knownBasePath: string): string | null {
  const normalizedPathLike = normalizeSessionCwdValue(pathLike)
  const normalizedBasePath = normalizeSessionCwdValue(knownBasePath)
  if (!normalizedPathLike || !normalizedBasePath) {
    return null
  }

  if (!normalizedPathLike.startsWith('~')) {
    return normalizedPathLike
  }

  if (!normalizedBasePath.startsWith('/')) {
    return null
  }

  if (normalizedPathLike === '~') {
    return normalizedBasePath
  }

  if (!normalizedPathLike.startsWith('~/')) {
    return null
  }

  const suffix = normalizedPathLike.slice(2).trim()
  if (!suffix) {
    return normalizedBasePath
  }

  return `${normalizedBasePath.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

export function resolvePreferredSessionCwd(input: ResolvePreferredSessionCwdInput): string | null {
  const hinted = normalizeSessionCwdValue(input.hintedCwd)
  const refreshed = normalizeSessionCwdValue(input.refreshedCwd)

  if (!input.isSshSession) {
    return hinted ?? refreshed
  }

  if (hinted && !hinted.startsWith('~')) {
    return hinted
  }

  if (!hinted) {
    return refreshed
  }

  return expandHomePathWithKnownBase(hinted, refreshed ?? '') ?? hinted
}

function unwrapShellToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) {
    return ''
  }

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

function normalizePathTokens(raw: string): string[] {
  return raw
    .split('/')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function resolveRelativePathFromBase(base: string, target: string): string | null {
  const normalizedBase = normalizeSessionCwdValue(base)
  const normalizedTarget = normalizeSessionCwdValue(target)
  if (!normalizedBase || !normalizedTarget) {
    return null
  }

  let prefix: '/' | '~' | null = null
  let baseTokens: string[] = []

  if (normalizedBase === '~' || normalizedBase.startsWith('~/')) {
    prefix = '~'
    baseTokens = normalizePathTokens(normalizedBase.slice(2))
  } else if (normalizedBase.startsWith('/')) {
    prefix = '/'
    baseTokens = normalizePathTokens(normalizedBase)
  } else {
    return null
  }

  const targetTokens = normalizePathTokens(normalizedTarget)
  const merged = [...baseTokens]
  for (const token of targetTokens) {
    if (token === '.') {
      continue
    }
    if (token === '..') {
      if (merged.length > 0) {
        merged.pop()
      }
      continue
    }
    merged.push(token)
  }

  if (prefix === '/') {
    return merged.length ? `/${merged.join('/')}` : '/'
  }

  return merged.length ? `~/${merged.join('/')}` : '~'
}

export function resolveSessionCwdHintFromCommand(command: string, currentCwd?: string | null): string | null {
  const normalizedCommand = normalizeSessionCwdValue(command)
  if (!normalizedCommand) {
    return null
  }

  const commandBody = normalizedCommand.replace(/[;]+$/u, '').trim()
  if (!commandBody) {
    return null
  }

  // Ignore shell command chains where cwd side-effects are not deterministic.
  if (/&&|\|\||\||;/u.test(commandBody)) {
    return null
  }

  const withoutPrefix = commandBody.replace(/^(?:builtin|command)\s+/u, '')
  const match = withoutPrefix.match(/^cd(?:\s+(.+))?$/u)
  if (!match) {
    return null
  }

  const rawTarget = match[1]?.trim() ?? '~'
  if (!rawTarget || rawTarget === '-') {
    return null
  }

  const withoutOption = rawTarget.replace(/^--\s+/u, '')
  const target = unwrapShellToken(withoutOption)
  if (!target) {
    return null
  }

  if (target === '~' || target.startsWith('~/') || target.startsWith('/')) {
    return target
  }

  if (target === '.') {
    return normalizeSessionCwdValue(currentCwd) ?? null
  }

  if (target === '..' || target.startsWith('./') || target.startsWith('../') || !target.startsWith('/')) {
    const base = normalizeSessionCwdValue(currentCwd)
    if (base) {
      return resolveRelativePathFromBase(base, target)
    }

    // When base cwd is unknown, most local shells resolve relative paths from home.
    if (target !== '..' && target !== '.' && !target.startsWith('./') && !target.startsWith('../')) {
      return `~/${target.replace(/^\/+/, '')}`
    }
  }

  return null
}
