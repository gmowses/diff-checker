import { useState, useCallback, useEffect } from 'react'
import {
  ArrowLeftRight,
  Copy,
  Check,
  Trash2,
  GitCompare,
  Sun,
  Moon,
  Languages,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

// ── i18n ─────────────────────────────────────────────────────────────────────
const translations = {
  en: {
    title: 'Diff Checker',
    subtitle: 'Compare two texts side-by-side with line-level and word-level highlighting. Everything runs client-side.',
    original: 'Original',
    modified: 'Modified',
    originalPlaceholder: 'Paste your original text here...',
    modifiedPlaceholder: 'Paste your modified text here...',
    compare: 'Compare',
    swap: 'Swap',
    clear: 'Clear',
    stats: 'Statistics',
    added: 'Added',
    removed: 'Removed',
    changed: 'Changed',
    unchanged: 'Unchanged',
    lines: 'lines',
    line: 'line',
    sideBySide: 'Side by Side',
    unifiedDiff: 'Unified Diff',
    copyDiff: 'Copy Diff',
    copied: 'Copied!',
    noDiff: 'No differences found — the texts are identical.',
    emptyState: 'Paste text in both panels and click Compare.',
    showUnified: 'Show unified diff',
    hideUnified: 'Hide unified diff',
    builtBy: 'Built by',
  },
  pt: {
    title: 'Diff Checker',
    subtitle: 'Compare dois textos lado a lado com destaque por linha e por palavra. Tudo roda no navegador.',
    original: 'Original',
    modified: 'Modificado',
    originalPlaceholder: 'Cole seu texto original aqui...',
    modifiedPlaceholder: 'Cole seu texto modificado aqui...',
    compare: 'Comparar',
    swap: 'Inverter',
    clear: 'Limpar',
    stats: 'Estatisticas',
    added: 'Adicionadas',
    removed: 'Removidas',
    changed: 'Alteradas',
    unchanged: 'Inalteradas',
    lines: 'linhas',
    line: 'linha',
    sideBySide: 'Lado a Lado',
    unifiedDiff: 'Diff Unificado',
    copyDiff: 'Copiar Diff',
    copied: 'Copiado!',
    noDiff: 'Nenhuma diferenca encontrada — os textos sao identicos.',
    emptyState: 'Cole texto nos dois paineis e clique em Comparar.',
    showUnified: 'Exibir diff unificado',
    hideUnified: 'Ocultar diff unificado',
    builtBy: 'Criado por',
  },
} as const

type Lang = keyof typeof translations

// ── Diff algorithm ────────────────────────────────────────────────────────────
// Myers-style LCS diff: produces edit script of equal/insert/delete ops.

type DiffOp = 'equal' | 'insert' | 'delete'

interface LineDiff {
  op: DiffOp
  origLine: number | null  // 1-based, null for pure inserts
  modLine: number | null   // 1-based, null for pure deletes
  text: string
}

interface SidePair {
  origLine: number | null
  modLine: number | null
  origText: string | null
  modText: string | null
  kind: 'equal' | 'added' | 'removed' | 'changed'
}

function lcsLength(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp
}

function buildLineDiffs(origLines: string[], modLines: string[]): LineDiff[] {
  const dp = lcsLength(origLines, modLines)
  const result: LineDiff[] = []
  let i = origLines.length, j = modLines.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      result.push({ op: 'equal', origLine: i, modLine: j, text: origLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ op: 'insert', origLine: null, modLine: j, text: modLines[j - 1] })
      j--
    } else {
      result.push({ op: 'delete', origLine: i, modLine: null, text: origLines[i - 1] })
      i--
    }
  }

  return result.reverse()
}

// Pair up consecutive deletes and inserts as "changed" lines.
function pairIntoPanels(diffs: LineDiff[]): SidePair[] {
  const pairs: SidePair[] = []
  let k = 0
  while (k < diffs.length) {
    const d = diffs[k]
    if (d.op === 'equal') {
      pairs.push({ origLine: d.origLine, modLine: d.modLine, origText: d.text, modText: d.text, kind: 'equal' })
      k++
    } else if (d.op === 'delete') {
      // Look ahead: if next is insert → changed pair
      if (k + 1 < diffs.length && diffs[k + 1].op === 'insert') {
        const ins = diffs[k + 1]
        pairs.push({ origLine: d.origLine, modLine: ins.modLine, origText: d.text, modText: ins.text, kind: 'changed' })
        k += 2
      } else {
        pairs.push({ origLine: d.origLine, modLine: null, origText: d.text, modText: null, kind: 'removed' })
        k++
      }
    } else {
      // insert with no preceding delete
      pairs.push({ origLine: null, modLine: d.modLine, origText: null, modText: d.text, kind: 'added' })
      k++
    }
  }
  return pairs
}

