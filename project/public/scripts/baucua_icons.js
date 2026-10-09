/*
 * The six animals of Bầu cua, drawn (the same on every system - no emoji).
 * Flat like the other game icons (no outlines). baucuaIcon(id) -> an <svg> element.
 * No gradients or ids: many of them on a page.
 */
var BAUCUA_ART = {
  tiger:
    // A tiger's head: ears, orange face with dark stripes, a white muzzle (flat, like the other game icons)
    '<path d="M11 24 8 8l15 7z" fill="#d18a45"/><path d="M53 24l3-16-15 7z" fill="#d18a45"/>' +
    '<path d="M12 13.5 14 21l5-3.5zM52 13.5 50 21l-5-3.5z" fill="#f5d6b5"/>' +
    '<ellipse cx="32" cy="35" rx="24" ry="22" fill="#e8a25a"/>' +
    '<path d="M8.5 38c1.5 9 10.5 17 23.5 17s22-8 23.5-17c-5 6-13 9-23.5 9S13.5 44 8.5 38z" fill="#d18a45"/>' +
    '<path d="M32 13v8M25.5 14.5l2 6M38.5 14.5l-2 6M8.5 31h7M9 38.5l6.5-2M55.5 31h-7M55 38.5l-6.5-2" stroke="#8a5530" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M19 44c0-7 5.5-10.5 13-10.5S45 37 45 44c0 6.5-5.5 11-13 11s-13-4.5-13-11z" fill="#f7efe4"/>' +
    '<ellipse cx="23" cy="30" rx="3.2" ry="3.8" fill="#3d3028"/><ellipse cx="41" cy="30" rx="3.2" ry="3.8" fill="#3d3028"/>' +
    '<circle cx="24.2" cy="28.6" r="1.1" fill="#fff"/><circle cx="42.2" cy="28.6" r="1.1" fill="#fff"/>' +
    '<path d="M28 38.5h8l-4 4.5z" fill="#e0675a"/>' +
    '<path d="M32 43v3M32 46c-2 2.5-5 2.5-6.5.5M32 46c2 2.5 5 2.5 6.5.5" stroke="#8a5530" stroke-width="2" fill="none" stroke-linecap="round"/>',
  gourd:
    // A calabash: two round parts, a stem and a leaf
    '<path d="M30 8h4v8h-4z" fill="#9a7350"/>' +
    '<path d="M33 12c5-6 14-5 16 1-6 3-12 3-16-1z" fill="#6fa784"/><path d="M35 12.2c4-1.6 8-1.4 11.5 0" stroke="#55876a" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M32 14c-6.5 0-10 4-10 9 0 3.5 1.8 5.6 3.5 7C19 32.7 14.5 38 14.5 44.5 14.5 52 22.3 58 32 58s17.5-6 17.5-13.5c0-6.5-4.5-11.8-11-14.5 1.7-1.4 3.5-3.5 3.5-7 0-5-3.5-9-10-9z" fill="#b5bd62"/>' +
    '<path d="M49.5 44.5C49.5 52 41.7 58 32 58c-6 0-11-2.2-14.2-5.6 3 1.6 6.6 2.4 10.2 2.4 9.7 0 17.5-5.7 17.5-13.2 0-3.8-1.5-7.2-4-9.9 4.8 3 8 7.6 8 12.8z" fill="#9aa24e"/>' +
    '<path d="M27 19c-1.5 1.5-2 3.5-1.5 5.5M21.5 38c-2 2.5-2.5 6-1.5 9" stroke="#eef0cf" stroke-width="2.8" fill="none" stroke-linecap="round"/>' +
    '<path d="M24.5 30.5c4.8 1.6 10.2 1.6 15 0" stroke="#858d45" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  rooster:
    // A rooster from the side: red comb, yellow beak, a green tail
    '<path d="M38 42c3-11 8-21 19-25-2 6-2 10 0 13-6-1-9 2-10 6 4-2 8-1 10 2-6 0-10 3-12 8z" fill="#6fa784"/>' +
    '<path d="M43 34c3-5.5 6.5-9.5 12-12" stroke="#e0675a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M13.5 15c-.5-4 2.5-6.5 5-4.5 1-3.2 5.2-3.2 6.2 0 2.2-2 5.4.2 4.2 3.4z" fill="#e0675a"/>' +
    '<path d="M27 15c-6-2-13.5 1-13.5 8 0 4 2 7 4 9-2 5-1 12 4 17 6 6 17.5 6 22.5 0 4-5 4-11 1-16-3-4-8-5-12-6-1-6-2-10-6-12z" fill="#f7efe2"/>' +
    '<path d="M44 33c3 5 3 11-1 16-5 6-16.5 6-22.5 0-1.3-1.3-2.3-2.7-3.1-4.2 6 4.6 15.6 4.4 20.1-1 3.2-3.9 3.7-8.3 2.3-12.6 1.8.4 3.3 1 4.2 1.8z" fill="#ece0c8"/>' +
    '<path d="M24 35c4 2 9 2 13 0-1 5-5 8-9 7" stroke="#e0b070" stroke-width="2.8" fill="none" stroke-linecap="round"/>' +
    '<path d="M13.5 20.5 6.5 23.5l7 3z" fill="#e3b25a"/>' +
    '<path d="M15 26.5c-1 4 0 7 3 7 2 0 2.5-3 1-6z" fill="#e0675a"/>' +
    '<circle cx="20" cy="20" r="2.3" fill="#3d3028"/><circle cx="20.7" cy="19.3" r=".75" fill="#fff"/>' +
    '<path d="M27 52v6m-3 0h6M35 52v6m-3 0h6" stroke="#d9a84e" stroke-width="2.6" stroke-linecap="round"/>',
  fish:
    // A fish from the side: blue body, a tail, a fin, scales
    '<path d="M46 32 60 20v24z" fill="#4f7fc4"/>' +
    '<path d="M24 19c3-6 10-8 15-6l-3 7z" fill="#4f7fc4"/>' +
    '<path d="M4 32c5-10 15-15 26-15 10 0 17 6 20 15-3 9-10 15-20 15C19 47 9 42 4 32z" fill="#7ba7e0"/>' +
    '<path d="M6 35c6 7 15 10 24 10 7 0 13-3 17-9-4 7-10 11-17 11C19 47 10 42 6 35z" fill="#6a96d4"/>' +
    '<path d="M9 34c6 5.5 13.5 8 21 8 5.5 0 10.5-2.2 14-6" stroke="#dceaf8" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".8"/>' +
    '<path d="M26 26c2 2 2 6 0 8M33 25c2 2.5 2 7.5 0 10M40 26c2 2 2 6 0 8" stroke="#4f7fc4" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    '<circle cx="14" cy="29" r="3.4" fill="#fff"/><circle cx="14.6" cy="29" r="1.8" fill="#2c3e55"/>' +
    '<path d="M27 45c2 4 6 5 9 4l-2-4z" fill="#4f7fc4"/>',
  crab:
    // A crab from the front: red shell, two big claws, legs, eyes on stalks
    '<path d="M14 38 5 42M14 43 6 49M15 47l-6 8M50 38l9 4M50 43l8 6M49 47l6 8" stroke="#b9564b" stroke-width="3.4" stroke-linecap="round"/>' +
    '<path d="M18 31c-6-2-10.5-7.5-9.5-14.5l5 4c1-3 3-5 6-6-1 4 0 7 2 9z" fill="#e0675a"/>' +
    '<path d="M46 31c6-2 10.5-7.5 9.5-14.5l-5 4c-1-3-3-5-6-6 1 4 0 7-2 9z" fill="#e0675a"/>' +
    '<path d="M27 27v-7M37 27v-7" stroke="#b9564b" stroke-width="2.6" stroke-linecap="round"/>' +
    '<circle cx="27" cy="18" r="3.6" fill="#fff" stroke="#b9564b" stroke-width="1.4"/><circle cx="37" cy="18" r="3.6" fill="#fff" stroke="#b9564b" stroke-width="1.4"/>' +
    '<circle cx="27.5" cy="18.4" r="1.8" fill="#3d3028"/><circle cx="36.5" cy="18.4" r="1.8" fill="#3d3028"/>' +
    '<path d="M12 39c0-8 9-13 20-13s20 5 20 13c0 7-9 12-20 12s-20-5-20-12z" fill="#e0675a"/>' +
    '<path d="M12.3 41c1.8 6 10 10 19.7 10s17.9-4 19.7-10c-3.8 4.2-11 6.8-19.7 6.8S16.1 45.2 12.3 41z" fill="#c9564b"/>' +
    '<path d="M19 34c3-3 8-4.5 13-4.5" stroke="#f3a99f" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
    '<circle cx="24" cy="40" r="1.7" fill="#a84a40"/><circle cx="32" cy="41.5" r="1.7" fill="#a84a40"/><circle cx="40" cy="40" r="1.7" fill="#a84a40"/>',
  shrimp:
    // A shrimp curled up: pink segments, a tail fan, long feelers
    '<path d="M19 15C14 8 8 6 3 8M22 13c-2-6-5-9-10-11" stroke="#d8837a" stroke-width="2" fill="none" stroke-linecap="round"/>' +
    '<path d="M38 52c-4 1-8 5-9 9l7-2 2 4c3-3 4-7 3-11z" fill="#e08f86"/>' +
    '<path d="M18 22c3-6 11-9 19-8 11 1 19 9 19 20 0 11-8 18-18 18-4 0-6-3-5-6 1-2 3-3 5-3 5 0 8-4 8-9 0-6-5-10-11-10-5 0-9 1-12 3z" fill="#f0b0a8"/>' +
    '<path d="M56 34c0 11-8 18-18 18-4 0-6-3-5-6 .6 1.4 2.3 2.4 5 2.4 9 0 15.5-6.2 16-15.4.2-2.6-.1-5.1-.8-7.4 1.8 2.5 2.8 5.3 2.8 8.4z" fill="#e39a91"/>' +
    '<path d="M36 15.5c-1 3-1 5 1 8M45 19c-2 2-3 5-2 8M52 27c-3 1-5 3-5.5 6M53 38c-3-.5-5.5.5-7 2.5M47 47c-2-2-4.5-2.5-7-2" stroke="#d8837a" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M18 22c-3 1-5 3-5 5 3 1 6 0 8-2z" fill="#f0b0a8"/>' +
    '<circle cx="22" cy="19.5" r="2.5" fill="#3d3028"/><circle cx="22.7" cy="18.8" r=".8" fill="#fff"/>' +
    '<path d="M25 27l-4 7M30 27l-3 8M35 28l-2 8" stroke="#d8837a" stroke-width="2" stroke-linecap="round"/>',
};

function baucuaIcon(id) {
  var holder = document.createElement("span");
  holder.innerHTML = '<svg class="bc-art" viewBox="0 0 64 64" aria-hidden="true">' + (BAUCUA_ART[id] || "") + "</svg>";
  return holder.firstChild;
}
