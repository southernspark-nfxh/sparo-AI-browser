# Microsoft Store · English (en-US)

Partner Center → Product → **Store listings**. Field limits follow the [MSI/EXE store listing](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/msi-exe/create-a-new-msi-submission) form.

Description and features: **plain text**. No URLs or HTML in Description. Do not prefix features with bullets; the Store adds them.

First submission: leave **What’s new** empty.

Ship a **separate listing** for zh-CN. Screenshot sets are per language: capture the app with **Settings → Language → English**.

---

## Properties (language-independent)

| Field | Value |
|---|---|
| Product name | Sparo |
| Package / installer name | Sparo |
| Publisher display name | Match your developer account |
| Category | Productivity |
| Device family | Windows desktop only. Do not tick Xbox, HoloLens, or phone |
| Age rating | Productivity tool; no hosted UGC; internet used for the user’s own model API |
| Privacy policy URL | Host [privacy.html](./privacy.html) or [PRIVACY.en.md](../PRIVACY.en.md) on public HTTPS, paste the full URL |
| Support / website | Optional. Do not put URLs in the Description body |
| OS | Windows 10 version 1809 or later / Windows 11; x64 |
| Signing | Current builds set `signAndEditExecutable: false`. Follow Partner Center rules for EXE/MSI before submit (see PREFLIGHT) |

---

## Listing titles

| Field | Limit | Copy |
|---|---|---|
| Product name | — | Sparo |
| Short title | 50 | The AI browser that acts |
| Sort title | 255 | Sparo the AI browser that acts |
| Voice title | 255 | Sparo the AI browser that acts |

---

## Short description

Limit: 1,000. Store cards often truncate near **270 characters**. Use this block (~240).

```
Sparo is a Windows browser whose AI works on the page you see. It summarizes, fills forms, drafts replies, and walks publish steps. Replies go into the box; posts pause before submit. You click send. Keys stay on this PC. Bring your own API key. No membership.
```

---

## Description (required)

Limit: 10,000. Plain text. No links.

```
Sparo is the AI browser that acts.

Other AIs stop at the chat box. You still copy the answer back into Chrome to fill a form, reply to a customer, or hit publish. Sparo does the opposite: it works on the page in front of you. Your login stays your login. The window stays your window.

Four everyday jobs:

Summarize this page.
Fill a form (it stops before submit).
Reply in chat or comments (draft only; you click send).
Publish (it pauses before submit).

It does not click send for you. It does not move your account into a cloud browser. Model cost uses your API key: DeepSeek, OpenAI, and OpenAI-compatible hosts such as Qwen, Kimi, GLM, SiliconFlow, OpenRouter, Groq, and local Ollama. Native Anthropic and Gemini protocols are not this path; use an OpenAI-compatible gateway if you have one.

If you already use Cursor or Claude, open Settings and click Copy for Agent so the same window becomes that agent’s hands. You can also talk in the sidebar with no extra app installed.

Data stays on this PC. No account system. No cloud membership.

What it does not do: persona farms, fingerprint multi-boxing, or unattended auto-posting.
```

---

## What’s new

Limit: 1,500. **Blank on first submit.** Later, for example:

```
UI languages include English and eight others. Compatible-API gateways can be filled in one tap. Semi-automatic send (you confirm) is unchanged.
```

---

## Product features

Max 20 × 200 characters. No leading bullets.

```
Shared window: AI acts on the page you see; you can watch and stop
Four jobs: Summarize, Fill form, Reply, Publish
Replies are drafts only; you click send on the page
Forms and posts pause before submit
Bring your own API key; no membership; we do not bill model usage
DeepSeek by default, or paste an OpenAI key
Compatible hosts: Qwen, Kimi, GLM, SiliconFlow, Volcengine, OpenRouter, Groq, local Ollama
UI: Chinese, English, Japanese, Korean, Spanish, Portuguese, German, French, Italian
Copy for Agent in Settings; installer and portable builds expose the real app path
Logins, cookies, and keys stay on this PC
Installer and portable Windows builds
```

---

## Search terms

About 7 terms, keep each under 30 characters.

```
AI browser
form fill
customer reply
semi automatic
DeepSeek
OpenAI
productivity
```

---

## Screenshots

At least one PNG; four or more recommended. Desktop: **1366×768 or larger**, max 50 MB. Suggested names: `ms-en-01-chat.png` … `ms-en-04-agent.png`. Shot list: [screenshots.md](./screenshots.md).
