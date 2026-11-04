# Sparo 0.3.0 官网更新文案

贴站时把「官网下载页」换成实际下载地址。本文不写域名和托管方式。

口径只来自 `CHANGELOG.md` 的 0.3.0 条目和 `docs/PRODUCT.md`。不出现价格、付款、云订阅计量。

---

## 1. 版本公告

### 中文

**Sparo 0.3.0 已上线**

这一版的侧栏换成了连续上下文的 Agent 核，代号自由魂（Free Soul Core）。多步的事一句话交代就行：它自己翻页、点按、填表、读回执，中途不把前面的上下文丢掉。长任务会提醒你还剩多少轮。跑到 32 轮不会自己停，侧栏告诉你已经跑了多少轮，任务继续；之后每 8 轮再提醒一次。到 100 轮才停下来，你可以回复继续接着跑。没做完的不会说成做完了，卡住了会告诉你卡在哪。

输入框旁边可以随时切换两种执行方式，选择会记住。

- **逐步确认**（默认）：发布、发送之前先问你一句，你同意才执行。
- **自动执行**：一口气干完你交代的整件事，再向你汇报。

支付和删除，两种模式都会先问你。客服回复仍然只把草稿填进输入框，页面上的发送永远由你自己点。

正在做事时也可以插话。再发一条消息，两秒内停下，接着做你的新指令；点停止会立刻停。打断之后从断点继续，不用从头再来。发送的时候输入框不再锁住，插话直接排上。

本机素材库也来了。任务里需要留下的网页图片和页面截图，会存进这台电脑，并记下是从哪一页来的。之后发微博，或在别的网站贴图，直接引用这些素材。素材只留在本机，不上云，也不写进聊天记录。单张不超过 10MB，一次任务最多 20 张，库里超过 500MB 会如实告诉你已经满了，不会偷偷删掉旧文件。

Sparo 仍是装在你电脑上的浏览器。它点的、填的，就是你正在看的这一页。你看着，也能随时停下。

### English

**Sparo 0.3.0 is here**

The sidebar now runs on a continuous-context agent core, Free Soul Core. Hand it a multi-step job in one sentence. It turns pages, clicks, fills forms, and reads what the page actually shows, without dropping the thread. Long jobs get a reminder as the round budget runs down. At 32 rounds it does not stop on its own: the sidebar says how many rounds have run, and the task continues. The same reminder comes every 8 rounds after that. It stops at the 100-round safety limit, and you can reply to continue. Unfinished work is never reported as done. If it gets stuck, it says where.

Switch execution mode beside the input. The choice is remembered.

- **Confirm each step** (default): before a post or a send, it asks you. It proceeds only after you agree.
- **Run automatically**: it finishes the whole job you gave it, then reports back.

Payment and deletion still ask you first, in both modes. Customer-service replies are still drafts in the box. You click Send on the page.

You can cut in while it is working. Send another message and it stops within two seconds, then picks up the new instruction. Stop halts it immediately. After an interrupt it continues from the break, not from the start. The input stays open while a run is in progress, so a new message goes straight into the queue.

There is also a library on this computer. Page images and screenshots a task needs to keep are saved locally, with the page they came from. Later, when you post on Weibo or attach an image on another site, you can point at those files. They stay on this machine. They are not uploaded, and they are not written into the chat log. One image is capped at 10MB, one task at 20 images, and the library at 500MB. When it is full, Sparo says so. It does not delete older files on its own.

Sparo is still the browser on your computer. What it clicks and fills is the page you are looking at. You watch, and you can stop it.

---

## 2. 下载页

### 中文

**下载 Sparo 0.3.0（Windows）**

安装包：`Sparo-Setup.exe`  
版本：0.3.0  
系统：Windows

到官网下载页取得安装包。下载后双击安装，再到桌面打开 Sparo。

### English

**Download Sparo 0.3.0 (Windows)**

Installer: `Sparo-Setup.exe`  
Version: 0.3.0  
System: Windows

Get the installer from the download page on the website. Double-click to install, then open Sparo from the desktop.

