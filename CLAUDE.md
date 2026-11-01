# claude-plugins

## The design system has one source

- `shared/style.ts` (tokens, glyphs, formats, motion) and `shared/kit.tsx` (header, tabs, search, meter, card, footer) are the only place the mods' look is written. `DESIGN.md` says why.
- Each mod's `hooks/style.ts`, `hooks/style.test.ts` and `hooks/kit.tsx` are generated copies. Never edit them: edit `shared/`, then run `node scripts/check-style.mjs --write`.
- A pane or band draws its chrome only through the kit: `header` first row, one blank row, then `tabs` or `search`, then its body. Never hand-draw a header row, a tab, a search field, a card frame, a footer or a fill meter in a mod; if the kit lacks something, add it to `shared/kit.tsx` so every mod gets it.
- Before changing a look, read `DESIGN.md`; change it there in the same commit, so a later session does not undo it.

## Checks

- `node scripts/check-style.mjs` (copies in sync, no hand-made search field, no emoji-capable glyph, surface ticks).
- `claude plugin test <mod>` for each of gloss, pulse, postcard, flightdeck, filetree.
- `claude plugin validate <mod>`.
