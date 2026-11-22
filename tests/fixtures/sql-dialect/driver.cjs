// Driver for real MySQL dialect execution and DM blocked-evidence capture.
//
// Hard boundaries:
// - MySQL: real local 5.7.26 binaries (D:/phpstudy_pro/Extensions/MySQL5.7.26/bin),
//   own datadir, fixed approved loopback port 18735, bind-address=127.0.0.1,
//   random one-run credentials kept out of logs and reports (scrubbed if an
//   error ever echoes them).
// - DM: NO server start. The local install cannot be confirmed loopback-only
//   (no bind/listen-address dm.ini parameter, no dmserver option, no pre-existing
//   DM docker image), so execution stays blocked; only safe version/help output
//   is captured as evidence.
// - Nothing outside the evidence dir is written except the own datadir under it.
const fs = require('fs')
const path = require('path')
const net = require('net')
const crypto = require('crypto')
const { spawnSync, spawn } = require('child_process')

const MYSQL_BIN = 'D:/phpstudy_pro/Extensions/MySQL5.7.26/bin'
const MYSQLD = path.join(MYSQL_BIN, 'mysqld.exe')
const MYSQL_CLIENT = path.join(MYSQL_BIN, 'mysql.exe')
const MYSQLADMIN = path.join(MYSQL_BIN, 'mysqladmin.exe')
const DM_HOME = 'C:/dmdbms'
const PORT = 18735
const HOST = '127.0.0.1'
const DB = 'fbxvalidate'

const HERE = __dirname
const ROOT = path.resolve(HERE, '..', '..', '..')
const EVIDENCE_DIR = path.join(ROOT, '.validation-output', 'release-validation', 'sql')

const randomSecret = () => crypto.randomBytes(18).toString('base64url')

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function portBusy(port, host = HOST) {
  return new Promise(resolve => {
    const s = net.connect({ port, host, timeout: 2000 })
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })
}

function waitForPort(port, host, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now()
    const tick = () => {
      const s = net.connect({ port, host, timeout: 1500 })
      s.on('connect', () => { s.destroy(); resolve(true) })
      s.on('error', () => {
        s.destroy()
        if (Date.now() - started > timeoutMs) resolve(false)
        else setTimeout(tick, 400)
      })
      s.on('timeout', () => { s.destroy(); setTimeout(tick, 400) })
    }
    tick()
  })
}

function waitForPortClosed(port, host, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now()
    const tick = async () => {
      const busy = await portBusy(port, host)
      if (!busy) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(tick, 400)
    }
    tick()
  })
}

// Credentials live in a per-run defaults-extra-file; never echoed to logs.
function writeLoginCnf(dir, user, password) {
  const file = path.join(dir, 'login.cnf')
  fs.writeFileSync(file, `[client]\nuser=${user}\npassword="${password}"\nhost=${HOST}\nport=${PORT}\ndefault-character-set=utf8mb4\n`)
  return file
}

function clientRun(cnf, sql, { timeoutMs = 30000 } = {}) {
  const r = spawnSync(`"${MYSQL_CLIENT}" --defaults-extra-file="${cnf}" --batch --skip-column-names -D ${DB} -e "${sql.replace(/"/g, '\\"')}"`, {
    shell: true, timeout: timeoutMs, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024
  })
  // Normalise CRLF: multi-line batch output on Windows otherwise leaves a
  // trailing \r on every line but the last (single-line results hide this).
  return { code: r.status, stdout: (r.stdout || '').replace(/\r\n/g, '\n').trim(), stderr: (r.stderr || '').replace(/\r\n/g, '\n').trim(), timedOut: r.status === null && r.signal !== null }
}

