const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const driver = require('./fixtures/sql-dialect/run.cjs')
const dm = require('./fixtures/sql-dialect/run-dm.cjs')

// 默认仅检验合成材料和记录器；实际数据库执行必须显式启用并提供准确工具路径。
test('SQL batch comparison normalizes CRLF without losing rows or NULL values', () => {
  assert.equal(driver.batchText('1\r\n2\r\nNULL\r\n'), '1\n2\nNULL')
  assert.equal(driver.batchText(''), '')
  assert.equal(driver.batchText('2026-11-22 09:30:45.123\r\n'), '2026-11-22 09:30:45.123')
})

test('SQL result requires every executed check and successful own-instance shutdown', () => {
  const complete = { steps: driver.REQUIRED_CHECKS.map(name => ({ name, ok: true })) }
  assert.equal(driver.completeResult(complete), true)
  assert.equal(driver.completeResult({ steps: complete.steps.slice(1) }), false)
  assert.equal(driver.completeResult({ steps: complete.steps.map(step => step.name === 'port-released' ? { ...step, ok: false } : step) }), false)
  assert.equal(driver.completeResult({ steps: [] }), false)
})

test('SQL startup binding evidence requires its own process and an explicit IPv4 loopback socket', () => {
  const startup = "mysqld (mysqld 5.7.26) starting as process 42 ...\nServer hostname (bind-address): '127.0.0.1'; port: 18735\nServer socket created on IP: '127.0.0.1'.\nmysqld: ready for connections.\n"
  const evidence = driver.startupBinding(startup, 42)
  assert.equal(evidence.verified, true)
  assert.equal(evidence.osIndependent, false)
  assert.equal(driver.startupBinding(startup, 43).verified, false)
  assert.equal(driver.startupBinding(startup.replace(/127\.0\.0\.1/g, '0.0.0.0'), 42).verified, false)
  assert.equal(driver.startupBinding(startup + "Server socket created on IP: '::'.\n", 42).verified, false)
  assert.equal(driver.startupBinding(startup.replace('ready for connections.', 'startup incomplete'), 42).verified, false)
})

test('SQL fixtures contain only synthetic tables and explicit dialect differences', () => {
  const mysql = fs.readFileSync(path.join(driver.HERE, 'schema-mysql.sql'), 'utf8')
  const dm = fs.readFileSync(path.join(driver.HERE, 'schema-dm.sql'), 'utf8')
  for (const sql of [mysql, dm]) {
    for (const clause of ['PRIMARY KEY', 'UNIQUE', 'NOT NULL']) assert.ok(sql.includes(clause))
    assert.match(sql, /fbx_validation_device/)
    assert.match(sql, /fbx_validation_event/)
    assert.doesNotMatch(sql, /jdbc:|password\s*=|smsnotice|CREATE\s+DATABASE/i)
  }
  assert.match(mysql, /AUTO_INCREMENT/)
  assert.match(dm, /IDENTITY\(1,1\)/)
})

// --- DM runner (run-dm.cjs) public-seam behavior regressions: pure Node, no database ---
// Seams mirror the MySQL driver family (startupBinding/completeResult are tested the
// same way there). Expected values come from the approved boundary (127.0.0.1:18736,
// FBXVAL) and from the observed dm-runtime-20261122-04 failure evidence, never from
// recomputing the implementation.

test('DM runner stays on the approved loopback address, port and synthetic instance name', () => {
  assert.equal(dm.HOST, '127.0.0.1')
  assert.equal(dm.PORT, 18736)
  assert.equal(dm.DB_NAME, 'FBXVAL')
})

test('DM dm.ini surgery is exact-match and reports absent or duplicated keys instead of guessing', () => {
  const ini = ['[SVR]', 'PORT_NUM=5236', '# LISTEN_IP=0.0.0.0 is a comment and must stay one', 'IPV6_LSNR=1', ''].join('\n')
  const edited = dm.setIniKey(dm.setIniKey(dm.setIniKey(ini, 'PORT_NUM', String(dm.PORT)), 'LISTEN_IP', dm.HOST), 'IPV6_LSNR', '0')
  assert.deepEqual(dm.parseIniKeys(edited, ['PORT_NUM', 'LISTEN_IP', 'IPV6_LSNR']),
    { PORT_NUM: String(dm.PORT), LISTEN_IP: '127.0.0.1', IPV6_LSNR: '0' })
  assert.ok(edited.split('\n').some(line => line.startsWith('# LISTEN_IP=0.0.0.0')), 'comment line must stay untouched')
  assert.equal(dm.parseIniKeys('PORT_NUM=18736\r\n', ['LISTEN_IP']).LISTEN_IP, 'ABSENT')
  assert.equal(dm.setIniKey('PORT_NUM=18736\r\n', 'LISTEN_IP', '127.0.0.1').includes('LISTEN_IP=127.0.0.1'), true)
  assert.equal(dm.parseIniKeys('LISTEN_IP=127.0.0.1\nLISTEN_IP=0.0.0.0\n', ['LISTEN_IP']).LISTEN_IP, 'MULTIPLE(2)')
})

