---
name: 姥姥的回忆录
description: A family memoir recorder dressed as a piece of Cizhou ware from 姥姥's own Handan; white slip, iron-black brushwork, one ochre stroke.
colors:
  slip: "#f3f2ee"
  slip-hi: "#fbfaf7"
  iron: "#2a1d16"
  iron-soft: "#4f453d"
  ochre: "#9c5a24"
  ochre-deep: "#7d4518"
  ochre-wash: "#f0e2d2"
  glaze: "#d9d3c7"
  glaze-ink: "#3d332c"
  rim-ink: "#ece5da"
  rec: "#a8321f"
typography:
  display:
    fontFamily: "LXGW WenKai, Kaiti SC, STKaiti, serif"
    fontSize: "clamp(2.1rem, 3.3vw, 3.1rem)"
    fontWeight: 400
    lineHeight: 1.3
  headline:
    fontFamily: "LXGW WenKai, Kaiti SC, STKaiti, serif"
    fontSize: "1.9rem"
    fontWeight: 400
    lineHeight: 1.3
  title:
    fontFamily: "LXGW WenKai, Kaiti SC, STKaiti, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.3
  words:
    fontFamily: "Noto Serif SC, Songti SC, serif"
    fontSize: "1.15rem"
    fontWeight: 500
    lineHeight: 1.95
  body:
    fontFamily: "-apple-system, PingFang SC, Hiragino Sans GB, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, PingFang SC, Hiragino Sans GB, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  prose: "8px"
  field: "14px"
  card: "18px"
  well: "22px"
  panel: "24px"
  pill: "999px"
spacing:
  xs: "0.3rem"
  sm: "0.6rem"
  md: "0.9rem"
  lg: "1.6rem"
  xl: "2.4rem"
  gutter: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.ochre}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0.85rem 1.7rem"
  button-primary-hover:
    backgroundColor: "{colors.ochre-deep}"
  pill:
    backgroundColor: "{colors.slip-hi}"
    textColor: "{colors.iron}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1.1rem"
  pill-hover:
    backgroundColor: "{colors.iron}"
    textColor: "{colors.slip-hi}"
  pill-strong:
    backgroundColor: "{colors.ochre-wash}"
    textColor: "{colors.ochre-deep}"
    rounded: "{rounded.pill}"
  pill-quiet:
    textColor: "{colors.iron-soft}"
    rounded: "{rounded.pill}"
  band-segment:
    backgroundColor: "{colors.slip-hi}"
    textColor: "{colors.iron}"
    padding: "0.5rem 1.05rem"
  band-segment-done:
    backgroundColor: "{colors.iron}"
    textColor: "{colors.rim-ink}"
  band-segment-current:
    backgroundColor: "{colors.ochre}"
    textColor: "#ffffff"
  topbar:
    backgroundColor: "{colors.iron}"
    textColor: "{colors.rim-ink}"
    height: "76px"
  mic:
    backgroundColor: "{colors.iron}"
    textColor: "{colors.slip-hi}"
    size: "128px"
  mic-recording:
    backgroundColor: "{colors.rec}"
  transcript-well:
    backgroundColor: "{colors.slip-hi}"
    typography: "{typography.words}"
    rounded: "{rounded.well}"
    padding: "1.1rem 1.4rem"
  era-panel:
    backgroundColor: "{colors.glaze}"
    textColor: "{colors.iron}"
    width: "420px"
  cue-card:
    backgroundColor: "{colors.slip-hi}"
    rounded: "{rounded.card}"
    padding: "1rem 1.1rem"
  panel:
    backgroundColor: "{colors.slip-hi}"
    rounded: "{rounded.panel}"
    padding: "1.5rem 1.6rem"
  field-input:
    backgroundColor: "{colors.slip}"
    rounded: "{rounded.field}"
    padding: "0.6rem 0.85rem"
  tag:
    textColor: "{colors.iron-soft}"
    rounded: "{rounded.pill}"
    padding: "0 0.5rem"
  tag-local:
    backgroundColor: "{colors.ochre-wash}"
    textColor: "{colors.ochre-deep}"
---

# Design System: 姥姥的回忆录

## Overview

**Creative North Star: "The Handan Jar"**

