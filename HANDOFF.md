# Covet handoff

Local site: `/Users/cinemaninja/Documents/GitHub/COVET`, served at `http://127.0.0.1:4731/`. Live shop: `https://covetaspen.com/` (Shopify). Do not commit unless asked. Do not upload `RAWPHOTOS/`.

## Do this first when asked

Center the three press pages in `#press` / `#press-rail`. Keep it a small CSS change. Do not tour the browser.

The row is left-padded (`padding: 1.2rem 18vw` in `styles.css`, about 166px) and the third page is clipped. On a ~921px rail with `scrollLeft` 0, the first page starts near x=166 (247px wide), the second near x=485, the third near x=796 and runs past the rail. The user wants those three images centered in the rail, all visible.

`press.js` `go()` scrolls one page to the horizontal center, which fights a centered group of three. Stylesheet cache is `styles.css?v=sense12`.

## Luma

Board: https://app.lumalabs.ai/board/8bae029f-b6f4-414a-8d42-bd0e9451ab6f

It is open in the user’s Chrome, signed in. The Cursor browser is not signed in and hits a signup wall. Do not create an account.

Last look: title Untitled, page 1, three pieces already on the canvas (rectangular locket, sunburst ring, snake). The user is still organizing there. Do not rearrange the board until they say go.

Dragging a product photo out of the shop webpage onto the canvas failed. Focus jumped back to Cursor, and a webpage drag is not the high-res file. The reliable path is download the Shopify original, then drop that file from Finder.

## Shopify photos

`/products.json?limit=250` is the whole catalog: 107 products, 92 with an available variant, 15 not for sale. Page 2 is empty. Image `src` values are already the originals (one sample was 2835×2835).

Agreed plan, then paused: keep only for-sale pieces for the new site, and archive the rest so sold-out items stay off the new site. The user said sorting is not finished. Do not resume the download or treat the folders as final until they say the sort is done.

A partial download was killed on purpose. About 71 files, ~53MB, landed in `catalog/for-sale/` and `catalog/archived/` (Earrings, Rings, Chains, Charms, Handbags, Home, Accessories, Untyped, Necklaces). `catalog/index.json` was only written at the end of that script, so it may be missing. Product-type labels in Shopify are messy (`ring` vs `Rings`, blanks).

Category collections on the shop, for later section names: Earrings, Rings, Chains + Locks, Charms, Necklaces, Pendants & Charms, Handbags, plus designer collections (Jacquie Aiche and others).

## Already on the local site

Press section exists (`#press`, pages in `images/press/`). Hero jewel is the opal eye-burst cutout. Python Star necklace and The Halles / Round Top, Texas address are removed. Aspen landscape photos are faded into the page (not hard rectangles). House section uses the portrait. Close look, pointer light, time-of-day wash, and the falling feather are in. Linotype Didot Headline is still not licensed. Do not pirate it. Gold-on-pink cutouts use `tools/cutout.py`.