test('DM disql error channel: [-NNNNN] markers on an exit-0 transcript are errors, never success', () => {
  const ok = '1\n\n已用时间: 0. 200(毫秒). 执行号: 1.\n'
  assert.deepEqual(dm.rowsOf(ok), [['1']])
  assert.deepEqual(dm.errorLines(ok), [])
  // disql keeps exit code 0 when a statement fails; the [-NNNNN] line is the only signal
  const failed = '[-70028]: 用户名或密码错误\n[-21001]: 无结果\n已用时间: 0. 456(毫秒). 执行号: 0.\n'
  assert.deepEqual(dm.errorLines(failed), ['[-70028]: 用户名或密码错误', '[-21001]: 无结果'])
  assert.equal(dm.rowsOf(failed).some(row => row.length === 1 && row[0] === '1'), false,
    'an error transcript must never yield the success row')
  // a transcript that carries both a row and an error: rowsOf still tokenizes the error
  // line as leftover tokens, so the [-NNNNN] marker surfaced by errorLines is the ONLY
  // rejection signal — callers must combine rows plus errorLines, never rows alone
  const mixed = '1\n[-6112]: 字符串转换出错\n已用时间: 0. 100(毫秒).\n'
  assert.equal(dm.errorLines(mixed).length, 1)
  assert.equal(dm.rowsOf(mixed).some(row => row.length === 1 && row[0] === '1'), true)
  // disql prints a row-number column; parsing keeps values only
  assert.deepEqual(dm.rowsOf('1           2026-11-22\n2           2026-11-23\n'), [['2026-11-22'], ['2026-11-23']])
})

test('DM completeResult rejects aborted, failed, renamed-away or incomplete step lists', () => {
  const all = dm.REQUIRED_CHECKS.map(name => ({ name, ok: true }))
  assert.equal(dm.completeResult({ aborted: false, steps: all }), true)
  assert.equal(dm.completeResult({ aborted: true, steps: all }), false)
  assert.equal(dm.completeResult({ aborted: false, steps: all.slice(1) }), false, 'a missing required step must not pass')
  assert.equal(dm.completeResult({ aborted: false, steps: all.map(s => s.name === 'loopback-binding' ? { name: 'binding-ok', ok: true } : s) }), false,
    'renaming a required step away must not pass')
  assert.equal(dm.completeResult({ aborted: false, steps: all.map(s => s.name === 'loopback-binding' ? { ...s, ok: false } : s) }), false)
  assert.equal(dm.completeResult({ aborted: false, steps: [] }), false)
  assert.equal(dm.completeResult(null), false)
  assert.equal(dm.completeResult({ aborted: false, steps: all.concat([{ name: 'autocommit-probe', ok: false }]) }), false,
    'a failing informational step also fails the run')
  assert.equal(dm.completeResult({ aborted: false, steps: all.concat([{ name: 'autocommit-probe', ok: true }]) }), true,
    'passing informational steps (autocommit-probe, paging-seed, pages) are allowed')
})

test('DM REQUIRED_CHECKS keeps every fail-closed critical step', () => {
  for (const critical of ['port-precheck', 'dminit-version', 'dm-ini-explicit-config', 'dmserver-start',
    'credential-bootstrap', 'runtime-instance-identity', 'loopback-binding', 'default-credential-rejected',
    'ddl-synthetic-schema', 'shutdown-own-instance', 'port-released']) {
    assert.ok(dm.REQUIRED_CHECKS.includes(critical), 'REQUIRED_CHECKS lost ' + critical)
  }
  assert.equal(new Set(dm.REQUIRED_CHECKS).size, dm.REQUIRED_CHECKS.length, 'duplicate required check names')
})

// The all-good shape mirrors the documented proof chain (loopback survives the 3.5s hold,
// every non-loopback address refuses, same-IP closed-port baseline refuses too).
const dmBindingGood = {
  configExact: true,
  readbackExact: true,
  loopbackProbe: { ip: '127.0.0.1', port: 18736, phase: 'connected', closedEarly: false, stillOpenAfterHold: true },
  externalResults: [{ ip: '198.18.0.1', port: 18736, phase: 'refused', closedEarly: false, stillOpenAfterHold: false }],
  baselineResult: { ip: '198.18.0.1', port: 59999, phase: 'refused', closedEarly: false, stillOpenAfterHold: false },
  dbName: 'FBXVAL',
  allPathsInside: true
}