The app is a piece of 磁州窑 (Cizhou ware) from 姥姥's own Handan: a white-slip body, painted in iron-black brushwork, with one warm ochre stroke. The page is the slip ground; the header is the dark rim round the jar's mouth with an ochre band beneath it; controls are painted bands, pill-shaped and outlined in a 2px iron line. The display face, LXGW WenKai, keeps a brush-written character, so headings read as written rather than set.

Density is calm and operator-sized: an 18px root, one large question per screen, generous wells for her words. The operator sits in a lit room beside an elderly speaker, so the system is light only, set by the use scene rather than by preference. The surface stays flat; depth comes from fills and outlines, with soft shadow kept to the two physical objects (the primary save pill and the mic).

The confirmed anti-references are the cream-paper + serif + terracotta memoir default and the grey productivity-tool default. The world answers both with a specific regional material instead of a genre mood.

**Key Characteristics:**
- White slip ground, iron-black ink and outlines, one ochre accent for "now" and "primary".
- 2px iron outlines and pill silhouettes as painted bands.
- Three type voices: brush display (WenKai), her words (Noto Serif SC), operator UI (PingFang).
- The stage band is the signature: talked-through stages are fired iron, the current one is ochre.
- Era context sits on a grey glaze panel and never reaches the printed book.
- Light only.

## Colors

A ceramic palette: warm off-white slip, iron black-brown brushwork, and a single fired ochre, with a grey glaze for reference material.

### Primary
- **Fired Ochre** (ochre): the current stage segment, the primary save button, focus rings, selection, caret, the ochre band under the header, the mic's outer ring. It means "now" or "do this".
- **Deep Ochre** (ochre-deep): ochre as text and hover; links, the free-memory question, decade headings, era years, strong pills.
- **Ochre Wash** (ochre-wash): the ground for 姥姥's spontaneous memories (unsorted block, free log items) and local-region tags.

### Tertiary
- **Record Red** (rec): recording state only (mic while recording, live well border) plus errors and destructive actions.

### Neutral
- **Slip White** (slip): the page ground.
- **Fresh Glaze** (slip-hi): the raised surfaces painted onto the slip; wells, cards, pills, panels, the stage band's unfired segments.
- **Iron Black** (iron): the header rim, all ink, 2px outlines, fired stage segments, the mic body.
- **Soft Iron** (iron-soft): secondary ink on slip; hints, ledes, metadata, dashed note borders.
- **Grey Glaze** (glaze): the 那一年 era panel, the on-screen "that year" strip, quiet hovers and hairline dividers.
- **Glaze Ink** (glaze-ink): secondary ink on the glaze panel.
- **Rim Ink** (rim-ink): text and outlines on the iron header and on fired segments.

### Named Rules
**The Ochre Is Now Rule.** Ochre marks the current stage, the primary action, focus, or her unprompted memories. One ochre fill per view; everything else is iron on slip.

**The Glaze Is Context Rule.** Grey glaze carries reference material that helps her recall (era cues, "that year" strips). Her own words never sit on glaze, and glaze content is excluded from print.

**The Light Only Rule.** One light scheme (`color-scheme: light`). The app is used in a lit room beside her; there is no dark mode.

## Typography

**Display Font:** LXGW WenKai (with Kaiti SC, STKaiti, serif), via the lxgw-wenkai-webfont jsdelivr package
**Words Font:** Noto Serif SC (with Songti SC, serif), Google Fonts weights 500 and 700
**UI Font:** system / PingFang SC (with Hiragino Sans GB, sans-serif)

**Character:** A brush-written kaiti for anything the app says in its own voice at size, a quiet Song serif for what 姥姥 says, and the plain system face for operator controls. WenKai was chosen over ZCOOL XiaoWei because it covers GB2312+ and AI-written questions cannot be trusted to stay inside a small glyph set.

