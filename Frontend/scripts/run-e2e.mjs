import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const auditDir = resolve(root, '..', 'state', 'frontend-audit')
const auditScript = resolve(auditDir, 'tools', 'audit.mjs')
const e2eDir = resolve(auditDir, 'e2e')

const required = process.env.WEBPLANT_E2E_REQUIRED === '1'
const only = process.env.WEBPLANT_E2E_ONLY || ''

if (!existsSync(auditScript) || !existsSync(e2eDir)) {
  const message =
    'SKIP: CDP-харнесс аудита не найден (state/frontend-audit/tools/audit.mjs). ' +
    'state/ исключён из git — E2E-сценарии запускаются из рабочей папки с аудит-инструментами.'
  if (required) {
    console.error('ОШИБКА: ' + message)
    process.exit(1)
  }
  console.log(message)
  process.exit(0)
}

const SCENARIOS = [
  { file: 'login.mjs', mock: 'guest', args: ['--settle=1200'] },
  { file: 'watering.mjs', mock: 'user', args: ['--settle=1200', '--w=1440', '--h=1000'] },
  { file: 'add-plant.mjs', mock: 'user', args: ['--settle=1200', '--w=1440', '--h=1200'] },
  { file: 'csp-check.mjs', mock: 'user', args: ['--settle=1200', '--w=1440'] }
].filter(item => !only || item.file.includes(only))

let failed = 0
for (const scenario of SCENARIOS) {
  const scenarioPath = resolve(e2eDir, scenario.file)
  if (!existsSync(scenarioPath)) {
    console.error(`ОШИБКА: нет сценария ${scenario.file}`)
    failed += 1
    continue
  }
  console.log(`\n=== E2E: ${scenario.file} (--mock=${scenario.mock}) ===`)
  const code = await run(process.execPath, [
    auditScript,
    'run',
    scenarioPath,
    `--mock=${scenario.mock}`,
    ...scenario.args
  ])
  if (code !== 0) {
    failed += 1
    console.error(`FAIL ${scenario.file} (exit ${code})`)
  } else {
    console.log(`PASS ${scenario.file}`)
  }
}

console.log(
  `\nE2E: ${SCENARIOS.length - failed}/${SCENARIOS.length} сценариев прошли` +
    (failed ? ', есть падения' : ' ✅')
)
process.exit(failed ? 1 : 0)

function run(command, args) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true
    })
    child.on('error', error => {
      console.error('не удалось запустить сценарий:', error.message)
      resolvePromise(1)
    })
    child.on('close', code => resolvePromise(code ?? 1))
  })
}
