/**
 * 妗ユ帴鐨勬祴璇曘€傜敤 node:test锛岄浂渚濊禆銆? *
 * 姣忎釜鐢ㄤ緥璧蜂竴涓湡瀹炵殑 server.js 瀛愯繘绋嬶紝PATH 涓婃斁涓€涓亣 awr锛? * 鐒跺悗鐢?fetch 鎵撶湡瀹炵殑 HTTP 璇锋眰鈥斺€旀祴鐨勬槸鐪熷疄鐨勮姹傝竟鐣岋紝涓嶆槸鍐呴儴鍑芥暟銆? *
 * 璺戯細node --test test/
 */

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const GUARD = { 'x-awr-inspector': '1' };

/** 閫犱竴涓?bin 鐩綍锛岄噷闈㈢殑 `awr` 鎸囧悜 stub銆俉indows 涓婄敓鎴?.cmd 鏂囦欢銆?*/
function makeStubBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awr-stub-'));
  const stub = path.join(__dirname, 'fixtures', 'stub-awr.js');
  if (process.platform === 'win32') {
    const bin = path.join(dir, 'awr.cmd');
    fs.writeFileSync(
      bin,
      `@echo off\r\n"${process.execPath}" "${stub}" %*\r\n`
    );
  } else {
    const bin = path.join(dir, 'awr');
    fs.writeFileSync(
      bin,
      `#!/bin/sh\nexec "${process.execPath}" "${stub}" "$@"\n`
    );
    fs.chmodSync(bin, 0o755);
  }
  return dir;
}

const STUB_BIN = makeStubBin();
let nextPort = 7500;

