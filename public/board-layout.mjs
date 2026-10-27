/**
 * One authoritative peg grid shared by drawing and collision handling.
 * Each bumper occupies EXACTLY one former peg cell, never a free-floating
 * location between two existing pins. Adjacent steel pegs are left in place.
 */
export const PEG_GRID = Object.freeze({
  rows: 10, columns: 8, left: 48, top: 184,
  horizontalSpacing: 39, verticalSpacing: 42,
  oddRowOffset: 18.5, pegRadius: 5.9,
});
export const BUMPER_CELLS = Object.freeze([
  Object.freeze({row: 3, col: 2}), // upper left
  Object.freeze({row: 5, col: 5}), // middle right
  Object.freeze({row: 7, col: 3}), // lower centre
]);

export function pegPosition(row, col) {
  if (!Number.isInteger(row) || row < 0 || row >= PEG_GRID.rows ||
      !Number.isInteger(col) || col < 0 || col >= PEG_GRID.columns) {
    throw new Error("Peg cell out of range");
  }
  return {
    x: PEG_GRID.left + col * PEG_GRID.horizontalSpacing +
      (row % 2) * PEG_GRID.oddRowOffset,
    y: PEG_GRID.top + row * PEG_GRID.verticalSpacing,
  };
}

/** Every active physical obstacle exists at one original grid position. */
export function createPegLayout(rightWall = 368) {
  const selected = new Set(BUMPER_CELLS.map(({row,col}) => row+","+col));
  const pegs = [], bumpers = [];
  for (let row = 0; row < PEG_GRID.rows; row++) {
    for (let col = 0; col < PEG_GRID.columns; col++) {
      const {x,y} = pegPosition(row,col);
      if (x >= rightWall - 12) continue;
      const cell = {row,col,x,y};
      if (selected.has(row+","+col)) {
        bumpers.push({...cell, r:15});
      } else {
        pegs.push({...cell, r:PEG_GRID.pegRadius});
      }
    }
  }
  if (bumpers.length !== BUMPER_CELLS.length) {
    throw new Error("A bumper is outside the peg field");
  }
  return {pegs,bumpers};
}
