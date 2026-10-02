# Spark.Memo ⚡

<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="Spark.Memo Logo">
</p>

<p align="center">
  <strong>极简、优雅、私密的个人备忘录与桌面日记应用</strong>
</p>

<p align="center">
  <a href="https://github.com/ZE-spark/Spark.Memo/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Electron-42.x-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white" alt="Platform">
</p>

---

## ✨ 项目特色

- **🍃 极简沉浸写作**：无干扰无边框设计，支持随写随存、实时字数统计浮标与历史备忘检索。
- **🎨 5 款精选主题**：浅白（Light）、暗黑（Dark）、暖阳（Warm）、紫夜（Violet）、青翠（Teal），支持跟随系统自动调节。
- **📱 局域网端对端加密互通**：
  - 手机扫码直连，无需复杂配置。
  - 动态一次性令牌 + AES 纯前端对称加密，数据在局域网内点对点流转，保障数据隐私安全。
  - 桌面端主动弹窗授权，未允许的设备严禁接入。
- **🖼️ 本地图片智能引用**：可直接插入电脑本地图片，采用路径直接引用机制，不占用额外磁盘冗余存储空间，并支持一键在系统文件夹中定位。
- **📑 批量管理与 Word 导出**：支持多选备忘一键打包导出为结构清晰的 Word（`.doc`）文档，方便归档与打印。
- **🔒 100% 离线与隐私优先**：所有数据保存在本地客户端环境中，不经过任何第三方云端服务器，保障个人日记与灵感资产安全。

---

## 🛠️ 技术栈

- **框架内核**：[Electron](https://www.electronjs.org/)
- **界面样式**：Tailwind CSS (本地打包离线构建)
- **图标体系**：Lucide Icons
- **加密体系**：CryptoJS (AES) + Node.js Crypto
- **局域网传输**：Node.js HTTP Server + QRCode
- **打包工具**：Electron Builder

---

## 🚀 快速上手与运行

### 1. 克隆代码仓库

```bash
git clone https://github.com/ZE-spark/Spark.Memo.git
cd Spark.Memo
```

### 2. 安装依赖

```bash
npm install
```

### 3. 开发环境运行

```bash
npm start
```

### 4. 打包构建 Windows 绿色便携版

```bash
npm run build
```

打包成功后，可在 `dist/` 目录下生成 `Spark.Memo-Portable-1.0.0.exe` 独立便携运行程序。

---

## 📁 目录结构说明

```text
Spark.Memo/
├── assets/                  # 静态资源与离线依赖
│   ├── crypto-js.js         # 前端 AES 解密库
│   ├── icon.ico             # Windows 应用图标
│   ├── icon.png             # Logo 图标
│   ├── lucide.js            # 图标库
│   ├── mobile.html          # 手机端轻量级互传展示页
│   └── tailwind.js          # Tailwind CSS 离线运行脚本
├── electron-builder.yml     # 便携版打包构建配置
├── index.html               # 桌面端主界面渲染进程
├── main.js                  # Electron 主进程与窗口控制
├── package.json             # 项目元信息与依赖配置
├── preload.js               # 安全沙箱与 IPC 通信桥接
└── sync-server.js           # 局域网加密同步服务器与二维码授权系统
```

---

## 🔐 隐私说明

`Spark.Memo` 恪守隐私至上原则。本仓库仅包含应用程序源码与静态资源。所有用户使用过程中生成的本地日记、便签记录与缓存数据均保存在操作系统的本地区域，绝不会随代码被同步或上传至代码仓库中。

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 授权开源。