/** 璧蜂竴涓ˉ鎺ヨ繘绋嬶紝绛夊畠鐩戝惉涓婏紝杩斿洖 { port, stop }銆?*/
async function startBridge(opts = {}) {
  const port = nextPort++;
  const args = ['server.js', '--no-open', '--port', String(port), '--project', opts.project || ROOT];
  if (opts.allowReindex) args.push('--allow-reindex');
  if (opts.demo) args.push('--demo');

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: Object.assign({}, process.env, opts.env, {
      PATH: `${STUB_BIN}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('妗ユ帴鍚姩瓒呮椂')), 15000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('宸插惎鍔?)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`妗ユ帴閫€鍑轰簡锛宑ode=${code}`));
    });
  });

  return {
    port,
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise((r) => { child.on('exit', r); child.kill('SIGKILL'); }),
  };
}

let bridge;

before(async () => { bridge = await startBridge(); });
after(async () => { if (bridge) await bridge.stop(); fs.rmSync(STUB_BIN, { recursive: true, force: true }); });

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 1. 璇锋眰鏉ユ簮杈圭晫 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/** fetch 涓嶅厑璁歌鐩?Host 澶达紝鎵€浠ユ晫瀵?Host 鍙兘鐢ㄥ師濮嬭姹傛瀯閫犮€?*/
function rawRequest(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      Object.assign({ host: '127.0.0.1', port, method: 'GET' }, options),
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    if (options && options.body) req.write(options.body);
    req.end();
  });
}

test('鎷掔粷鏁屽 Host锛圖NS rebinding锛?, async () => {
  const res = await rawRequest(bridge.port, {
    path: '/api/health',
    headers: { Host: 'attacker.example' },
  });
  assert.equal(res.status, 403);
  const body = JSON.parse(res.text);
  assert.equal(body.error.code, 'ForbiddenHost');
  assert.ok(!res.text.includes('agent-work-runtime'), '涓嶅緱娉勯湶椤圭洰璺緞');
});

test('鎺ュ彈 localhost 褰㈠紡鐨?Host', async () => {
  const res = await rawRequest(bridge.port, {
    path: '/api/health',
    headers: { Host: `localhost:${bridge.port}` },
  });
  assert.equal(res.status, 200);
});

test('鎷掔粷鏁屽 Origin', async () => {
  const res = await fetch(`${bridge.base}/api/status`, {
    headers: Object.assign({ origin: 'https://example.attacker' }, GUARD),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'ForbiddenOrigin');
});

test("鎷掔粷 Origin: null", async () => {
  const res = await fetch(`${bridge.base}/api/status`, { headers: { origin: 'null' } });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'ForbiddenOrigin');
});

test('鎷掔粷璺ㄧ珯 Sec-Fetch-Site', async () => {
  const res = await fetch(`${bridge.base}/api/status`, {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'ForbiddenSite');
});

test('鎺ュ彈鍚屾簮 Sec-Fetch-Site', async () => {
  const res = await fetch(`${bridge.base}/api/status`, {
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('璺ㄧ珯琛ㄥ崟 POST 瑙﹀彂涓嶄簡 reindex', async () => {
  const res = await fetch(`${bridge.base}/api/source/reindex`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'MissingGuardHeader');
});

test('闈欐€佽祫婧愭嫆缁濈洰褰曠┛瓒?, async () => {
  const res = await fetch(`${bridge.base}/../server.js`);
  assert.ok(res.status === 403 || res.status === 404, `鏈熸湜 403/404锛屽疄闄?${res.status}`);
});

test('闈欐€佸搷搴斿甫 CSP', async () => {
  const res = await fetch(`${bridge.base}/`);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp && csp.includes("default-src 'self'"), 'CSP 澶寸己澶?);
  assert.ok(!csp.includes('unsafe-inline'), 'CSP 涓嶅簲鏀捐鍐呰仈');
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 2. 鍛戒护鏋勯€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('search 鐢ㄤ綅缃弬鏁帮紝涓嶇敤 --text', async () => {
  const argvLog = path.join(os.tmpdir(), `argv-${Date.now()}.log`);
  const b = await startBridge({ env: { STUB_ARGV_OUT: argvLog } });
  try {
    const res = await fetch(`${b.base}/api/search?text=source`, { headers: GUARD });
    const body = await res.json();
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(body.data.query.text, 'source');

    const lines = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(JSON.parse);
    const call = lines.find((a) => a.includes('search'));
    assert.ok(!call.includes('--text'), '涓嶅簲鍐嶅嚭鐜?--text');
    assert.ok(call.includes('--'), '搴旇鐢?-- 鍒嗛殧浣嶇疆鍙傛暟');
  } finally {
    await b.stop();
    fs.rmSync(argvLog, { force: true });
  }
});

test('search 鎺ュ彈涓枃', async () => {
  const res = await fetch(`${bridge.base}/api/search?text=${encodeURIComponent('浠诲姟')}`, {
    headers: GUARD,
  });
  const body = await res.json();
  assert.equal(body.ok, true, JSON.stringify(body));
  assert.equal(body.data.query.text, '浠诲姟');
});

test('search 鎺ュ彈浠?- 寮€澶寸殑璇?, async () => {
  const res = await fetch(`${bridge.base}/api/search?text=${encodeURIComponent('-flag')}`, {
    headers: GUARD,
  });
  const body = await res.json();
  assert.equal(body.ok, true, JSON.stringify(body));
  assert.equal(body.data.query.text, '-flag');
});

test('search 鎷掔粷鎺у埗瀛楃', async () => {
  const withNul = 'a' + String.fromCharCode(0) + 'b';
  const res = await fetch(`${bridge.base}/api/search?text=${encodeURIComponent(withNul)}`, {
    headers: GUARD,
  });
  assert.equal((await res.json()).error.code, 'BadRequest');
});

test('--project 鍚┖鏍肩殑璺緞姝ｅ父宸ヤ綔', async () => {
  // 璇勫鎸囧嚭锛歴hell: true 涓嬪弬鏁版嫾鎺ヤ細鎶婄┖鏍艰矾寰勬媶鎴愬涓弬鏁般€?  // shell: false 涓嬪弬鏁版槸鏁扮粍浼犻€掞紝涓嶅彈绌烘牸褰卞搷銆?  const argvLog = path.join(os.tmpdir(), `argv-space-${Date.now()}.log`);
  const spaceDir = path.join(os.tmpdir(), 'project with spaces');
  fs.mkdirSync(spaceDir, { recursive: true });
  try {
    const b = await startBridge({ project: spaceDir, env: { STUB_ARGV_OUT: argvLog } });
    try {
      await fetch(`${b.base}/api/status`, { headers: GUARD });
      const lines = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(JSON.parse);
      const call = lines.find((a) => a.includes('status'));
      // --project 鍚庨潰搴旇鏄畬鏁寸殑璺緞锛堝惈绌烘牸锛夛紝涓嶅簲璇ヨ鎷嗗紑
      const projectIdx = call.indexOf('--project');
      const projectValue = call[projectIdx + 1];
      assert.ok(projectValue.includes('project with spaces'),
        `璺緞琚┖鏍兼媶寮€: ${JSON.stringify(call)}`);
    } finally {
      await b.stop();
    }
  } finally {
    fs.rmSync(spaceDir, { recursive: true, force: true });
    fs.rmSync(argvLog, { force: true });
  }
});

test('search 鏂囨湰鍚?shell 鍏冨瓧绗︿笉浼氳瑙ｉ噴', async () => {
  // 璇勫鎸囧嚭锛歴hell: true 涓?& | ^ > 绛夊厓瀛楃浼氳 shell 瑙ｉ噴銆?  const argvLog = path.join(os.tmpdir(), `argv-meta-${Date.now()}.log`);
  const b = await startBridge({ env: { STUB_ARGV_OUT: argvLog } });
  try {
    const text = 'test&echo|injected';
    const res = await fetch(`${b.base}/api/search?text=${encodeURIComponent(text)}`, {
      headers: GUARD,
    });
    const body = await res.json();
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(body.data.query.text, text);
    // 纭鍙傛暟鍘熸牱浼犻€掞紝娌℃湁琚?shell 鎴柇
    const lines = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(JSON.parse);
    const call = lines.find((a) => a.includes('search'));
    assert.ok(call.includes(text), `鍏冨瓧绗︽悳绱㈣瘝鏈師鏍蜂紶閫? ${JSON.stringify(call)}`);
  } finally {
    await b.stop();
    fs.rmSync(argvLog, { force: true });
  }
});

test('涓€娆″潖璇锋眰涓嶄細鏀瑰彉 --json 鐨勪綅缃?, async () => {
  const argvLog = path.join(os.tmpdir(), `argv2-${Date.now()}.log`);
  const b = await startBridge({ env: { STUB_ARGV_OUT: argvLog } });
  try {
    // 鍏堟墦涓€涓細璁?stub 鎶?"unexpected argument" 鐨勮姹?    await fetch(`${b.base}/api/work?key=NOPE%3B`, { headers: GUARD });
    // 鍐嶆墦涓€涓甯歌姹傦紝--json 浠嶅簲鍦ㄥ叏灞€浣嶇疆
    await fetch(`${b.base}/api/status`, { headers: GUARD });
    const lines = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(JSON.parse);
    const last = lines[lines.length - 1];
    assert.equal(last.indexOf('--json'), 2, `--json 涓嶅簲琚尓鍒板熬閮? ${JSON.stringify(last)}`);
  } finally {
    await b.stop();
    fs.rmSync(argvLog, { force: true });
  }
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 3. 瀛愯繘绋嬭緭鍑?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('澶氬瓧鑺?UTF-8 閫愬瓧鑺傝緭鍑轰笉琚牬鍧?, async () => {
  const b = await startBridge({ env: { STUB_MODE: 'multibyte' } });
  try {
    const body = await (await fetch(`${b.base}/api/status`, { headers: GUARD })).json();
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(body.data.title, '浠诲姟锛氭簮鏂囦欢绱㈠紩 鈥?伪尾纬 馃Л');
    assert.ok(!JSON.stringify(body).includes('锟?), '鍑虹幇浜嗘浛鎹㈠瓧绗?);
  } finally {
    await b.stop();
  }
});

test('瓒呭ぇ杈撳嚭琚尅浣忚€屼笉鏄拺鐖嗗唴瀛?, async () => {
  const b = await startBridge({ env: { STUB_MODE: 'huge' } });
  try {
    const body = await (await fetch(`${b.base}/api/status`, { headers: GUARD })).json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'OutputTooLarge');
  } finally {
    await b.stop();
  }
});

test('瓒呭ぇ璇锋眰浣撹鎷?, async () => {
  const res = await fetch(`${bridge.base}/api/context/compile`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, GUARD),
    body: JSON.stringify({ work: 'A', intent: 'x'.repeat(200000) }),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'BodyTooLarge');
});

test('stderr 涓婄殑 JSON 閿欒鑳借繕鍘熷嚭 code', async () => {
  const b = await startBridge({ env: { STUB_MODE: 'stderrjson' } });
  try {
    const body = await (await fetch(`${b.base}/api/status`, { headers: GUARD })).json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'SourceStale');
  } finally {
    await b.stop();
  }
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 4. reindex 鐨勮涔?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('榛樿涓嶅厑璁?reindex', async () => {
  const body = await (
    await fetch(`${bridge.base}/api/source/reindex`, { method: 'POST', headers: GUARD })
  ).json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'ReindexNotAllowed');
});

test('--allow-reindex 涔嬪悗鍙互璺?, async () => {
  const b = await startBridge({ allowReindex: true });
  try {
    const body = await (
      await fetch(`${b.base}/api/source/reindex`, { method: 'POST', headers: GUARD })
    ).json();
    assert.equal(body.ok, true, JSON.stringify(body));
  } finally {
    await b.stop();
  }
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 5. 婕旂ず妯″紡 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('婕旂ず妯″紡涓嶆墽琛屼换浣?awr 鍛戒护', async () => {
  const argvLog = path.join(os.tmpdir(), `argv3-${Date.now()}.log`);
  const b = await startBridge({ demo: true, env: { STUB_ARGV_OUT: argvLog } });
  try {
    const health = await (await fetch(`${b.base}/api/health`, { headers: GUARD })).json();
    assert.equal(health.data.mode, 'demo');

    const status = await (await fetch(`${b.base}/api/status`, { headers: GUARD })).json();
    assert.equal(status.error.code, 'DemoMode');

    assert.ok(!fs.existsSync(argvLog), '婕旂ず妯″紡涓嬩笉搴旀湁浠讳綍 awr 璋冪敤');
  } finally {
    await b.stop();
    fs.rmSync(argvLog, { force: true });
  }
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 6. 澶嶆牳鎻愬嚭鐨勫洓涓?P2 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('鐣稿舰璇锋眰琛屼笉浼氬甫璧版暣涓繘绋?, async () => {
  const b = await startBridge();
  try {
    // `GET // HTTP/1.1` 浼氳 new URL('//', base) 鎶涘嚭銆?    const bad = await new Promise((resolve, reject) => {
      const sock = require('node:net').connect(b.port, '127.0.0.1', () => {
        sock.write('GET // HTTP/1.1\r\nHost: 127.0.0.1:' + b.port + '\r\n\r\n');
      });
      let text = '';
      sock.on('data', (d) => (text += d));
      sock.on('end', () => resolve(text));
      sock.on('error', reject);
      setTimeout(() => { sock.end(); resolve(text); }, 1500);
    });
    assert.ok(/HTTP\/1\.1 4\d\d/.test(bad), `鏈熸湜 4xx锛屽疄闄呭搷搴斿ご锛?{bad.slice(0, 60)}`);

    // 鍏抽敭鏂█锛氳繘绋嬭繕娲荤潃锛屽悗缁姹傜収甯搞€?    const health = await fetch(`${b.base}/api/health`, { headers: GUARD });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  } finally {
    await b.stop();
  }
});

