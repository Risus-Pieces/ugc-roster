import type { CSSProperties } from "react";

/**
 * Pixel sprites drawn from character grids: each letter maps to a colour in the sprite's palette,
 * "." is transparent. Rendered as crisp SVG rects so they scale without blurring.
 */
type SpriteDef = { rows: string[]; palette: Record<string, string> };

const BROWN = "#5c3a1e";
const WOOD = "#b07a42";
const GOLD = "#f2be3b";
const GOLD_DARK = "#b98216";
const LEAF = "#4e9a3a";
const LEAF_DARK = "#2e6b27";
const PAPER = "#fbefd2";
const INK = "#3b2414";

export const SPRITES = {
  sun: {
    rows: ["...YY...", ".Y.YY.Y.", "..YOOY..", "YYOYYOYY", "YYOYYOYY", "..YOOY..", ".Y.YY.Y.", "...YY..."],
    palette: { Y: GOLD, O: "#e08a1e" },
  },
  sprout: {
    rows: ["........", ".GG..GG.", "GGGggGGG", ".GG.g.G.", "....g...", "....g...", ".BBBBBB.", "BBBBBBBB"],
    palette: { G: LEAF, g: LEAF_DARK, B: "#7a4a1e" },
  },
  seeds: {
    rows: ["..DDDD..", "...DD...", "..TTTT..", ".TTTTTT.", "TTTGGTTT", "TTGGGGTT", "TTTGGTTT", ".TTTTTT."],
    palette: { D: BROWN, T: "#d9a55b", G: LEAF },
  },
  letter: {
    rows: ["........", "DDDDDDDD", "DWDWWDWD", "DWWDDWWD", "DWWWRWWD", "DWWWWWWD", "DDDDDDDD", "........"],
    palette: { D: BROWN, W: PAPER, R: "#c0392b" },
  },
  scroll: {
    rows: [".DDDDDD.", "DWWWWWWD", ".WIIIIW.", ".WWWWWW.", ".WIIIWW.", ".WWWWWW.", "DWWWWWWD", ".DDDDDD."],
    palette: { D: BROWN, W: PAPER, I: INK },
  },
  star: {
    rows: ["...YY...", "...YY...", "YYYYYYYY", ".YYOOYY.", "..YYYY..", ".YY..YY.", ".Y....Y.", "........"],
    palette: { Y: GOLD, O: "#e08a1e" },
  },
  magnifier: {
    rows: [".BBBB...", "BLLLLB..", "BLWLLB..", "BLLLLB..", ".BBBBD..", ".....DD.", "......DD", ".......D"],
    palette: { B: "#2d5e8c", L: "#bfddf0", W: "#ffffff", D: BROWN },
  },
  chart: {
    rows: ["........", "......G.", "...Y..G.", "...Y..G.", "R..Y..G.", "R..Y..G.", "DDDDDDDD", "........"],
    palette: { G: LEAF, Y: GOLD, R: "#c0392b", D: BROWN },
  },
  signpost: {
    rows: ["...D....", "TTTTTT..", "TTTTTTT.", "TTTTTT..", "...D....", "..TTTTTT", ".TTTTTTT", "...D...."],
    palette: { D: BROWN, T: WOOD },
  },
  coin: {
    rows: ["..OOOO..", ".OYYYYO.", "OYWYYOYO", "OYWYOYYO", "OYYOYYYO", "OYYYYYYO", ".OYYYYO.", "..OOOO.."],
    palette: { O: GOLD_DARK, Y: GOLD, W: "#fff3c4" },
  },
  wheat: {
    rows: ["..Y..Y..", ".YYYYYY.", "..YYYY..", "...DD...", "..YDDY..", ".YYDDYY.", "...DD...", "...DD..."],
    palette: { Y: GOLD, D: "#a8761a" },
  },
  hammer: {
    rows: [".SSSS...", "SSSSSS..", ".SSSSD..", "....DD..", "...DD...", "..DD....", ".DD.....", "DD......"],
    palette: { S: "#9aa3a8", D: WOOD },
  },
  chicken: {
    rows: ["..RR....", ".WWWW...", ".WKWWY..", ".WWWWYY.", "WWWWWWW.", "WWWWWWW.", ".WWWWW..", "..O.O..."],
    palette: { R: "#d23b2b", W: "#fff6e0", K: INK, Y: "#f2a33b", O: "#e08a1e" },
  },
  heart: {
    rows: ["........", ".RR.RR..", "RRRRRRR.", "RWRRRRR.", "RRRRRRR.", ".RRRRR..", "..RRR...", "...R...."],
    palette: { R: "#d23b2b", W: "#ffb3a6" },
  },
  crop0: {
    rows: ["........", "........", "........", "........", "........", "....g...", ".BBBBBB.", "BBBBBBBB"],
    palette: { g: LEAF, B: "#7a4a1e" },
  },
  crop1: {
    rows: ["........", "........", "........", "...GG...", "..G.gG..", "....g...", ".BBBBBB.", "BBBBBBBB"],
    palette: { G: LEAF, g: LEAF_DARK, B: "#7a4a1e" },
  },
  crop2: {
    rows: ["..O..O..", ".OOGGOO.", "..GOOG..", ".GGggGG.", "..G.gG..", "....g...", ".BBBBBB.", "BBBBBBBB"],
    palette: { O: "#f08a24", G: LEAF, g: LEAF_DARK, B: "#7a4a1e" },
  },
} satisfies Record<string, SpriteDef>;

