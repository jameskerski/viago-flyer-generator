# Handover: VIAGO Recognition Flyer Tool

**Read this first. It is written for the developer taking this over, not for Matt.**

This is a working tool, currently live at https://viago-flyers.pages.dev. It was
built in a day to prove the idea. It is now yours to own, host and extend.
Matt does not want to be in the loop for updates.

---

## What it is

Leaders pick a recognition flyer, drop in a photo, type a name, and download a
full resolution PNG ready to post. 14 templates ship with it: 5 ranks, 4
general, 5 events.

No build step. No framework. No database. Plain HTML, CSS and one JavaScript
file, plus one optional serverless function. You can open `public/index.html`
mentally and follow the whole thing.

`README.md` explains how it renders, how `templates.json` works, and how to add
or change a template. Read that second.

---

## Stand it up under your own account, about 15 minutes

You need a Cloudflare account. The free tier covers this comfortably: Pages
gives unlimited requests and bandwidth, and this is a static site plus one small
function.

```bash
# 1. get the code
unzip viago-flyers.zip && cd viago-flyers

# 2. log in to your own Cloudflare account
npx wrangler login

# 3. create the project and deploy
npx wrangler pages project create viago-flyers --production-branch main
npx wrangler pages deploy public --project-name viago-flyers --branch main
```

That gives you `https://<your-project>.pages.dev`. Point a real domain at it
whenever you like, through Cloudflare's dashboard.

**After that, Matt's copy can be switched off.** Until you do this, the live
site is running on his account.

---

## The one paid dependency, and you probably do not need it

There is an optional "cut out the background" toggle. It is **off by default**,
because these templates drop the photo into a frame, background and all.

If you want it on, set your own key. It costs about a tenth of a cent per photo.

```bash
npx wrangler pages secret put FAL_KEY --project-name viago-flyers
```

With no key the endpoint returns 501 and the browser falls back to doing the
cutout on the device. That works but downloads a ~40MB model the first time,
which is rough on a slow connection. Server-side takes about 1.5 seconds.

Matt's key is **not** in this repo and is not being handed over. Use your own.

---

## Adding new flyers, which is the main job

Most of the work here will be new templates. The process:

1. In Canva, export the page **twice**: once as-is, and once with the photo
   placeholder and the NAME text deleted.
2. Put both in the folders `tools/build_templates.py` expects.
3. Run it. It diffs the two exports, and whatever changed is the photo window
   and the name box. It works out rectangle vs circle automatically.
4. Drop the cleaned artwork into `public/art/` and check the result.

You can also just hand-write the entry in `templates.json`. It is four numbers
for the window and a handful for the name. The README documents every field.

**Ask Matt for access to the Canva design.** The artwork here is flattened, so
you cannot move a piece inside a template (like the padlock on Amplified)
without redoing it pixel by pixel. `tools/rework_amplified.py` is an example of
what that costs. If you can get the **layered** source files from whoever
designed these, get them. It will save you repeatedly.

---

## Things that will bite you

- **Cloudflare edges update unevenly.** After deploying, request the same file
  half a dozen times and only test once every response is the new one.
  Otherwise you will "fix" a bug, test it, see it still broken, and chase it.
- **`public/_routes.json` is load-bearing.** Delete it and the function
  intercepts every request including static files, causing intermittent 522s.
- **Long names wrap before they shrink**, and the line breaks are decided at the
  template's own font size then held. If you re-wrap after shrinking, a long
  name collapses back onto one tiny line. This is commented in `app.js`.
- **Every tap target is 44px minimum** and the name input is 16px so iOS does
  not zoom on focus. Keep both if you touch the CSS.

The README has the full list.

---

## What was deliberately left out

Auto-generating flyers from VIAGO back office data. It was investigated and
ruled out: the back office holds no photos, and the names in it are frequently
not the names used publicly for recognition. Leaders type the name. That is the
design, not an unfinished feature. Do not spend time on it.

---

## Handover checklist

- [ ] Deployed under your own Cloudflare account
- [ ] Your own `FAL_KEY` set, or the toggle left off
- [ ] Domain pointed wherever it should live
- [ ] Canva access from Matt, ideally the layered source files
- [ ] Matt's Cloudflare project switched off