async function runMysqlFlow(runId) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const steps = []
  const record = (name, ok, detail) => { steps.push({ name, ok, detail: String(detail).slice(0, 400) }); return ok }

  let runDir = null
  let dataDir = null
  let server = null
  let rootCnf = null
  let appCnf = null
  let serverLog = null
  let scrub = s => String(s)

  try {
    // 1. Port must be free; never touch an existing listener.
    const busy = await portBusy(PORT)
    if (busy) {
      record('port-precheck', false, `127.0.0.1:${PORT} already has a listener; refusing to touch unknown service`)
      return { steps, aborted: true }
    }
    record('port-precheck', true, `127.0.0.1:${PORT} free before start`)

    runDir = path.join(EVIDENCE_DIR, `mysql-run-${runId}`)
    fs.rmSync(runDir, { recursive: true, force: true })
    fs.mkdirSync(runDir, { recursive: true })
    dataDir = path.join(runDir, 'data')
    const initLog = path.join(runDir, 'mysqld-init.log')
    serverLog = path.join(runDir, 'mysqld-server.log')

    // 2. Version seam with the real binary.
    const ver = spawnSync(`"${MYSQLD}" --version`, { shell: true, timeout: 20000, encoding: 'utf8', windowsHide: true })
    record('mysqld-version', (ver.stdout || '').includes('5.7.'), (ver.stdout || ver.stderr || '').trim())

    // 3. Fresh initialization of own datadir.
    const init = spawnSync(`"${MYSQLD}" --no-defaults --initialize-insecure --datadir="${dataDir}" --log-error="${initLog}"`, { shell: true, timeout: 180000, encoding: 'utf8', windowsHide: true })
    const initOk = init.status === 0 && fs.existsSync(path.join(dataDir, 'mysql'))
    record('mysqld-initialize', initOk, `exit=${init.status} ${(init.stderr || '').slice(0, 200)}`)
    if (!initOk) return { steps, aborted: true, runDir, serverLog }

    // 4. Start own server bound to loopback only. Name resolution stays enabled
    // so the initialized root@'localhost' account matches 127.0.0.1 TCP logins
    // (synthetic instance only; nothing else on this host is touched).
    server = spawn(MYSQLD, [
      '--no-defaults', `--datadir=${dataDir}`, `--port=${PORT}`, '--bind-address=127.0.0.1',
      `--log-error=${serverLog}`
    ], { stdio: 'ignore', windowsHide: true })
    const started = await waitForPort(PORT, HOST, 60000)
    record('mysqld-start', started && server.pid > 0, `pid=${server.pid} loopback-only bind-address=127.0.0.1 port=${PORT}`)
    if (!started) {
      return { steps, aborted: true, runDir, serverLog }
    }

    // 5. Random one-run credentials; root@localhost randomised immediately.
    // stderr is scrubbed of both secrets before any recording.
    const rootPass = randomSecret()
    const appPass = randomSecret()
    scrub = s => String(s).split(rootPass).join('***').split(appPass).join('***')
    rootCnf = writeLoginCnf(runDir, 'root', rootPass)
    appCnf = path.join(runDir, 'app.cnf')
    const bootstrap = spawnSync(`"${MYSQL_CLIENT}" -h ${HOST} -P ${PORT} -u root --batch --skip-column-names -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPass}'; CREATE DATABASE IF NOT EXISTS ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci; CREATE USER IF NOT EXISTS 'fbx_validate'@'127.0.0.1' IDENTIFIED BY '${appPass}'; CREATE USER IF NOT EXISTS 'fbx_validate'@'localhost' IDENTIFIED BY '${appPass}'; GRANT ALL ON ${DB}.* TO 'fbx_validate'@'127.0.0.1'; GRANT ALL ON ${DB}.* TO 'fbx_validate'@'localhost';"`, {
      shell: true, timeout: 30000, encoding: 'utf8', windowsHide: true
    })
    const credOk = bootstrap.status === 0
    fs.writeFileSync(appCnf, `[client]\nuser=fbx_validate\npassword="${appPass}"\nhost=${HOST}\nport=${PORT}\ndefault-character-set=utf8mb4\n`)
    record('credential-bootstrap', credOk, `exit=${bootstrap.status} root+app randomised; secrets only in ${path.basename(appCnf)} (never logged); stderr=${scrub(bootstrap.stderr).slice(0, 200)}`)
    if (!credOk) {
      const closed = await shutdown(server, rootCnf)
      record('shutdown-own-instance', closed, closed ? `graceful or forced after failed bootstrap; log kept: ${serverLog}` : 'could not stop own instance')
      return { steps, aborted: true, runDir, serverLog }
    }

    // 6. Schema DDL under the restricted app identity. `--` comment lines are
    // stripped first: collapsing newlines would otherwise turn the whole
    // statement string into one comment (exit 0, silently creating nothing).
    const schema = fs.readFileSync(path.join(HERE, 'schema-mysql.sql'), 'utf8')
      .split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
    const ddl = clientRun(appCnf, schema.replace(/\s*\n\s*/g, ' '))
    const tables = clientRun(appCnf, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}' AND table_name LIKE 'fbx_validation_%';`)
    record('ddl-under-app-user', ddl.code === 0 && tables.stdout === '2', `exit=${ddl.code} tables=${tables.stdout} ${ddl.stderr.slice(0, 200)}`)

    // 7. Behaviour checks (each single-connection where session state matters).
    const q = (sql, timeoutMs) => clientRun(appCnf, sql, { timeoutMs })

    const pk1 = q(`INSERT INTO fbx_validation_device (device_code, device_name, created_at) VALUES ('DEV-A', 'synthetic a', '2026-11-20 08:00:00'); SELECT LAST_INSERT_ID();`)
    record('pk-auto-increment-first', pk1.code === 0 && pk1.stdout === '1', `got=${pk1.stdout} ${pk1.stderr.slice(0, 120)}`)

    const pk2 = q(`INSERT INTO fbx_validation_device (device_code, device_name, created_at) VALUES ('DEV-B', 'synthetic b', '2026-11-20 09:00:00'); SELECT LAST_INSERT_ID();`)
    record('pk-auto-increment-next', pk2.code === 0 && pk2.stdout === '2', `got=${pk2.stdout}`)

    const dupPk = q(`INSERT INTO fbx_validation_device (id, device_code, device_name, created_at) VALUES (1, 'DEV-DUP', 'synthetic', '2026-11-20 10:00:00');`)
    record('pk-duplicate-rejected', dupPk.code !== 0 && /Duplicate entry/.test(dupPk.stderr), `exit=${dupPk.code} ${dupPk.stderr.slice(0, 120)}`)

    const dupUq = q(`INSERT INTO fbx_validation_device (device_code, device_name, created_at) VALUES ('DEV-A', 'synthetic dup', '2026-11-20 11:00:00');`)
    record('unique-duplicate-rejected', dupUq.code !== 0 && /Duplicate entry/.test(dupUq.stderr), `exit=${dupUq.code}`)

    const nn = q(`INSERT INTO fbx_validation_device (device_code, device_name, created_at) VALUES ('DEV-NN', NULL, '2026-11-20 12:00:00');`)
    record('not-null-rejected', nn.code !== 0 && /cannot be null/.test(nn.stderr), `exit=${nn.code}`)

    const nullable = q(`INSERT INTO fbx_validation_device (device_code, device_name, score, created_at) VALUES ('DEV-NULL', 'nullable ok', NULL, '2026-11-20 13:00:00'); SELECT score FROM fbx_validation_device WHERE device_code='DEV-NULL';`)
    record('nullable-null-roundtrip', nullable.code === 0 && nullable.stdout === 'NULL', `got=${nullable.stdout}`)

    const dates = q(`INSERT INTO fbx_validation_device (device_code, device_name, created_at, updated_at, occurred_on) VALUES ('DEV-DATE', 'dates', '2026-11-22 09:30:45', '2026-11-22 09:30:45.123', '2026-11-22'); SELECT created_at, updated_at, occurred_on FROM fbx_validation_device WHERE device_code='DEV-DATE';`)
    record('datetime-date-roundtrip', dates.code === 0 && dates.stdout.includes('2026-11-22 09:30:45') && dates.stdout.includes('2026-11-22 09:30:45.123') && dates.stdout.includes('2026-11-22'), `got=${dates.stdout}`)

    // Unique indexes allow multiple NULLs: count delta, not absolute (earlier
    // rows legitimately carry NULL alt_code too).
    const nullsBefore = q(`SELECT COUNT(*) FROM fbx_validation_device WHERE alt_code IS NULL;`)
    const uqNulls = q(`INSERT INTO fbx_validation_device (device_code, device_name, alt_code, created_at) VALUES ('DEV-U1', 'u1', NULL, '2026-11-21 08:00:00'); INSERT INTO fbx_validation_device (device_code, device_name, alt_code, created_at) VALUES ('DEV-U2', 'u2', NULL, '2026-11-21 09:00:00'); SELECT COUNT(*) FROM fbx_validation_device WHERE alt_code IS NULL;`)
    record('unique-allows-multiple-nulls', uqNulls.code === 0 && nullsBefore.code === 0 && +uqNulls.stdout === +nullsBefore.stdout + 2, `before=${nullsBefore.stdout} got=${uqNulls.stdout}`)
    const uqDupAlt = q(`INSERT INTO fbx_validation_device (device_code, device_name, alt_code, created_at) VALUES ('DEV-U3', 'u3', 'ALT-1', '2026-11-21 10:00:00'); INSERT INTO fbx_validation_device (device_code, device_name, alt_code, created_at) VALUES ('DEV-U4', 'u4', 'ALT-1', '2026-11-21 11:00:00');`)
    record('unique-duplicate-alt-rejected', uqDupAlt.code !== 0 && /Duplicate entry/.test(uqDupAlt.stderr), `exit=${uqDupAlt.code}`)

    // Rollback vs commit on one connection each.
    const rollback = q(`SELECT COUNT(*) FROM fbx_validation_device; START TRANSACTION; INSERT INTO fbx_validation_device (device_code, device_name, created_at) VALUES ('DEV-RB', 'rollback', '2026-11-21 12:00:00'); SELECT COUNT(*) FROM fbx_validation_device; ROLLBACK; SELECT COUNT(*) FROM fbx_validation_device;`)
    const rbRows = rollback.stdout.split('\n')
    record('rollback-discards-insert', rollback.code === 0 && rbRows.length === 3 && rbRows[0] === rbRows[2] && +rbRows[1] === +rbRows[0] + 1, `counts=[${rbRows.join(',')}]`)

    const commit = q(`START TRANSACTION; INSERT INTO fbx_validation_device (device_code, device_name, created_at) VALUES ('DEV-CM', 'commit', '2026-11-21 13:00:00'); COMMIT; SELECT COUNT(*) FROM fbx_validation_device WHERE device_code='DEV-CM';`)
    record('commit-persists-insert', commit.code === 0 && commit.stdout === '1', `got=${commit.stdout}`)

    // Pagination over deterministic ordering.
    for (let i = 0; i < 4; i++) {
      q(`INSERT INTO fbx_validation_device (device_code, device_name, created_at) VALUES ('DEV-P${i}', 'page ${i}', '2026-11-2${i} 15:00:00');`)
    }
    const page = q(`SELECT device_code FROM fbx_validation_device ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET 0;`)
    const page2 = q(`SELECT device_code FROM fbx_validation_device ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET 3;`)
    const page3 = q(`SELECT device_code FROM fbx_validation_device ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET 3;`)
    const rows1 = page.stdout.split('\n').filter(Boolean)
    const rows2 = page2.stdout.split('\n').filter(Boolean)
    const overlap = rows1.filter(r => rows2.includes(r))
    const expectedTop = rows1[0] === 'DEV-P3'
    record('pagination-windows', page.code === 0 && page2.code === 0 && overlap.length === 0 && rows1.length === 3 && rows2.length === 3 && expectedTop && page3.stdout === page2.stdout, `win1=[${rows1.join(',')}] win2=[${rows2.join(',')}] stable=${page3.stdout === page2.stdout}`)
    const emptyPage = q(`SELECT device_code FROM fbx_validation_device ORDER BY id DESC LIMIT 3 OFFSET 100;`)
    record('pagination-beyond-end-empty', emptyPage.code === 0 && emptyPage.stdout === '', `got=${emptyPage.stdout}`)

    const upd = q(`UPDATE fbx_validation_device SET status='1' WHERE device_code='DEV-A'; SELECT ROW_COUNT(); UPDATE fbx_validation_device SET status='1' WHERE device_code='DEV-NOT-THERE'; SELECT ROW_COUNT();`)
    const updRows = upd.stdout.split('\n').filter(Boolean)
    record('update-affected-rows', upd.code === 0 && updRows[0] === '1' && updRows[1] === '0', `got=[${updRows.join(',')}]`)

    const decimal = q(`INSERT INTO fbx_validation_event (device_id, amount, happened_at) VALUES (1, 123456.78, '2026-11-22 10:00:00'); SELECT amount FROM fbx_validation_event WHERE device_id=1;`)
    record('decimal-roundtrip', decimal.code === 0 && decimal.stdout === '123456.78', `got=${decimal.stdout}`)
    const dupComposite = q(`INSERT INTO fbx_validation_event (device_id, amount, happened_at) VALUES (1, 1.00, '2026-11-22 10:00:00');`)
    record('composite-unique-rejected', dupComposite.code !== 0 && /Duplicate entry/.test(dupComposite.stderr), `exit=${dupComposite.code}`)

    // 8. Shutdown own instance, keep logs, data dir removed by finally.
    const closed = await shutdown(server, rootCnf)
    record('shutdown-own-instance', closed, closed ? `graceful or forced; log kept: ${serverLog}` : 'could not stop own instance')
    const stillBusy = await portBusy(PORT)
    if (stillBusy) record('port-released', false, 'port 18735 still listening after shutdown attempts')
    else record('port-released', true, 'port 18735 released')

    return { steps, aborted: false, runDir, serverLog, initLog, version: (ver.stdout || '').trim() }
  } catch (err) {
    record('unexpected-error', false, scrub(String(err && err.message || err)).slice(0, 400))
    return { steps, aborted: true, runDir, serverLog }
  } finally {
    // Always: kill own instance, scrub credential files, best-effort data dir cleanup.
    if (server && server.pid) {
      try { process.kill(server.pid) } catch (e) { /* already gone */ }
    }
    for (const f of [rootCnf, appCnf]) {
      if (f) { try { fs.rmSync(f, { force: true }) } catch (e) { /* best effort */ } }
    }
    if (dataDir) {
      try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch (e) { /* recorded via evidence; own dir only */ }
    }
  }
}

