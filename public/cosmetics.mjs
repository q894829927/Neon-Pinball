/** v0.11.0 visual-only effects: no game physics, RNG or credit logic. */
export const MARBLE_LOOKS=Object.freeze({
  steel:{halo:"#8ac5e6",light:"#ffffff",mid:"#91b4c7",dark:"#3a526a"},
  pearl:{halo:"#ffecde",light:"#fffefa",mid:"#d9d8df",dark:"#8b91a8"},
  ember:{halo:"#ffc77c",light:"#fff6cd",mid:"#e4a360",dark:"#8c483d"},
  nebula:{halo:"#c6a7ff",light:"#eef0ff",mid:"#8c8be0",dark:"#443c9a"},
});
export const TRAIL_LOOKS=Object.freeze({
  standard:{color:"#81ddec",secondary:"#81ddec",width:1,glow:0},
  comet:{color:"#ffca79",secondary:"#ff9250",width:1.20,glow:6},
  frost:{color:"#9fe9ff",secondary:"#65bdfa",width:1.15,glow:9},
  prism:{color:"#f7a6f8",secondary:"#9b8cff",width:1.35,glow:10},
});
export function marbleLook(id){return MARBLE_LOOKS[id]??MARBLE_LOOKS.steel;}
export function trailLook(id){return TRAIL_LOOKS[id]??TRAIL_LOOKS.standard;}