test('妲戒綅鎸夊瓙杩涚▼閲婃斁锛屼笉鎸夊搷搴旈噴鏀?, async () => {
  // 鍐欒秴鏃剁缉鍒?300ms锛屽瓙杩涚▼娲?30 绉掞細鍝嶅簲鏃╁氨鍥炰簡锛屽瓙杩涚▼杩樺湪銆?  const b = await startBridge({
    allowReindex: true,
    env: { STUB_MODE: 'slowwrite', AWR_INSPECTOR_WRITE_TIMEOUT_MS: '300' },
  });
  try {
    const hit = () =>
      fetch(`${b.base}/api/source/reindex`, { method: 'POST', headers: GUARD }).then((r) => r.json());

    const first = [];
    for (let i = 0; i < 4; i++) first.push(await hit());
    for (const r of first) {
      assert.equal(r.error.code, 'OutcomeUnknown', JSON.stringify(r));
    }

    // 鍥涗釜瀛愯繘绋嬮兘杩樻椿鐫€锛岀浜斾釜蹇呴』琚尅涓嬫潵銆?    const fifth = await hit();
    assert.equal(fifth.error.code, 'BridgeBusy', JSON.stringify(fifth));
  } finally {
    await b.stop();
  }
});

test('鍐欏懡浠よ緭鍑烘孩鍑轰笉琚?SIGKILL锛岀粨鏋滄姤涓烘湭鐭?, async () => {
  const b = await startBridge({
    allowReindex: true,
    env: { STUB_MODE: 'hugewrite' },
  });
  try {
    const r = await (
      await fetch(`${b.base}/api/source/reindex`, { method: 'POST', headers: GUARD })
    ).json();
    assert.equal(r.ok, false);
    // 涓嶆槸 OutputTooLarge锛氬啓鍛戒护娌¤缁堟锛屾垚娌℃垚鏄湭鐭ョ殑銆?    assert.equal(r.error.code, 'OutcomeUnknown', JSON.stringify(r));
    assert.ok(!/缁堢閲岀洿鎺ヨ窇|閲嶈瘯/.test(r.error.message) || /涓嶈鐩存帴閲嶈瘯/.test(r.error.message),
      '涓嶈寤鸿鐩存帴閲嶈窇涓€涓粨鏋滄湭鐭ョ殑鍐欐搷浣?);
  } finally {
    await b.stop();
  }
});