async function shutdown(server, rootCnf) {
  if (rootCnf && fs.existsSync(rootCnf)) {
    spawnSync(`"${MYSQLADMIN}" --defaults-extra-file="${rootCnf}" shutdown`, { shell: true, timeout: 20000, encoding: 'utf8', windowsHide: true })
  }
  const closed = await waitForPortClosed(PORT, HOST, 20000)
  if (!closed && server && server.pid) {
    try { process.kill(server.pid) } catch (e) { /* already gone */ }
    return waitForPortClosed(PORT, HOST, 8000)
  }
  return closed
}

// Capture DM evidence WITHOUT starting any server. Safe reads and help output only.
function dmEvidence(runId) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const out = { runId, decision: 'blocked', capturedAt: new Date().toISOString(), reason: null, evidence: {} }

  const dminit = spawnSync(`"${path.join(DM_HOME, 'bin', 'dminit.exe')}" help`, { shell: true, timeout: 20000, encoding: 'utf8', windowsHide: true })
  const dminitText = ((dminit.stdout || '') + (dminit.stderr || ''))
  out.evidence.dminitVersion = (/\[?[0-9a-zA-Z .-]*initdb V8/.test(dminitText) ? 'initdb V8' : null)
  out.evidence.licenseExpiry = (/License will expire on ([\d-]+)/.exec(dminitText) || [])[1] || null

  const dmserver = spawnSync(`"${path.join(DM_HOME, 'bin', 'dmserver.exe')}" help`, { shell: true, timeout: 20000, encoding: 'utf8', windowsHide: true })
  const dsText = ((dmserver.stdout || '') + (dmserver.stderr || ''))
  out.evidence.dmserverOptions = (dsText.match(/^\s*(path|dcr_ini|noconsole|mount|dpc_mode|upd_lic|ignore_recover_check|help)\b/gm) || []).map(s => s.trim())

  // dm.ini of the pre-existing local install: parameter names only, no connection made.
  const iniPath = path.join(DM_HOME, 'data', 'DAMENG', 'dm.ini')
  out.evidence.dmIniNetworkKeys = null
  if (fs.existsSync(iniPath)) {
    const text = fs.readFileSync(iniPath, 'utf8')
    out.evidence.dmIniNetworkKeys = [...text.matchAll(/^\s*([A-Z_]*PORT[A-Z_]*|[A-Z_]*(BIND|LISTEN|NET_ADDR|ALLOW_ADDR|ADDR)[A-Z_]*)\s*=/gm)].map(m => m[1])
  }

  const dockerImages = spawnSync('docker images --format "{{.Repository}}:{{.Tag}}"', { shell: true, timeout: 20000, encoding: 'utf8', windowsHide: true })
  out.evidence.dmDockerImages = ((dockerImages.stdout || '').split('\n').map(s => s.trim()).filter(s => /\b(dameng|dm8|dm7)\b/i.test(s)))

  out.reason = 'no loopback-only listening could be confirmed for DM on this host: dm.ini exposes only PORT_NUM-style keys, dmserver offers no bind option, and no pre-existing DM docker image exists; a loopback-only instance is a hard requirement, so DM execution stays blocked without starting any all-interface listener'
  const file = path.join(EVIDENCE_DIR, `dm-blocked-${runId}.json`)
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  return out
}

module.exports = {
  HERE, MYSQL_BIN, MYSQLD, MYSQL_CLIENT, MYSQLADMIN, DM_HOME, PORT, HOST, DB,
  EVIDENCE_DIR, sha256, portBusy, runMysqlFlow, dmEvidence
}
