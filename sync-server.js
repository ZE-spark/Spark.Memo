const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const QRCode = require('qrcode');
const CryptoJS = require('crypto-js');

class SyncServerManager extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.serverPort = 49200;
    this.selectedIp = null;
    this.syncData = {
      notes: [],
      activeNoteId: null,
      updatedAt: new Date().toISOString()
    };
    this.currentSession = {
      token: null,
      keyHex: null,
      createdAt: null
    };
    // 存储待确认和已确认的设备授权请求: requestId -> { id, ip, deviceName, status, createdAt }
    this.authRequests = new Map();
  }

  ensureSession() {
    if (!this.currentSession.token) {
      this.currentSession = {
        token: crypto.randomBytes(16).toString('hex'), // 128-bit 动态令牌
        keyHex: crypto.randomBytes(24).toString('hex'), // AES 密钥
        createdAt: Date.now()
      };
    }
    return this.currentSession;
  }

  refreshSession() {
    this.currentSession = {
      token: crypto.randomBytes(16).toString('hex'),
      keyHex: crypto.randomBytes(24).toString('hex'),
      createdAt: Date.now()
    };
    this.authRequests.clear();
    return this.currentSession;
  }

  /**
   * 使用 CryptoJS 纯 JS AES 加密（完全兼容所有移动端非 HTTPS HTTP 场景）
   */
  encryptPayload(dataObj, keyHex) {
    const jsonStr = JSON.stringify(dataObj);
    const ciphertext = CryptoJS.AES.encrypt(jsonStr, keyHex).toString();
    return {
      ciphertext: ciphertext
    };
  }

  parseDeviceName(userAgent, ip) {
    let dev = '移动设备';
    const ua = userAgent || '';
    if (/iPhone/i.test(ua)) dev = 'iPhone 手机';
    else if (/iPad/i.test(ua)) dev = 'iPad 平板';
    else if (/Android/i.test(ua)) dev = 'Android 手机';
    else if (/Macintosh/i.test(ua)) dev = 'Mac 电脑';
    else if (/Windows/i.test(ua)) dev = 'Windows PC';

    if (/MicroMessenger/i.test(ua)) {
      dev += ' (微信扫码)';
    }

    let cleanIp = ip || '';
    if (cleanIp.startsWith('::ffff:')) {
      cleanIp = cleanIp.substring(7);
    }
    return `${dev} [${cleanIp}]`;
  }

  getNetworkInterfaces() {
    const ifaces = os.networkInterfaces();
    const list = [];

    for (const name in ifaces) {
      const details = ifaces[name];
      for (const item of details) {
        if ((item.family === 'IPv4' || item.family === 4) && !item.internal) {
          let score = 0;
          const lower = name.toLowerCase();

          if (lower.includes('wlan') || lower.includes('wi-fi') || lower.includes('wifi') || name.includes('无线')) {
            score += 100;
          } else if (lower.includes('ethernet') || lower.includes('eth') || name.includes('以太网')) {
            score += 70;
          }

          if (
            lower.includes('vmware') ||
            lower.includes('virtual') ||
            lower.includes('vethernet') ||
            lower.includes('meta') ||
            lower.includes('radmin') ||
            lower.includes('tap') ||
            lower.includes('vpn')
          ) {
            score -= 100;
          }

          list.push({
            name,
            address: item.address,
            score
          });
        }
      }
    }

    list.sort((a, b) => b.score - a.score);

    return list.map((item, idx) => ({
      name: item.name,
      address: item.address,
      isRecommended: idx === 0
    }));
  }

  getEffectiveIp() {
    const interfaces = this.getNetworkInterfaces();
    if (this.selectedIp && interfaces.some(i => i.address === this.selectedIp)) {
      return this.selectedIp;
    }
    if (interfaces.length > 0) {
      this.selectedIp = interfaces[0].address;
      return this.selectedIp;
    }
    return '127.0.0.1';
  }

  async generateQRCode(text) {
    try {
      return await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 2,
        scale: 7,
        color: {
          dark: '#1C1917',
          light: '#FFFFFF'
        }
      });
    } catch (err) {
      console.error('Failed to generate QR code:', err);
      return null;
    }
  }

  respondAuth(requestId, allow) {
    const reqInfo = this.authRequests.get(requestId);
    if (!reqInfo) return { success: false, error: '请求不存在或已过期' };

    reqInfo.status = allow ? 'approved' : 'rejected';
    this.authRequests.set(requestId, reqInfo);
    return { success: true, status: reqInfo.status };
  }

  startServer() {
    return new Promise((resolve) => {
      if (this.server) {
        return resolve(this.serverPort);
      }

      this.server = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, `http://localhost:${this.serverPort}`);
        const pathname = parsedUrl.pathname;

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // 静态资源文件直接允许安全加载
        if (pathname.startsWith('/assets/') || pathname === '/favicon.ico') {
          const reqAsset = pathname === '/favicon.ico' ? '/assets/icon.png' : pathname;
          const safePath = path.normalize(path.join(__dirname, reqAsset)).replace(/\\/g, '/');
          const assetsDir = path.normalize(path.join(__dirname, 'assets')).replace(/\\/g, '/');
          
          if (safePath.startsWith(assetsDir) && fs.existsSync(safePath)) {
            let contentType = 'application/octet-stream';
            if (safePath.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
            else if (safePath.endsWith('.png')) contentType = 'image/png';
            else if (safePath.endsWith('.ico')) contentType = 'image/x-icon';
            else if (safePath.endsWith('.html')) contentType = 'text/html; charset=utf-8';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(safePath).pipe(res);
            return;
          }
        }

        const session = this.ensureSession();
        const requestToken = parsedUrl.searchParams.get('token');

        // 安全拦截：无合法 Token 拒绝
        if (!requestToken || requestToken !== session.token) {
          res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>403 访问被拒绝</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #FAF9F6; color: #1C1917; padding: 20px; box-sizing: border-box; }
                .box { background: #FFFFFF; border: 1px solid #E7E5E4; border-radius: 20px; padding: 32px 24px; max-width: 420px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
                .icon { font-size: 40px; margin-bottom: 12px; }
                h1 { font-size: 18px; margin: 0 0 10px; }
                p { font-size: 13px; color: #78716C; line-height: 1.6; margin: 0; }
              </style>
            </head>
            <body>
              <div class="box">
                <div class="icon">📱</div>
                <h1>请使用二维码连接</h1>
                <p>
                  请使用手机扫描电脑 Spark.Memo 屏幕上的专属二维码打开本页面。
                </p>
              </div>
            </body>
            </html>
          `);
          return;
        }

        // 1. 首页：渲染手机版日记传送门
        if (pathname === '/' || pathname === '/index.html') {
          const mobilePath = path.join(__dirname, 'assets', 'mobile.html');
          fs.readFile(mobilePath, 'utf8', (err, content) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('无法加载手机页面: ' + err.message);
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
          });
          return;
        }

        // 2. 手机端发起授权申请 API: POST /api/request-auth
        if (pathname === '/api/request-auth') {
          const rawIp = req.socket.remoteAddress || '';
          let cleanIp = rawIp;
          if (cleanIp.startsWith('::ffff:')) cleanIp = cleanIp.substring(7);

          const ua = req.headers['user-agent'] || '';
          const deviceName = this.parseDeviceName(ua, cleanIp);
          const requestId = 'auth_' + crypto.randomBytes(8).toString('hex');

          const reqInfo = {
            id: requestId,
            ip: cleanIp,
            deviceName: deviceName,
            status: 'pending',
            createdAt: Date.now()
          };

          this.authRequests.set(requestId, reqInfo);

          // 触发事件通知电脑桌面端弹出授权确认框
          this.emit('device-auth-request', {
            requestId: requestId,
            deviceName: deviceName,
            ip: cleanIp,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          });

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ requestId, status: 'pending', deviceName }));
          return;
        }

        // 3. 手机端轮询授权状态 API: GET /api/auth-status?requestId=...
        if (pathname === '/api/auth-status') {
          const reqId = parsedUrl.searchParams.get('requestId');
          const reqInfo = this.authRequests.get(reqId);
          if (!reqInfo) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ status: 'not_found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ status: reqInfo.status, deviceName: reqInfo.deviceName }));
          return;
        }

        // 4. 数据 API：必须带有效已同意的 requestId，且通过纯 JS AES 密文下发
        if (pathname === '/api/data') {
          const reqId = parsedUrl.searchParams.get('requestId');
          const reqInfo = this.authRequests.get(reqId);

          if (!reqInfo || reqInfo.status !== 'approved') {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '未通过电脑端授权同意，拒绝访问数据' }));
            return;
          }

          const encrypted = this.encryptPayload({
            notes: this.syncData.notes || [],
            activeNoteId: this.syncData.activeNoteId,
            updatedAt: this.syncData.updatedAt
          }, session.keyHex);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            encrypted: true,
            ciphertext: encrypted.ciphertext,
            updatedAt: this.syncData.updatedAt
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      });

      const tryListen = (port) => {
        this.server.listen(port, '0.0.0.0', () => {
          this.serverPort = port;
          console.log(`[Spark.Memo Sync] Encrypted server running at http://0.0.0.0:${this.serverPort}/`);
          resolve(this.serverPort);
        });

        this.server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            this.server.close();
            tryListen(port + 1);
          } else {
            console.error('[Spark.Memo Sync] Server error:', err);
            resolve(this.serverPort);
          }
        });
      };

      tryListen(this.serverPort);
    });
  }

  stopServer() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  updateSyncData(notes, activeNoteId) {
    this.syncData = {
      notes: notes || [],
      activeNoteId: activeNoteId || null,
      updatedAt: new Date().toISOString()
    };
  }

  async getSyncInfo(data) {
    if (data) {
      this.updateSyncData(data.notes, data.activeNoteId);
    }

    await this.startServer();
    const session = this.ensureSession();
    const currentIp = this.getEffectiveIp();

    const url = `http://${currentIp}:${this.serverPort}/?token=${session.token}#key=${session.keyHex}`;
    const qrCodeDataUrl = await this.generateQRCode(url);
    const ips = this.getNetworkInterfaces();

    return {
      url,
      displayUrl: `http://${currentIp}:${this.serverPort}`,
      port: this.serverPort,
      selectedIp: currentIp,
      ips,
      qrCodeDataUrl,
      token: session.token,
      isEncrypted: true,
      activeNoteId: this.syncData.activeNoteId,
      activeNote: (this.syncData.notes || []).find(n => n.id === this.syncData.activeNoteId) || null
    };
  }

  async changeSyncIp(newIp) {
    this.selectedIp = newIp;
    return await this.getSyncInfo();
  }
}

const syncServerInstance = new SyncServerManager();
module.exports = syncServerInstance;
