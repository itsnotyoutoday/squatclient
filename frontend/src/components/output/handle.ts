/** Imperative handle the foreground output pane registers so keys/search can drive it. */
export interface OutputHandle {
  pageUp(): void;
  pageDown(): void;
  jumpLive(): void;
  /** Ensure `seq` is loaded (fetching older history if needed) and scroll it into view. */
  scrollToSeq(seq: number): Promise<void>;
}

let current: OutputHandle | null = null;
export const registerOutput = (h: OutputHandle | null): void => {
  current = h;
};
export const getOutput = (): OutputHandle | null => current;