### Hierarchy
- **Display** (WenKai 400, clamp(2.1rem, 3.3vw, 3.1rem), 1.3): the one question being asked, balanced wrap, max 25em. Page titles use clamp(2rem, 3vw, 2.8rem) at 1.25; the start screen title clamp(2.4rem, 4vw, 3.4rem).
- **Headline** (WenKai 400, 1.5–1.9rem): chapter titles (1.9rem), era panel title (1.75rem), decade headings (1.6rem, deep ochre).
- **Title** (WenKai 400, 1.35–1.5rem): panel and section titles, timeline dates, the brand in the rim (1.65rem, 0.1em tracking).
- **Words** (Noto Serif SC, 1.1–1.3rem, 1.85–1.95): her transcripts, memoir prose (1.15rem / 1.95, first-line indent 2em, max 36em), cited source excerpts, era prompts. The live well sets it at 1.3rem.
- **Body** (UI 400, 1rem, 1.6): operator text, cue titles, list items (max 40rem).
- **Label** (UI, 0.8–0.9rem): hints, tags, metadata, tool links, the stage band (0.9rem).

### Named Rules
**The Her Words Rule.** Noto Serif SC is reserved for spoken or quoted words: hers, her sources, the lines read to her. Never use it for UI chrome.

**The Brush Is Never Bold Rule.** WenKai is set at weight 400 everywhere; hierarchy comes from size, not weight.

## Layout

An 18px root (16px under 700px). The interview is a two-column grid: a flexible work column (padding 2rem 3rem 3rem) beside a fixed 420px glaze panel that is sticky under the header. Other pages are centered single columns: 1180px default, 860px narrow, 880px for the book, 1120px for the start screen. Settings use an auto-fit grid of 320px-min panels with a 1.6rem gap.

The rhythm runs in rem steps: 0.3 / 0.6 / 0.9 rem inside components, 1.2–1.6rem between groups, 2.4–3rem between sections. The question carries 1.4rem below it; the log opens 3rem below the work.

Responsive: at 1100px the era panel drops below the work column and trades its left rule for a top rule. At 700px the header wraps, the record row stacks around the mic, timeline rows collapse to one column, and the stage band becomes a 4-across grid with short labels.

Print (A4, 22/20/24mm margins) produces a book: a centered title page, each chapter starting on a new page with a centered opener 30mm down, prose at 12pt, and the header, toasts, and era context removed.

## Elevation & Depth

The surface is flat. Depth comes from the slip/fresh-glaze/glaze value steps and 2px iron outlines, not from shadow. Three shadows exist, each on a physical object: the primary save pill sits slightly raised, the mic is a ringed object, and the toast floats over content.

### Shadow Vocabulary
- **Pressed-clay lift** (`box-shadow: 0 6px 14px rgba(124, 69, 24, .25)`): the primary button only; shrinks on press.
- **Mic ring** (`box-shadow: 0 0 0 6px var(--slip), 0 0 0 9px var(--ochre), 0 10px 24px rgba(42, 29, 22, .25)`): a slip gap, an ochre ring, a soft drop. Breathes outward in red while recording.
- **Toast float** (`box-shadow: 0 8px 24px rgba(42, 29, 22, .3)`): transient feedback only.

### Named Rules
**The Flat Slip Rule.** Cards, panels, wells, and pills take no shadow. Lift them with fresh glaze on slip and an iron line.

## Shapes

Everything is rounded, nothing is square. Interactive controls are full pills (999px): buttons, tool pills, tags, selects, the backup pill, and the stage band itself. Containers step down by size: panels 24px, wells and the unsorted block 22px, cue cards and the toast 18px, fields and source boxes 14px, the prose hover 8px. The mic is a circle.

Lines carry the brushwork. The primary outline is 2px iron (`--line`), used on pills, the band, wells, panels, the era panel's edge, and section rules. Secondary dividers are 1.5px (band segment separators, cue cards, fields, glaze hairlines between log items). Chapter heads carry a heavier 3px iron rule. Notes and citation boxes use a 1.5px dashed soft-iron border, marking them as annotation rather than content. The header rim ends in a full-width 6px ochre band.

## Components

