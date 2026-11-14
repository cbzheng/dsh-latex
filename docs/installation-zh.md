# LaTeX Studio 安装与使用

LaTeX Studio 是独立的 DeepSeek Harness（DSH）插件：左边写源码，右边看 PDF，
论文始终是普通的 Git 文件夹。主要面向 Apple Silicon Mac，也可在 Linux 服务器上
的 DSH 中使用。

## 安装

1. 准备 DeepSeek Harness 0.2.2-rc.1 或以上，以及 Node.js 22 或以上。
2. 将 `cbzheng-dsh-latex-版本号.tgz` 与 `SHA256SUMS` 下载到同一文件夹，
   运行 `shasum -a 256 -c SHA256SUMS`，确认显示 OK。
3. 打开 DSH 的 Plugins → Install，选择本地安装包，启用 LaTeX Studio；
   按提示重启或重新加载。
4. 从 DSH 侧栏打开 LaTeX Studio。

也可以用命令行安装（`desktop` 只是示例，请换成 DSH 实际使用的 profile，并沿用
相同的 DSH_HOME）：

```sh
dsh plugin --profile desktop add ./cbzheng-dsh-latex-版本号.tgz --ignore-scripts
```

升级时用同一个 profile 安装新包；已有论文、项目设置和 TeX 缓存都会保留。

## 准备编译器

不需要预先安装 MacTeX、TinyTeX、R 或 Docker。首次编译会联网下载并校验私有
TinyTeX，再按论文需要补充宏包和可下载字体。编译器保存在插件自己的数据目录，
不修改系统 PATH。界面依次显示下载、校验、解压、补包和编译进度；失败时保留
上次的 PDF，并提供日志和重试。

先联网成功编译一篇有代表性的论文，再在设置中关闭在线依赖，验证离线编译。
之后新增宏包可能需要重新联网。自定义系统字体、需要 shell escape 的宏包不在
兼容保证范围内。

## 项目

可以打开已有文件夹、新建论文，或在首页粘贴 GitHub 仓库链接并选择克隆位置。
Overleaf 导出的文件夹解压后可直接打开。克隆在后台进行，显示真实进度，可以
取消；刷新页面后继续查看，失败时保留目标文件夹。

## 写作

- 顶栏：侧栏按钮、返回项目列表、日志和设置。
- 设置：主 tex 文件、编译引擎、定时编译间隔、在线依赖和界面语言。多入口工程
  请明确选择实际论文入口，打开其他 tex 文件不会切换编译入口。
- 侧栏：文件 / 大纲 / Git。
- 编辑：Cmd+B 加粗、Cmd+I 斜体（非 Mac 用 Ctrl），工具栏另有 itemize、
  enumerate 和 figure 按钮；选中几行再点列表按钮会把它们变成 `\item`。
- 保存：自动保存并检查文件版本；磁盘上的文件被外部修改时保留草稿，需手动
  核对后重新加载。
- 编译：点源码栏顶部的“编译”或按 Cmd+Enter。默认每 5 分钟在有修改时自动
  编译一次，可在设置中改为 1–30 分钟或关闭。
- PDF：源码工具栏的箭头定位到 PDF，双击 PDF 返回源码；只渲染可见和相邻页面。
- 大纲：按主文件的 input/include 顺序显示章节，点击定位到对应行并同步 PDF。

## Git

沿用本机已有的 Git 身份、SSH agent、凭据和 gh 登录，不收集令牌，也不修改全局
Git 设置。Git 页显示分支与领先/落后数量、拉取和推送、按颜色标记的更改与内联
差异、提交框（Cmd+Enter）和提交时间线。拉取要求工作区干净且可快进；分叉或冲突
不会被强制覆盖。没有 origin 的仓库可以连接远端，不会覆盖已有的不同 origin。

## Agent 修改建议

`latex_studio` Agent 工具可以提出带版本检查的修改。有待处理修改时，顶栏出现
带数字的按钮，接受后才会写入。通用终端 Agent 仍可直接改文件，需要审核时请让
它使用这个工具。

AI 协同编辑（与助手一起直接修改当前论文）正在开发中，之后发布。

## 卸载与备份

通过插件管理器卸载时保留论文文件夹和插件私有状态，重新安装会继续使用。论文
与 DSH profile 请分别备份；Git 仓库不包含编译器缓存。
