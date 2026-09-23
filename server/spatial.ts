import type { Point } from '../shared/protocol.js';
export class SpatialHash<T extends Point> {
  private cells = new Map<string, Set<T>>();
  constructor(private size = 64) {}
  private key(x: number, y: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
  }
  add(item: T) {
    const key = this.key(item.x, item.y);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = new Set()));
    cell.add(item);
  }
  remove(item: T) {
    const key = this.key(item.x, item.y);
    const cell = this.cells.get(key);
    cell?.delete(item);
    if (!cell?.size) this.cells.delete(key);
  }
  clear() {
    this.cells.clear();
  }
  near(x: number, y: number, radius: number): T[] {
    const result: T[] = [];
    for (
      let i = Math.floor((x - radius) / this.size);
      i <= Math.floor((x + radius) / this.size);
      i++
    )
      for (
        let j = Math.floor((y - radius) / this.size);
        j <= Math.floor((y + radius) / this.size);
        j++
      ) {
        const cell = this.cells.get(`${i},${j}`);
        if (cell)
          for (const item of cell)
            if ((item.x - x) ** 2 + (item.y - y) ** 2 <= radius ** 2) result.push(item);
      }
    return result;
  }
}
