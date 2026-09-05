# Sparo Privacy Notice

Effective: 2026-09-04. Product: **Sparo** (Windows store edition). Publisher name follows your Microsoft / itch developer account.

Host this page or [listings/privacy.html](./listings/privacy.html) on **public HTTPS**, then paste the full URL into Partner Center (Privacy policy) and itch (external links). Chinese: [PRIVACY.md](./PRIVACY.md).

Store listing files under `listings/` will be revised in a separate review pass. This change does not edit those files.

## What we sell

Sparo is a Windows browser that runs on your PC. You can buy the software once and always use your own model key.

**Cloud models are optional.** After you sign in, requests go through a server-side proxy. The cloud key never lands on your PC. The store app has no payment buttons; you manage a subscription on the website. When it expires, only cloud models stop. Site logins and a key you pasted still work.

## Where data lives

On this PC, under your user profile (Windows: `%APPDATA%\sparo-store`):

- API keys and model settings you paste (Your-key mode only)  
- If you sign in for cloud models: an encrypted login token (Electron `safeStorage`). It does not contain the real cloud model key  
- Optional work prefs (name, tone, don’t-say list)  
- Browser logins, cookies, and local storage  
- Optional recorded actions (“skills”)  

We do **not** sync cookies, your own key, or work prefs as a cloud drive. There is no “copy this PC’s setup to another PC” product.

## When data leaves this PC

- **Your key:** Summarize, Fill form, Reply, Publish, or chat that calls a model sends relevant page text to **the model host you configured** (DeepSeek, OpenAI, or your compatible gateway). Those hosts have their own policies.  
- **Cloud models:** The same kind of page text goes to Sparo’s proxy, which forwards it to a model vendor. The proxy uses your login token for quota. **The cloud key is not sent to this PC.**  
- If you never paste a key and never sign in, those features do not run.

**Copy for Agent** puts the local app path and local connection details on the clipboard for you to paste into a local agent.

## Send and submit

Replies are written into the page input. Forms and posts pause before submit. **You click Send or Submit on the page.** The product is semi-automatic; it is not designed to send on your behalf.

## What we do not collect

- We do not hand your cookies to a cloud browser  
- We do not sell personal data  
- We do not store the real cloud model key on this PC  

Optional email sign-in is only for cloud-model quota and subscription status.

## Children

Built for work and personal productivity, not for children under 13.

## Contact

Use the support email on the store listing / developer account. We will update the date if this notice changes.
