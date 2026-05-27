/**
 * Доказательство (TDD): LaunchAgent + цикл со случайным интервалом (в plist только KeepAlive).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const plistPath = path.join(repoRoot, 'mac', 'com.focus-track.screenshot.plist');
const capturePath = path.join(repoRoot, 'mac', 'capture-if-active.sh');
const loopPath = path.join(repoRoot, 'mac', 'capture-random-loop.sh');

test('LaunchAgent plist: KeepAlive + рандомный тикер; capture — focus-capture и idle', () => {
  assert.ok(fs.existsSync(plistPath), `Ожидался файл: ${plistPath}`);
  assert.ok(fs.existsSync(capturePath), `Ожидался файл: ${capturePath}`);
  assert.ok(fs.existsSync(loopPath), `Ожидался файл: ${loopPath}`);

  const plistXml = fs.readFileSync(plistPath, 'utf8');
  assert.ok(plistXml.includes('<key>KeepAlive</key>'), 'Случайный интервал делаем циклом в bash, агент держим живым');
  assert.ok(!plistXml.includes('<key>StartInterval</key>'), 'StartInterval убран — тикер случайный в скрипте');
  assert.ok(
    plistXml.includes('FOCUS_TRACK_ROOT'),
    'В plist задайте FOCUS_TRACK_ROOT на абсолютный путь к клону репозитория',
  );
  assert.ok(
    plistXml.includes('capture-random-loop.sh'),
    'Plist должен запускать цикл со случайной паузой',
  );
  assert.ok(
    plistXml.includes('FOCUS_TRACK_TICK_MIN_SEC') && plistXml.includes('FOCUS_TRACK_TICK_MAX_SEC'),
    'Границы паузы задаются переменными окружения',
  );
  assert.ok(!plistXml.includes('GEMINI_API_KEY'), 'Gemini key хранится в focus-app-settings.json, не в plist');

  const loop = fs.readFileSync(loopPath, 'utf8');
  assert.ok(loop.includes('RANDOM') && loop.includes('sleep'), 'Ожидался sleep с RANDOM между min и max');

  const sh = fs.readFileSync(capturePath, 'utf8');
  assert.ok(sh.includes('focus-capture'), 'Скрипт должен вызывать focus-capture (Swift/ScreenCaptureKit)');
  assert.ok(sh.includes('ioreg') && sh.includes('HIDIdleTime'), 'Проверка простоя через ioreg');
});