// ── Word-level inline diff ────────────────────────────────────────────────────
interface WordToken { text: string; highlight: boolean }

function wordDiff(a: string, b: string): { aTokens: WordToken[]; bTokens: WordToken[] } {
  const aWords = a.split(/(\s+)/)
  const bWords = b.split(/(\s+)/)
  const dp = lcsLength(aWords, bWords)

  const aResult: WordToken[] = []
  const bResult: WordToken[] = []
  let i = aWords.length, j = bWords.length

  const ops: Array<{ op: DiffOp; aW?: string; bW?: string }> = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aWords[i - 1] === bWords[j - 1]) {
      ops.push({ op: 'equal', aW: aWords[i - 1], bW: bWords[j - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ op: 'insert', bW: bWords[j - 1] })
      j--
    } else {
      ops.push({ op: 'delete', aW: aWords[i - 1] })
      i--
    }
  }
  ops.reverse()

  for (const op of ops) {
    if (op.op === 'equal') {
      aResult.push({ text: op.aW!, highlight: false })
      bResult.push({ text: op.bW!, highlight: false })
    } else if (op.op === 'delete') {
      aResult.push({ text: op.aW!, highlight: true })
    } else {
      bResult.push({ text: op.bW!, highlight: true })
    }
  }

  return { aTokens: aResult, bTokens: bResult }
}

// ── Unified diff output ───────────────────────────────────────────────────────
function buildUnifiedDiff(_origLines: string[], _modLines: string[], diffs: LineDiff[]): string {
  const header = `--- original\n+++ modified\n`
  const CONTEXT = 3
  const chunks: string[] = []

  // Collect hunk ranges
  type Hunk = { start: number; end: number }
  const hunks: Hunk[] = []

  for (let idx = 0; idx < diffs.length; idx++) {
    if (diffs[idx].op !== 'equal') {
      const start = Math.max(0, idx - CONTEXT)
      const end = Math.min(diffs.length - 1, idx + CONTEXT)
      if (hunks.length > 0 && start <= hunks[hunks.length - 1].end + 1) {
        hunks[hunks.length - 1].end = end
      } else {
        hunks.push({ start, end })
      }
    }
  }

  if (hunks.length === 0) return ''

  for (const hunk of hunks) {
    const slice = diffs.slice(hunk.start, hunk.end + 1)
    let origStart = 0, modStart = 0, origCount = 0, modCount = 0
    for (const d of slice) {
      if (d.op !== 'insert') origCount++
      if (d.op !== 'delete') modCount++
    }
    // First origLine or modLine in the slice
    for (const d of slice) {
      if (d.origLine !== null) { origStart = d.origLine; break }
    }
    for (const d of slice) {
      if (d.modLine !== null) { modStart = d.modLine; break }
    }

    let hunkStr = `@@ -${origStart},${origCount} +${modStart},${modCount} @@\n`
    for (const d of slice) {
      if (d.op === 'equal') hunkStr += ` ${d.text}\n`
      else if (d.op === 'delete') hunkStr += `-${d.text}\n`
      else hunkStr += `+${d.text}\n`
    }
    chunks.push(hunkStr)
  }

  return header + chunks.join('\n')
}

// ── Diff stats ────────────────────────────────────────────────────────────────
interface DiffStats { added: number; removed: number; changed: number; unchanged: number }

function calcStats(pairs: SidePair[]): DiffStats {
  let added = 0, removed = 0, changed = 0, unchanged = 0
  for (const p of pairs) {
    if (p.kind === 'added') added++
    else if (p.kind === 'removed') removed++
    else if (p.kind === 'changed') changed++
    else unchanged++
  }
  return { added, removed, changed, unchanged }
}

// ── Sub-components ────────────────────────────────────────────────────────────
function InlineText({ tokens, bg }: { tokens: WordToken[]; bg: string }) {
  return (
    <>
      {tokens.map((tok, i) =>
        tok.highlight
          ? <mark key={i} className={`${bg} rounded-sm px-0.5`}>{tok.text}</mark>
          : <span key={i}>{tok.text}</span>
      )}
    </>
  )
}

interface PanelRowProps {
  pair: SidePair
  side: 'orig' | 'mod'
}

