# The mobile freeze (phase 0 of the desktop look)

The phone (below 768 px) must stay exactly as it is while the computer's look is built. `qa/mobile-baseline/` holds a picture of every phone screen at 360, 390
and 430 px; `qa/mobile/visual.mjs check` takes them again and fails on **one** different pixel.

It runs on a developer's machine, not in CI: it needs a browser (Edge or Chrome), a running local server and a database filled with the made-up company.

```sh
# once: a throwaway database (its name ends in _demo or _qa), migrated, then `npm run db:seed`; build and start the app on port 3105 against it
QA_PASSWORD=<that seed's test password> QA_DB_NAME=<that database> node qa/mobile/seed.mjs
QA_PASSWORD=<…> node qa/mobile/visual.mjs check
```

- Only a local server is ever opened (`localhost`).
- The browser's clock, time zone, motion and caret are fixed; reading, delivery, presence and the live line are blocked, so taking a picture changes nothing.
- A failed screen leaves the new picture and a `.diff.png` (different pixels in red) in `qa/mobile/out/`.
- `capture` replaces the committed pictures. Do it only after the owner approved a change to the phone.
- Fonts are drawn by the operating system: pictures taken on Windows are compared on Windows.