export type SpriteName = keyof typeof SPRITES;

/** One path per colour, with horizontal runs merged: ~6 elements per sprite instead of ~64 rects. */
function pathsByColor(rows: string[], palette: Record<string, string>) {
  const out: Record<string, string> = {};
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      const fill = palette[ch];
      if (ch !== "." && fill) out[fill] = (out[fill] ?? "") + `M${x} ${y}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return out;
}

function Grid({ rows, palette, scale, className, style, title }: SpriteDef & { scale: number; className?: string; style?: CSSProperties; title?: string }) {
  const w = rows[0].length;
  const h = rows.length;
  return (
    <svg
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      style={{ shapeRendering: "crispEdges", flexShrink: 0, ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {Object.entries(pathsByColor(rows, palette)).map(([fill, d]) => (
        <path key={fill} d={d} fill={fill} />
      ))}
    </svg>
  );
}

export function Sprite({ name, scale = 2, className, style, title }: { name: SpriteName; scale?: number; className?: string; style?: CSSProperties; title?: string }) {
  return <Grid {...SPRITES[name]} scale={scale} className={className} style={style} title={title} />;
}

// ─── Villager portraits ─────────────────────────────────────────────────────

const SKIN = ["#f6d3b0", "#e8b48a", "#c68a5e", "#8d5a3b"];
const HAIR = ["#3b2414", "#6b4423", "#c9802e", "#f2c14e", "#a33b2b", "#2d2d2d", "#7d5aa6"];
const SHIRT = ["#4e8a3a", "#2d5e8c", "#b03a22", "#8a5a2c", "#c77dba", "#e0a21e"];
const BG = ["#c5e3a0", "#bfddf0", "#f8d66d", "#f5bfa6", "#e3cdf2"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const HAIRSTYLES = [
  // short
  ["..HHHH..", ".HHHHHH.", ".HSSSSH.", ".SKSSKS.", ".SSSSSS.", "..SMMS..", ".CCCCCC.", "CCCCCCCC"],
  // long
  ["..HHHH..", ".HHHHHH.", "HHSSSSHH", "HSKSSKSH", "HSSSSSSH", "HHSMMSHH", "HCCCCCCH", "CCCCCCCC"],
  // straw hat
  ["..TTTT..", "TTTTTTTT", ".SSSSSS.", ".SKSSKS.", ".SSSSSS.", "..SMMS..", ".CCCCCC.", "CCCCCCCC"],
  // bun
  ["...HH...", "..HHHH..", ".HHHHHH.", ".SKSSKS.", ".PSSSSP.", "..SMMS..", ".CCCCCC.", "CCCCCCCC"],
];

/** A deterministic little villager for each creator, so people are recognisable at a glance. */
export function Villager({ seed, scale = 3, className, title }: { seed: string; scale?: number; className?: string; title?: string }) {
  const h = hash(seed);
  const rows = HAIRSTYLES[h % HAIRSTYLES.length];
  const palette = {
    H: HAIR[(h >>> 3) % HAIR.length],
    S: SKIN[(h >>> 7) % SKIN.length],
    C: SHIRT[(h >>> 11) % SHIRT.length],
    K: INK,
    M: "#b0503a",
    P: "#f0a0a0",
    T: "#e8c35a",
  };
  const bg = BG[(h >>> 15) % BG.length];
  const s = scale * 8;
  return (
    <span className={className} style={{ display: "inline-flex", width: s + scale * 2, height: s + scale * 2, background: bg, alignItems: "center", justifyContent: "center", boxShadow: `inset 0 0 0 ${Math.max(1, scale / 1.5)}px rgb(59 36 20 / .55)`, flexShrink: 0 }}>
      <Grid rows={rows} palette={palette} scale={scale} title={title} />
    </span>
  );
}

/** Lifecycle step number → sprite, so every page header gets its own icon. */
export const STEP_SPRITES: Record<string, SpriteName> = {
  "01": "seeds",
  "02": "letter",
  "03": "scroll",
  "04": "star",
  "05": "magnifier",
  "06": "chart",
  "07": "signpost",
  "08": "coin",
  "09": "wheat",
};
