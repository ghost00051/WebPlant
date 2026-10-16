#!/usr/bin/env node
/**
 * Установка git-хуков WebPlant из версионируемого каталога .githooks в $GIT_DIR/hooks.
 *
 * Почему копирование, а не core.hooksPath: рабочая копия лежит в папке Yandex.Disk,
 * где файлы могут перезаписываться синхронизацией (один раз так потерялся shebang
 * у .githooks/pre-push и git перестал запускать хук). Установленная копия лежит рядом
 * с git-каталогом и от синхронизации не зависит; расхождение с источником показывает
 * --status.
 *
 * Использование:
 *   node scripts/install-git-hooks.mjs             # установить/обновить хуки
 *   node scripts/install-git-hooks.mjs --status    # проверить, что установлено
 *   node scripts/install-git-hooks.mjs --uninstall # удалить установленные хуки
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const HOOKS_SOURCE = '.githooks';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitQuiet(args) {
  try {
    return git(args);
  } catch {
    return '';
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function short(hash) {
  return hash ? hash.slice(0, 12) : '—';
}

/** Имена хуков: файлы без расширения (README.md и прочее пропускаем). */
function listHooks(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.includes('.') && statSync(path.join(dir, name)).isFile())
    .sort();
}

function firstLine(file) {
  const content = readFileSync(file, 'utf8');
  return content.split('\n', 1)[0].replace(/\r$/, '');
}

function blobHashInHead(root, relPath) {
  return gitQuiet(['-C', root, 'rev-parse', `HEAD:${relPath.split(path.sep).join('/')}`]);
}

function context() {
  const root = git(['rev-parse', '--show-toplevel']);
  const gitDir = git(['rev-parse', '--absolute-git-dir']);
  const source = path.join(root, HOOKS_SOURCE);
  const destDir = path.join(gitDir, 'hooks');
  return { root, gitDir, source, destDir };
}

function describe(ctx) {
  const hooks = listHooks(ctx.source);
  const hooksPath = gitQuiet(['config', '--local', '--get', 'core.hooksPath']);

  console.log(`Репозиторий:       ${ctx.root}`);
  console.log(`Git-каталог:       ${ctx.gitDir}`);
  console.log(`core.hooksPath:    ${hooksPath || '(не задан — используются хуки из ' + path.join(ctx.gitDir, 'hooks') + ')'}`);
  console.log(`Источник:          ${hooks.length ? hooks.join(', ') : '(нет хуков)'}`);
  console.log('');

  let problems = 0;
  for (const name of hooks) {
    const src = path.join(ctx.source, name);
    const dest = path.join(ctx.destDir, name);
    const srcHash = sha256(src);
    const destHash = existsSync(dest) ? sha256(dest) : '';
    const shebang = firstLine(src).startsWith('#!') ? 'ok' : 'НЕТ SHEBANG';
    const head = blobHashInHead(ctx.root, path.join(HOOKS_SOURCE, name));
    const state = !destHash ? 'не установлен' : destHash === srcHash ? 'актуален' : 'устарел';
    if (state !== 'актуален' || shebang !== 'ok') problems += 1;
    console.log(`${name}: ${state}`);
    console.log(`  источник  ${short(srcHash)} (${shebang}, ${head ? `в HEAD ${head.slice(0, 12)}` : 'нет в HEAD'})`);
    console.log(`  копия     ${short(destHash)} ${dest}`);
  }

  if (hooksPath) {
    problems += 1;
    console.log('\nВнимание: core.hooksPath задан и перекрывает каталог hooks — установите заново: node scripts/install-git-hooks.mjs');
  }
  if (!hooks.length) problems += 1;
  if (!problems) console.log('\nВсё в порядке: установленные хуки совпадают с .githooks.');
  return problems;
}

function install(ctx) {
  const hooks = listHooks(ctx.source);
  if (!hooks.length) {
    console.error(`Ошибка: в ${HOOKS_SOURCE} нет файлов-хуков.`);
    process.exit(2);
  }

  mkdirSync(ctx.destDir, { recursive: true });

  for (const name of hooks) {
    const src = path.join(ctx.source, name);
    const rel = path.join(HOOKS_SOURCE, name).split(path.sep).join('/');
    const dest = path.join(ctx.destDir, name);

    if (!firstLine(src).startsWith('#!')) {
      console.error(`Ошибка: ${rel} повреждён — нет строки #! в начале файла.`);
      console.error(`Починить: git checkout -- ${rel}  (потом повторите установку)`);
      process.exit(2);
    }

    const headBlob = blobHashInHead(ctx.root, path.join(HOOKS_SOURCE, name));
    if (headBlob && gitQuiet(['hash-object', src]) !== headBlob) {
      console.log(`Внимание: ${rel} отличается от версии в HEAD (незакоммиченные правки или повреждение файла).`);
    }

    const srcHash = sha256(src);
    const destHash = existsSync(dest) ? sha256(dest) : '';
    copyFileSync(src, dest);
    try {
      chmodSync(dest, 0o755);
    } catch {
      /* Windows: права файла не важны, хук запускает sh из Git for Windows */
    }
    const state = !destHash ? 'установлен' : destHash === srcHash ? 'без изменений' : 'обновлён';
    console.log(`${name}: ${state} → ${dest} (${short(srcHash)})`);
  }

  const hooksPath = gitQuiet(['config', '--local', '--get', 'core.hooksPath']);
  if (hooksPath) {
    execFileSync('git', ['config', '--local', '--unset', 'core.hooksPath']);
    console.log(`core.hooksPath (${hooksPath}) снят: иначе он перекрыл бы ${ctx.destDir}.`);
  }

  console.log('\nГотово. Обновлять после правок: node scripts/install-git-hooks.mjs');
  if (hooks.includes('pre-push')) {
    console.log('pre-push при push ставит тег v<version> из Frontend/package.json отправляемого коммита.');
    console.log('Разово пропустить: WEBPLANT_SKIP_AUTOTAG=1 git push ...');
    console.log('Подробности: .githooks/README.md');
  }
}

function uninstall(ctx) {
  const hooks = listHooks(ctx.source);
  let removed = 0;
  for (const name of hooks) {
    const dest = path.join(ctx.destDir, name);
    if (!existsSync(dest)) continue;
    rmSync(dest);
    removed += 1;
    console.log(`${name}: удалён из ${ctx.destDir}`);
  }
  if (!removed) console.log('Установленных хуков нет — удалять нечего.');

  const hooksPath = gitQuiet(['config', '--local', '--get', 'core.hooksPath']);
  if (hooksPath) {
    execFileSync('git', ['config', '--local', '--unset', 'core.hooksPath']);
    console.log(`core.hooksPath (${hooksPath}) снят.`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--uninstall') ? 'uninstall' : args.includes('--status') ? 'status' : 'install';

  let ctx;
  try {
    ctx = context();
  } catch {
    console.error('Ошибка: команду нужно запускать внутри git-репозитория.');
    process.exit(2);
  }

  if (mode === 'status') process.exit(describe(ctx) ? 1 : 0);
  if (mode === 'uninstall') {
    uninstall(ctx);
    return;
  }
  install(ctx);
}

main();