const KIND_CLASSES: Record<SidePair['kind'], { row: string; num: string }> = {
  equal:   { row: '',                                          num: 'text-zinc-400' },
  added:   { row: 'bg-green-500/10 dark:bg-green-500/15',     num: 'text-green-600 dark:text-green-400' },
  removed: { row: 'bg-red-500/10 dark:bg-red-500/15',         num: 'text-red-600 dark:text-red-400' },
  changed: { row: 'bg-yellow-400/10 dark:bg-yellow-400/15',   num: 'text-yellow-600 dark:text-yellow-400' },
}

function SidePanelRow({ pair, side }: PanelRowProps) {
  const isOrig = side === 'orig'
  const lineNum = isOrig ? pair.origLine : pair.modLine
  const text = isOrig ? pair.origText : pair.modText
  const { row, num } = KIND_CLASSES[pair.kind]

  // Empty filler row (the other side has content this side does not)
  if (text === null) {
    return (
      <div className="flex min-h-[24px] bg-zinc-100/60 dark:bg-zinc-800/40">
        <span className="w-12 shrink-0 select-none border-r border-zinc-200 dark:border-zinc-700 text-right pr-2 text-xs leading-6 text-zinc-300 dark:text-zinc-600" />
        <span className="flex-1 px-3 leading-6" />
      </div>
    )
  }

  let content: React.ReactNode = text

  if (pair.kind === 'changed' && pair.origText !== null && pair.modText !== null) {
    const { aTokens, bTokens } = wordDiff(pair.origText, pair.modText)
    const tokens = isOrig ? aTokens : bTokens
    const markBg = isOrig
      ? 'bg-red-300/60 dark:bg-red-500/40'
      : 'bg-green-300/60 dark:bg-green-500/40'
    content = <InlineText tokens={tokens} bg={markBg} />
  }

  return (
    <div className={`flex min-h-[24px] ${row}`}>
      <span className={`w-12 shrink-0 select-none border-r border-zinc-200 dark:border-zinc-700 text-right pr-2 text-xs leading-6 tabular-nums ${num}`}>
        {lineNum}
      </span>
      <pre className="flex-1 px-3 leading-6 text-xs whitespace-pre-wrap break-all font-mono">
        {content}
      </pre>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DiffChecker() {
  const [lang, setLang] = useState<Lang>(() => (navigator.language.startsWith('pt') ? 'pt' : 'en'))
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  const [origText, setOrigText] = useState('')
  const [modText, setModText] = useState('')
  const [pairs, setPairs] = useState<SidePair[] | null>(null)
  const [stats, setStats] = useState<DiffStats | null>(null)
  const [unifiedDiff, setUnifiedDiff] = useState('')
  const [showUnified, setShowUnified] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hasCompared, setHasCompared] = useState(false)

  const t = translations[lang]

  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])

  const handleCompare = useCallback(() => {
    const origLines = origText.split('\n')
    const modLines = modText.split('\n')
    const diffs = buildLineDiffs(origLines, modLines)
    const p = pairIntoPanels(diffs)
    setPairs(p)
    setStats(calcStats(p))
    setUnifiedDiff(buildUnifiedDiff(origLines, modLines, diffs))
    setHasCompared(true)
  }, [origText, modText])

  const handleSwap = () => {
    setOrigText(modText)
    setModText(origText)
    setPairs(null)
    setStats(null)
    setUnifiedDiff('')
    setHasCompared(false)
  }

  const handleClear = () => {
    setOrigText('')
    setModText('')
    setPairs(null)
    setStats(null)
    setUnifiedDiff('')
    setHasCompared(false)
  }

  const handleCopyDiff = () => {
    if (!unifiedDiff) return
    navigator.clipboard.writeText(unifiedDiff).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const noDiff = hasCompared && stats !== null && stats.added === 0 && stats.removed === 0 && stats.changed === 0

  const statItems = stats
    ? [
        { label: t.added,     value: stats.added,     color: 'text-green-600 dark:text-green-400',   bg: 'bg-green-500/10' },
        { label: t.removed,   value: stats.removed,   color: 'text-red-600 dark:text-red-400',       bg: 'bg-red-500/10' },
        { label: t.changed,   value: stats.changed,   color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-400/10' },
        { label: t.unchanged, value: stats.unchanged, color: 'text-zinc-500 dark:text-zinc-400',     bg: 'bg-zinc-100 dark:bg-zinc-800' },
      ]
    : []

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 transition-colors">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center">
              <GitCompare size={18} className="text-white" />
            </div>
            <span className="font-semibold">Diff Checker</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang(l => l === 'en' ? 'pt' : 'en')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Toggle language"
            >
              <Languages size={14} />
              {lang.toUpperCase()}
            </button>
            <button
              onClick={() => setDark(d => !d)}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Toggle theme"
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <a
              href="https://github.com/gmowses/diff-checker"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-6 py-10">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Title */}
          <div>
            <h1 className="text-3xl font-bold">{t.title}</h1>
            <p className="mt-2 text-zinc-500 dark:text-zinc-400">{t.subtitle}</p>
          </div>

          {/* Input panels */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t.original}</label>
              <textarea
                value={origText}
                onChange={e => setOrigText(e.target.value)}
                placeholder={t.originalPlaceholder}
                spellCheck={false}
                className="w-full h-52 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 font-mono text-sm resize-y placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/40 transition"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t.modified}</label>
              <textarea
                value={modText}
                onChange={e => setModText(e.target.value)}
                placeholder={t.modifiedPlaceholder}
                spellCheck={false}
                className="w-full h-52 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 font-mono text-sm resize-y placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500/40 transition"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleCompare}
              disabled={!origText && !modText}
              className="flex items-center gap-2 rounded-lg bg-red-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40 transition-colors"
            >
              <GitCompare size={15} />
              {t.compare}
            </button>
            <button
              onClick={handleSwap}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ArrowLeftRight size={15} />
              {t.swap}
            </button>
            <button
              onClick={handleClear}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Trash2 size={15} />
              {t.clear}
            </button>
          </div>

          {/* Stats */}
          {stats !== null && !noDiff && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {statItems.map(({ label, value, color, bg }) => (
                <div key={label} className={`rounded-xl border border-zinc-200 dark:border-zinc-800 ${bg} px-4 py-3`}>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">{label}</p>
                  <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
                  <p className="text-[10px] text-zinc-400">{value === 1 ? t.line : t.lines}</p>
                </div>
              ))}
            </div>
          )}

          {/* No diff */}
          {noDiff && (
            <div className="rounded-xl border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-5 py-4 text-sm text-green-700 dark:text-green-400">
              {t.noDiff}
            </div>
          )}

          {/* Empty state */}
          {!hasCompared && (
            <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-6 py-12 text-center text-sm text-zinc-400">
              {t.emptyState}
            </div>
          )}

          {/* Side-by-side diff */}
          {pairs !== null && !noDiff && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              {/* Panel header */}
              <div className="grid grid-cols-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                <div className="px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide border-r border-zinc-200 dark:border-zinc-800">
                  {t.original}
                </div>
                <div className="px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                  {t.modified}
                </div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50 overflow-x-auto">
                {pairs.map((pair, idx) => (
                  <div key={idx} className="grid grid-cols-2">
                    <div className="border-r border-zinc-200 dark:border-zinc-700">
                      <SidePanelRow pair={pair} side="orig" />
                    </div>
                    <div>
                      <SidePanelRow pair={pair} side="mod" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unified diff toggle */}
          {hasCompared && !noDiff && unifiedDiff && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
                <button
                  onClick={() => setShowUnified(v => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                >
                  {showUnified ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {t.unifiedDiff}
                </button>
                <button
                  onClick={handleCopyDiff}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                  {copied ? t.copied : t.copyDiff}
                </button>
              </div>
              {showUnified && (
                <div className="overflow-x-auto">
                  <pre className="p-4 text-xs font-mono leading-6 whitespace-pre">
                    {unifiedDiff.split('\n').map((line, i) => {
                      let cls = 'text-zinc-600 dark:text-zinc-400'
                      if (line.startsWith('---') || line.startsWith('+++')) cls = 'text-zinc-500 dark:text-zinc-500 font-semibold'
                      else if (line.startsWith('@@')) cls = 'text-red-500 dark:text-red-400 font-semibold'
                      else if (line.startsWith('+')) cls = 'text-green-600 dark:text-green-400 bg-green-500/10'
                      else if (line.startsWith('-')) cls = 'text-red-600 dark:text-red-400 bg-red-500/10'
                      return <div key={i} className={`${cls} px-1`}>{line || ' '}</div>
                    })}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-zinc-400">
          <span>
            {t.builtBy}{' '}
            <a
              href="https://github.com/gmowses"
              className="text-zinc-600 dark:text-zinc-300 hover:text-red-500 transition-colors"
            >
              Gabriel Mowses
            </a>
          </span>
          <span>MIT License</span>
        </div>
      </footer>
    </div>
  )
}