---

## 3. 更新日志

### 中文

**0.3.0 — 2026-11-03**  
Agent 核、两种执行模式、随时打断、本机素材库

- 侧栏改为连续上下文的 Agent 核（自由魂 / Free Soul Core）。多步任务一句话交代，自己翻页、点按、填表、读回执，中途不丢上下文。
- 长任务有轮次预算提示。跑满 32 轮不再自动停下，侧栏提醒已经执行多少轮，任务继续；之后每 8 轮再提醒一次。到 100 轮安全上限才停止，回复继续可以接着跑。必交付没齐不会说成完成。卡住了说人话。
- 两种执行模式，输入框旁切换，选择会记住。逐步确认是默认：发布、发送前先问你，同意才执行。自动执行：一口气做完再汇报。
- 支付、删除在两种模式下都先问你。客服回复只填草稿，发送由你在页面上点。
- 执行中可以插话：再发一条，两秒内停下并接上新指令。点停止立即停。从断点续跑，不重头来。发送中不锁输入框。
- 本机素材库：网页图片和页面截图随任务保存，清单记下源页面。之后发微博或在其他站贴图，直接引用素材。只存本机，不上云，不进聊天记录。单张 10MB，单任务 20 张，库容 500MB。满了如实说明，不自动删除。

### English

**0.3.0 — 2026-11-03**  
Agent core, two run modes, interrupt anytime, on-device library

- The sidebar now uses a continuous-context agent core (Free Soul Core). Give a multi-step job in one sentence. It pages, clicks, fills, and reads the page back, and keeps the context.
- Long jobs get a round-budget reminder. At 32 rounds the run does not stop on its own: the sidebar says how many rounds have run, and the task continues, with the same reminder every 8 rounds. It stops at the 100-round safety limit; reply to continue. Missing deliverables are not called done. When it is stuck, it says so in plain language.
- Two modes, switched beside the input and remembered. Confirm each step is the default: it asks before posting or sending, and acts only after you agree. Run automatically: it finishes the job, then reports.
- Payment and deletion ask first in both modes. Customer-service replies stay drafts. You click Send on the page.
- Interrupt a run by sending another message: it stops within two seconds and takes the new instruction. Stop halts it at once. It resumes from the break. The input is not locked while a message is sending.
- On-device library: page images and screenshots are saved with the source page. Use them later when posting on Weibo or attaching an image on another site. Local only. Not uploaded. Not stored in the chat log. 10MB per image, 20 images per task, 500MB for the library. When full, it says so and does not delete files by itself.

---

## 4. FAQ

### 自动执行模式安全吗？

**中文**

安全边界没有放开。自动执行只是不再中途问「要不要继续」：你交代的发布、发送会做到做完再汇报。支付和删除，无论逐步确认还是自动执行，都要先问你，你同意才执行。客服回复两种模式都只把草稿填进输入框，页面上的发送仍由你点。

**English**

**Is automatic mode safe?**

The safety line did not move. Automatic mode stops asking “should I continue?” in the middle. A post or a send you asked for runs through, then it reports. Payment and deletion still ask you first, whether you are confirming each step or running automatically. Nothing happens there until you agree. In both modes, a customer-service reply is only a draft in the box. You still click Send on the page.

### 素材库会占满硬盘吗？隐私呢？

**中文**

不会悄悄占满，也不会上传。素材只存在这台电脑上，不进云，也不写进聊天记录。单张图片超过 10MB 不会保存。一次任务最多存 20 张。整个库超过 500MB 时，新的保存会告诉你已经满了，已有文件都留着，不会自动删除。想腾地方，自己到本机素材目录里删即可。

**English**

**Will the library fill my disk? What about privacy?**

It will not quietly fill the disk, and it does not upload anything. Files stay on this computer. They are not sent to a cloud, and they are not written into the chat log. An image over 10MB is not saved. One task can save at most 20 images. When the library is over 500MB, the next save tells you it is full. Existing files stay. Nothing is deleted automatically. To free space, delete files yourself in the local library folder.
