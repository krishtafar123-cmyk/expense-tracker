# English Helper

A free website for checking your English. Type or speak a sentence, and you get:

- the **corrected version**, which you can copy, listen to or keep editing
- your original text with the **mistakes marked**
- a **short reason for each change**, with other suggestions and a "Keep mine" button

It also has a **Learn** section: all 12 tenses, how to ask questions correctly, everyday vocabulary, and the most common mistakes. Each lesson has a "Try it" button that sends an example to the checker.

## Cost: free

- **Grammar checking:** the free public [LanguageTool](https://languagetool.org) API. No account or key needed. It allows about 20 checks a minute per person.
- **Speak and Listen:** built into the browser (Chrome, Edge, Safari, Android), so they cost nothing.
- **Hosting:** Vercel's free plan.

There is no server, database or login: it is just HTML, CSS and JavaScript.

## Put it online with Vercel

1. Go to https://vercel.com, then **Add New… → Project**, and import this GitHub repository.
2. Under **Root Directory**, click **Edit** and choose `english-helper`.
3. Leave **Framework Preset** as **Other**, with no build command, and click **Deploy**.

You'll get a link like `english-helper-xxxx.vercel.app` that works on your phone and computer.

## Install it on your phone

Once it's online, open the link on your phone:

- **Android (Chrome):** tap **⬇ Install** at the top of the page, or open the ⋮ menu and choose **Install app** / **Add to Home screen**.
- **iPhone (Safari):** tap the **Share** button, then **Add to Home Screen**.

It then opens full-screen from its own icon. The Learn lessons work without internet, but checking needs a connection.

When you change any file, bump `VERSION` in `sw.js` (for example `eh-v2` → `eh-v3`) so installed copies update.

## Try it on your computer

Open `index.html` in a browser. The microphone needs the site to be served over `https` or `localhost`, so for that, run `python3 -m http.server` in this folder and open http://localhost:8000.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js` | The checker page |
| `learn.html`, `learn.js` | The Learn page |
| `learn-data.js` | All lesson content. Add tenses, words or mistakes here |
| `styles.css` | Look and feel (light and dark mode) |
| `manifest.json`, `sw.js`, `pwa.js`, icons | Make it installable and let it work offline |

## Limits

LanguageTool follows rules, not AI. It catches spelling, verb forms, plurals, articles and many word-order mistakes, but it won't rewrite a sentence to sound more natural, and it can miss some errors. A free AI service (for example Google Gemini's free tier) could be added later for "make this sound natural" rewrites.
