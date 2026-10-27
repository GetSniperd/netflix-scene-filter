# Netflix Scene Filter (version 0.3.0)

A browser add-on for Edge and Chrome that helps parents watch Netflix with their kids. You tell it where the parts you don't like are, and it will **mute the sound**, **hide the picture**, or **skip ahead** at those moments, every time that episode plays. It can also **mute bad words automatically** by reading the subtitles.

Everything stays on your computer. Nothing is sent anywhere.

## Installing it (Edge)

1. Open `edge://extensions` (in Chrome: `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Reload any Netflix tab that was already open.

## What you will see

### The bar on the video

When you play something on Netflix, a dark bar appears near the bottom of the video, just above Netflix's own controls. It is there by default. You can drag it by the dotted handle on its left (double-click the handle to put it back). From left to right:

- **Filter: ON / OFF** - a switch. Green means your scenes are being filtered; red means the show plays untouched.
- **Mark start** and **Mark end** - how you record a scene (see below).
- **-5s, -1s, +1s, +5s** - jump back or forward a few seconds, so you can find the exact moment.
- **Undo last** - shows up for 10 seconds after you save a scene, in case you slipped.
- **My scenes** - opens a window listing the scenes you have marked in this show.
- **?** - plays the short tour again.
- **Gear** - opens Settings in a new tab.
- **X** - hides the bar. Bring it back from the add-on's icon in the toolbar ("Show marking tools") or by pressing Alt+B.

While a saved scene is playing, a small purple tag appears on the bar, for example "Muted: bad words" or "Hidden: blood".

### Marking a scene

1. Watch until the part you want to filter begins and click **Mark start**. The button changes to something like "Start 12:34.5 ✓" and the bar turns amber.
2. When the part ends, click **Mark end**.
3. A small box pops up above the bar saying how long the scene is ("Saving 8.5s scene"). Click the kind of scene it is - for example "Bad words - mutes" or "Blood & gore - hides picture". It saves right away. You can type a note first if you like.
4. A message confirms it. Made a mistake? Click **Undo last**.

**Forgot to click Mark start?** Click **Mark end** anyway. The box asks "How long was it?" - choose 5s, 10s, 30s or 1 min (counting back from now), or "Pick start manually" and then jump back and click Mark start.

Tip: leave a second or so of safety room at each end. Matching is not frame-perfect.

### The first-time tour

The first time the bar appears, a four-step tour points out the main buttons. Use Next, Back or Skip. Click **?** any time to see it again.

### The add-on icon (top right of the browser)

Click it for the simple view:

- One big **Filter is ON / OFF** switch.
- Three one-click choices - **Little kids**, **Tweens**, **Teens** - with a line under them explaining what each filters:
  - *Little kids*: everything.
  - *Tweens*: bad words, suggestive scenes, blood & gore, death, drugs & alcohol (scary scenes allowed).
  - *Teens*: only suggestive scenes and drugs & alcohol.
- If you then change an individual item yourself, it says **Custom**.
- **Show marking tools** brings the bar back if you hid it.
- **Advanced** opens more: each kind of scene with an on/off tick box and a "what happens" choice, the scenes in the show you're watching, the automatic word filter switch, and buttons to save or load lists. The same simple and advanced views are inside the "My scenes" window on Netflix, and Settings has a Quick setup section at the top with Advanced options below the divider.

### The kinds of scene

| Name | What it does |
|---|---|
| Bad words | Mutes the sound |
| Suggestive | Hides the picture |
| Blood & gore | Hides the picture |
| Death | Skips ahead |
| Scary | Hides the picture |
| Drugs & alcohol | Skips ahead |
| Other | Hides the picture |

The four things that can happen are **Mute sound**, **Hide picture**, **Skip ahead** and **Don't filter**. You can change any kind's behaviour and rename it in Settings, add your own kinds, and give a single scene its own behaviour in "My scenes" (Advanced).

## Automatic word filter

The add-on can listen for bad words by reading the subtitles Netflix draws on screen. When a word from your list appears, the sound goes off, and comes back shortly after the line is gone. A tag "Muted: bad words (auto)" appears on the bar, with a **Save as scene** link that remembers that spot for next time (handy because saved scenes work even with subtitles off).

- **You must turn on Netflix subtitles** (any language). If none show up for about 20 seconds of playback, the add-on reminds you once.
- Edit the list in Settings: one word or phrase per line, capital letters don't matter, whole words only. A star is a wildcard: `damn*` also catches "damned".
- Settings also has "Lead time" and "Keep muted after the line ends" (at least 800 milliseconds).
- It works together with saved scenes: the sound only comes back when neither one needs it off.
- It is only as good as the subtitles. Words that the subtitles leave out or spell differently get through, and the sound is muted when the subtitle appears, which is usually (not always) at the start of the spoken line.

## Where are my marks saved?

Every time you add, change or delete a scene, the add-on also saves a small file for that show. You don't have to do anything.

- The files go in your **Downloads** folder, inside a folder called **Netflix Scene Filter**. There is one file per show, named after the show, for example `Downloads\Netflix Scene Filter\Stranger Things.json`.
- The first time it saves on a Netflix page you will see a message such as "Saved to Downloads\Netflix Scene Filter\Stranger Things.json". After that it saves quietly. Your browser may flash its download bubble each time.
- The add-on keeps its own working copy too, and that is what does the filtering. The files are a backup you can see, copy and share. If you ever reinstall the add-on, load your files back in (see below).
- If the show name Netflix gives is wrong or missing, open the "My scenes" window (Advanced) or Settings and type a better name. The file will be saved under the new name; the file with the old name stays in the folder and you can delete it yourself.
- You can turn this off with **Auto-save files** in Settings. Then use **Save my list to a file** (it saves the current show right now) or **Save all shows** when you want files.

## Sharing your scenes

1. Open `Downloads\Netflix Scene Filter` and send the other parent the file for that show (email, chat, a USB stick, anything).
2. They open Settings (the gear on the bar, or "All settings" on the add-on icon) and either click **Load a list from a file** or simply **drag the file onto the Settings page**.

Loading never erases anything; it only adds scenes that aren't already there. Files from older versions of this add-on still load. Timing can differ slightly between countries or versions of an episode.

## Keyboard shortcuts (optional)

You never need these, but they work and can be changed in Settings.

| Keys | What it does |
|---|---|
| Alt+[ | Mark start |
| Alt+] | Mark end |
| Alt+M | Open / close "My scenes" |
| Alt+F | Filter on / off |
| Alt+B | Show / hide the bar |
| Alt+Backspace | Undo the most recent scene |

## Good to know

- It can't see the picture. Netflix protects its video, so a person has to mark scenes (or the word filter has to find them in subtitles).
- Skipping ahead uses Netflix's own inner controls, which Netflix can change at any time. If skipping stops working, muting and hiding should still work.
- It only works in a computer web browser, not on TVs, phones, or the Netflix app.
- The check runs ten times a second, so a very short scene may leak a split second. Add a little safety room.
- Skipping only happens while the show is playing, so you can pause and look around inside a skip scene when marking.
- The add-on has no custom icon yet; the browser shows a default.

## For tinkerers

Plain JavaScript, no build step. `manifest.json` (version 0.3.0), `background.js` (opens Settings), `page-bridge.js` (talks to Netflix's player), `shared.js` (defaults, storage, import/export), `content.js` (bar, panel, filter loop, word filter), `popup.*`, `options.*`. Scenes are stored per Netflix video id in `chrome.storage.local` as `{start, end, category, action?, note}` in seconds. Category internal ids (`language`, `fanservice`, `blood`, `death`, `scary`, `drugs`, `other`) are unchanged; each category now also has a `label` and `help`. Library entries also carry `showTitle` and `episodeLabel`. Show files are `{ "format": "netflix-scene-filter/1", "show": ..., "exportedAt": ..., "episodes": { "<videoId>": { "episodeLabel": ..., "segments": [...] } } }` (plus an optional `categories` list), written by the service worker with the `downloads` permission as a `data:` URL. Older per-episode and library files still load.