test('鍙鍛戒护杈撳嚭婧㈠嚭浠嶇劧鏄?OutputTooLarge', async () => {
  const b = await startBridge({ env: { STUB_MODE: 'huge' } });
  try {
    const r = await (await fetch(`${b.base}/api/status`, { headers: GUARD })).json();
    assert.equal(r.error.code, 'OutputTooLarge', JSON.stringify(r));
  } finally {
    await b.stop();
  }
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 7. 鍓嶇锛氳鎯呭搷搴旂殑浠ｉ檯瀹堝崼 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test('杩熷埌鐨勮鎯呭搷搴斾笉浼氳鐩栧綋鍓嶉€変腑椤?, () => {
  const { createGenerationGuard } = require('../public/app.js');
  const guard = createGenerationGuard();

  const a = guard.begin('A');
  const b = guard.begin('B');

  // B 鍏堝洖锛氬畠鏄渶鏂扮殑锛屽簲褰撹惤鍦般€?  assert.equal(guard.isCurrent(b), true);
  // A 鍚庡洖锛氬凡缁忚繃鏈燂紝蹇呴』涓㈡帀銆?  assert.equal(guard.isCurrent(a), false);
});

test('鍒锋柊浼氫綔搴熷湪閫旂殑璇︽儏璇锋眰', () => {
  const { createGenerationGuard } = require('../public/app.js');
  const guard = createGenerationGuard();

  const inflight = guard.begin('A');
  guard.invalidate();
  assert.equal(guard.isCurrent(inflight), false, '鍒锋柊鍚庢棫璇锋眰涓嶅緱钀藉湴');

  // 鍚屼竴涓?key 鐨勬洿鏃╄姹傦紝鍦ㄥ埛鏂板悗鍥炴潵涔熶笉绠楁暟銆?  const fresh = guard.begin('A');
  const older = { generation: fresh.generation - 1, key: 'A' };
  assert.equal(guard.isCurrent(older), false);
  assert.equal(guard.isCurrent(fresh), true);
});