test('DM loopback binding verdict passes only the full functional proof chain', () => {
  assert.equal(dm.loopbackBindingVerdict(dmBindingGood).verified, true)
  assert.equal(dm.loopbackBindingVerdict({ ...dmBindingGood, configExact: false }).verified, false,
    'config values alone never prove binding')
  assert.equal(dm.loopbackBindingVerdict({ ...dmBindingGood, readbackExact: false }).verified, false,
    'runtime readback alone never proves binding')
  assert.equal(dm.loopbackBindingVerdict({ ...dmBindingGood, loopbackProbe: { ...dmBindingGood.loopbackProbe, closedEarly: true, stillOpenAfterHold: false } }).verified, false,
    'loopback must survive the hold, not just accept once')
  assert.equal(dm.loopbackBindingVerdict({ ...dmBindingGood, dbName: 'OTHER' }).verified, false)
  assert.equal(dm.loopbackBindingVerdict({ ...dmBindingGood, allPathsInside: false }).verified, false)
})

test('DM-04 observed failure shape stays rejected: a non-loopback address that keeps the connection open fails the run', () => {
  // Verbatim probe results from .validation-output/release-validation/sql/dm-runtime-20261122-04/report.json
  const dm04 = {
    configExact: true,
    readbackExact: true,
    loopbackProbe: { ip: '127.0.0.1', port: 18736, phase: 'connected', closedEarly: false, stillOpenAfterHold: true },
    externalResults: [
      { ip: '198.18.0.1', port: 18736, phase: 'connected', closedEarly: false, stillOpenAfterHold: true },
      { ip: '192.168.199.100', port: 18736, phase: 'connected', closedEarly: false, stillOpenAfterHold: true },
      { ip: '192.168.32.1', port: 18736, phase: 'connected', closedEarly: false, stillOpenAfterHold: true }
    ],
    baselineResult: { ip: '198.18.0.1', port: 59999, phase: 'refused', closedEarly: false, stillOpenAfterHold: false },
    dbName: 'FBXVAL',
    allPathsInside: true
  }
  const verdict = dm.loopbackBindingVerdict(dm04)
  assert.equal(verdict.realExternalListening, true)
  assert.equal(verdict.externalAllSafe, false)
  assert.equal(verdict.verified, false)
})

test('DM connected-then-closed external probes count only with an identical same-IP closed-port baseline', () => {
  const intercepted = { ip: '198.18.0.1', port: 18736, phase: 'connected', closedEarly: true, stillOpenAfterHold: false }
  const baselineMatching = { ip: '198.18.0.1', port: 59999, phase: 'connected', closedEarly: true, stillOpenAfterHold: false }
  const baselineRefused = { ip: '198.18.0.1', port: 59999, phase: 'refused', closedEarly: false, stillOpenAfterHold: false }
  assert.equal(dm.loopbackBindingVerdict({ ...dmBindingGood, externalResults: [intercepted], baselineResult: baselineMatching }).verified, true,
    'the interception-artifact exception needs the identical baseline signature')
  assert.equal(dm.loopbackBindingVerdict({ ...dmBindingGood, externalResults: [intercepted], baselineResult: baselineRefused }).verified, false,
    'a refused baseline proves the external address is really reachable')
  assert.equal(dm.loopbackBindingVerdict({ ...dmBindingGood, externalResults: [intercepted], baselineResult: null }).verified, false,
    'no baseline, no exception')
})

test('real MySQL DDL, constraints, paging and transactions', {
  skip: process.env.FB_RELEASE_SQL !== '1' && 'Enable FB_RELEASE_SQL=1 and FB_MYSQL_BIN for a fresh synthetic loopback instance; static checks are not database execution.'
}, async () => {
  const result = await driver.run({ mysqlBin: process.env.FB_MYSQL_BIN, outputId: 'mysql-test-' + Date.now() })
  assert.equal(driver.completeResult(result), true, 'Actual failures are retained in ' + result.reportFile)
})

test('DM runtime is not substituted by MySQL or DDL text', {
  skip: 'DM runtime execution currently FAILS closed: the real runner was attempted (latest output ' +
    'dm-runtime-20261122-04, hash 81145e1d7a467a286cdff922122aea54b92b4b12f3884a149fe0a00d7a34e555) and aborted at ' +
    'loopback-binding - dm.ini and V$DM_INI carried exact LISTEN_IP=127.0.0.1/PORT_NUM=18736/IPV6_LSNR=0, yet TCP ' +
    'connections to every probed non-loopback local IPv4 address (198.18.0.1, 192.168.199.100, 192.168.32.1) stayed ' +
    'open past the 3.5s hold while the same-IP closed-port baseline (59999) was refused, proving real external ' +
    'listening; own pid 73208 was SIGTERM-stopped, port released, business DDL never executed. Until a loopback-only ' +
    'bind is confirmed in an approved environment, no DM database execution is claimed and the prepared schema stays ' +
    'prepared-only material.'
}, () => assert.fail('A prepared schema is not an executed DM database'))