### Buttons
Painted bands: outlined, pill-shaped, inverting to iron on hover.
- **Shape:** full pill (999px).
- **Primary:** fired ochre fill, white 700 text at 1.1rem, padding 0.85rem 1.7rem, pressed-clay shadow. Hover to deep ochre; active nudges down 1px. A small variant runs 0.55rem 1.2rem at 0.95rem.
- **Pill (default):** fresh glaze with a 2px iron outline, iron text, 0.5rem 1.1rem, inline 20px icon. Hover inverts to iron fill with slip text.
- **Strong pill:** ochre wash with a deep ochre outline and text, 600 weight; hover fills deep ochre. Used for "姥姥想起别的事", the spontaneous-memory action.
- **Quiet pill:** no outline or fill, soft iron text; hover gets a glaze fill.
- **Link:** deep ochre underlined text at 0.85rem, offset 3px. Danger variants use record red.
- **Disabled:** 45% opacity, not-allowed cursor.

### Stage Band (signature)
The jar's painted band. One outlined pill strip (2px iron, fresh glaze) holding a segment per life stage, split by 1.5px iron rules. Stages already talked through are fired: iron fill with rim-ink text. The current stage glows: ochre fill, white 600 text. Untouched segments stay fresh glaze and hover to grey glaze. On narrow screens it becomes a 4-across grid with an 18px radius and short labels.

### Rim Header
A sticky 76px iron bar with a 6px ochre band beneath it. The brand sits left in WenKai at white; tabs are rim-ink text with a 3px underline that turns ochre for the current page. The backup status is a 1.5px rim-ink outlined pill on the right; a stale backup turns it warm amber.

### Mic
A 128px iron disc with the mic icon and label, ringed in ochre across a slip gap. Hover scales to 1.03. Recording turns it record red with a slow 2.2s breathing ring; reduced motion stops the breath.

### Transcript Well
Where her words land. Fresh glaze, 2px iron outline, 22px radius, padding 1.1rem 1.4rem, Noto Serif SC at 1.3rem / 1.85, vertically resizable. The placeholder drops to the UI face. While live it switches to a dashed record-red outline.

### Cards / Containers
- **Era panel:** grey glaze column with an iron left rule, 2rem 1.8rem padding.
- **Cue card:** fresh glaze, 1.5px iron outline, 18px radius, padding 1rem 1.1rem; year in WenKai deep ochre.
- **Settings panel:** fresh glaze, 2px iron outline, 24px radius, padding 1.5rem 1.6rem.
- **Unsorted memories:** ochre wash block, 22px radius, no outline.
- **Mode note / sources:** fresh glaze with a 1.5px dashed soft-iron outline, 14px radius.

### Inputs / Fields
- **Style:** slip ground, 1.5px iron outline, 14px radius, padding 0.6rem 0.85rem; labels 600 at 0.88rem. Selects are pills with the same outline.
- **Focus:** the global 3px ochre outline, offset 2px; caret is ochre.

### Chips (tags)
Small pills (0.7rem) with a 1.5px soft-iron outline. The local variant (Handan events) takes ochre wash with deep ochre outline and text.

### Toast
Iron with slip text, 2px ochre outline, 18px radius, sliding in from the right under the header (0.3s, cubic-bezier(.16, 1, .3, 1)); errors turn record red with an iron outline. On mobile it docks to the bottom.

### Icons
Authored inline SVG on a 24px grid, 2px currentColor stroke, round caps and joins, 20px by default; they inherit the text color of their pill.

## Do's and Don'ts

### Do:
- **Do** outline controls and containers in 2px iron (`--line`) and use 1.5px for dividers inside them.
- **Do** keep ochre for the current stage, the primary action, focus, and her spontaneous memories.
- **Do** mark progress with the stage band: fired iron for done, ochre for current, fresh glaze for not yet.
- **Do** set her words in Noto Serif SC and the app's own large voice in LXGW WenKai at weight 400.
- **Do** put era and context material on grey glaze and keep it out of the printed book.
- **Do** draw new icons as 24px-grid SVG with a 2px round stroke in currentColor.

### Don't:
- **Don't** add a dark mode; the system is light only.
- **Don't** drift toward the cream-paper + serif + terracotta memoir look or a grey productivity-tool look.
- **Don't** use square corners on controls; buttons, tags, and selects are full pills.
- **Don't** add shadows to cards, panels, or wells; shadow belongs to the primary button, the mic, and the toast.
- **Don't** use emoji or text glyphs as icons.
- **Don't** let a display font with partial CJK coverage near AI-generated text; it must cover GB2312 at minimum.
