/** A minimum-priority queue (binary heap) of node numbers, ordered by a priority that can be a float. */
export class MinHeap {
  private nodes: number[] = [];
  private priorities: number[] = [];

  get size() {
    return this.nodes.length;
  }

  push(node: number, priority: number) {
    let i = this.nodes.length;
    this.nodes.push(node);
    this.priorities.push(priority);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent]! <= priority) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Removes and returns the node with the smallest priority. */
  pop(): number | undefined {
    if (this.nodes.length === 0) return undefined;
    const top = this.nodes[0]!;
    const lastNode = this.nodes.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.nodes.length && this.priorities[left]! < this.priorities[smallest]!) smallest = left;
        if (right < this.nodes.length && this.priorities[right]! < this.priorities[smallest]!) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b]!, this.nodes[a]!];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b]!, this.priorities[a]!];
  }
}
