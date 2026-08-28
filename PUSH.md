# 推送到 GitHub 手册

> 本仓库已在本地完成 `git init` + 首次提交（分支 `main`，89 个文件）。
> 当前 commit 作者为占位身份 `SmashLab <dev@smashlab.app>`，推送前建议改成你自己的 GitHub 身份（见下）。

---

## 0. 前置

- 一台**能访问 GitHub** 的机器（把整个 `/workspace` 目录拷过来即可，`.git` 已包含）
- 安装 `git`；若要一键建仓库，装 `gh` (https://cli.github.com)
- 一个 GitHub 账号

> 本仓库已忽略 `node_modules/`、`dist/`、构建产物与密钥；
> `android/`、`ios/` 原生工程**已纳入版本控制**（云端 CI 需要它们来 `cap sync`）。

---

## 1. （可选）修正 commit 作者为你的 GitHub 身份

```bash
git config user.name  "你的GitHub用户名"
git config user.email "你在GitHub使用的邮箱"      # 可用 xxx@users.noreply.github.com
git commit --amend --reset-author --no-edit       # 改写最近一次提交作者
```

---

## 2. 方式 A：用 gh 一键建私有仓库并推送（推荐）

```bash
# 先登录（粘贴你给 agent 的 token，或走浏览器登录）
echo "<YOUR_TOKEN>" | gh auth login --with-token
# 或交互式： gh auth login

# 新建私有仓库并直接推送当前分支
gh repo create smashlab --private --source=. --remote=origin --push
```

推送成功后仓库地址：`https://github.com/<你的用户名>/smashlab`

---

## 3. 方式 B：已有仓库 / 纯 git 推送

```bash
# 把 <YOUR_TOKEN> 换成你的 PAT；或用手工建好的仓库 HTTPS 地址
git remote add origin https://<YOUR_TOKEN>@github.com/<你的用户名>/smashlab.git
git push -u origin main
```

> ⚠️ token 写在 remote URL 里会留在本地 `.git/config` 与 shell 历史，推送后建议到
> GitHub → Settings → Developer settings 撤销该 token。

---

## 4. 推送后：开启云端出包

仓库建好后：

1. 打开 **Settings → Secrets and variables → Actions**，按需添加：
   - Android APK：`KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`
   - iOS IPA：`IOS_CERTIFICATE_BASE64` / `IOS_CERTIFICATE_PASSWORD` / `IOS_PROVISIONING_PROFILE_BASE64` / `IOS_TEAM_ID`
   （详见 `APK.md` 与 `IOS.md`）
2. 触发：**Actions → Build Android APK / Build iOS IPA → Run workflow**
3. 打 `v*` 标签即自动发布到 Release。

---

## 5. 常见问题

- **CI 里模型下载失败**：`dist/models/pose_landmarker_lite.task` 托管在 Google 存储，
  极少数 Runner 网络会被拦；见 `MOBILE.md` 手动补模型，或改用 jsDelivr 镜像（已内置回退）。
- **push 被拒（non-fast-forward）**：`git pull --rebase origin main` 后再 push。
- **想改仓库名 / 可见性**：改 `gh repo create` 参数，或建好后到仓库 Settings 改。
