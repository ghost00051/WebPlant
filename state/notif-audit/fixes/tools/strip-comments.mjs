import { readFile, writeFile, stat } from 'node:fs/promises'
import { join, relative, resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const workspace = resolve(import.meta.dirname, '..', '..', '..', '..')
const frontendRoot = join(workspace, 'Frontend')
const parserEntry = join(frontendRoot, 'node_modules', '@babel', 'parser', 'lib', 'index.js')
const parserModule = await import(pathToFileURL(parserEntry).href)
const parse = parserModule.parse ?? parserModule.default?.parse
if (typeof parse !== 'function') throw new Error('@babel/parser не найден')

const apply = process.argv.includes('--apply')

const targets = JSON.parse(await readFile(join(import.meta.dirname, 'targets.json'), 'utf8'))

const FUNCTIONAL = /^(?:eslint-|@eslint|global(?:\s|$)|exported(?:\s|$)|@vite-ignore|@ts-|@preserve|@license|@cc_on|sourceMappingURL|prettier-ignore)/i

function isJsxFile(file) {
    return file.endsWith('.jsx')
}

function walkAst(node, visitor) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
        for (const item of node) walkAst(item, visitor)
        return
    }
    if (typeof node.type === 'string') visitor(node)
    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' ||
            key === 'trailingComments' || key === 'innerComments' || key === 'comments') continue
        walkAst(node[key], visitor)
    }
}

function removeRanges(code, ranges) {
    const sorted = []
    for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
        const last = sorted[sorted.length - 1]
        if (last && start <= last[1]) {
            last[1] = Math.max(last[1], end)
        } else {
            sorted.push([start, end])
        }
    }
    let result = code
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
        const [start, end] = sorted[index]
        result = result.slice(0, start) + result.slice(end)
    }
    return result
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '')
}

function stripJs(code, file) {
    const ast = parse(code, {
        sourceType: 'module',
        plugins: isJsxFile(file) ? ['jsx'] : [],
        attachComment: true,
        errorRecovery: false
    })
    const comments = ast.comments || []
    const jsxContainers = []
    walkAst(ast.program, node => {
        if (node.type === 'JSXExpressionContainer' && node.expression?.type === 'JSXEmptyExpression') {
            jsxContainers.push([node.start, node.end])
        }
    })
    const ranges = []
    let removed = 0
    for (const comment of comments) {
        const value = String(comment.value || '').trim()
        if (FUNCTIONAL.test(value) || /^!/.test(value)) continue
        const insideJsxContainer = jsxContainers.some(
            ([start, end]) => comment.start >= start && comment.end <= end
        )
        if (insideJsxContainer) continue
        ranges.push([comment.start, comment.end])
        removed += 1
    }
    for (const [start, end] of jsxContainers) {
        const text = code.slice(start, end)
        if (/^\{\s*\/\*/.test(text)) {
            ranges.push([start, end])
            removed += 1
        }
    }
    return { code: removeRanges(code, ranges), removed }
}

function stripCss(code) {
    let removed = 0
    const result = code.replace(/\/\*[\s\S]*?\*\//g, match => {
        if (match.startsWith('/*!')) return match
        removed += 1
        return ''
    })
    return { code: result.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n'), removed }
}

function stripSql(code) {
    let removed = 0
    const withoutBlocks = code.replace(/\/\*[\s\S]*?\*\//g, match => {
        if (match.startsWith('/*!')) return match
        removed += 1
        return ''
    })
    const lines = withoutBlocks.split('\n')
    const kept = lines.filter(line => {
        const trimmed = line.trim()
        if (trimmed.startsWith('--')) {
            removed += 1
            return false
        }
        return true
    })
    return { code: kept.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n'), removed }
}

function stripHtaccess(code) {
    let removed = 0
    const lines = code.split('\n').filter(line => {
        if (line.trim().startsWith('#')) {
            removed += 1
            return false
        }
        return true
    })
    return { code: lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n'), removed }
}

function stripCommentText(code, file) {
    const extension = extname(file)
    if (extension === '.css') return stripCss(code)
    if (extension === '.sql') return stripSql(code)
    if (file.endsWith('htaccess')) return stripHtaccess(code)
    return stripJs(code, file)
}

const report = []
const failures = []

for (const target of targets) {
    const absolute = join(workspace, target)
    try {
        await stat(absolute)
        const code = await readFile(absolute, 'utf8')
        const result = stripCommentText(code, target)
        report.push({ file: target, removed: result.removed, changed: result.code !== code })
        if (apply && result.code !== code) {
            await writeFile(absolute, result.code, 'utf8')
        }
    } catch (error) {
        failures.push({ file: target, error: String(error?.message || error).slice(0, 300) })
    }
}

console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
console.log(`files: ${report.length}, comments planned: ${report.reduce((sum, item) => sum + item.removed, 0)}`)
for (const item of report.filter(entry => entry.changed)) {
    console.log(`  ${item.removed.toString().padStart(3)}  ${item.file}`)
}
if (failures.length) {
    console.error('\nFAILURES:')
    for (const failure of failures) console.error(`  ${failure.file}: ${failure.error}`)
    process.exitCode = 1
}
if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to write changes.')
}
