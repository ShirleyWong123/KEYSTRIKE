export const accuracy = (correct: number, wrong: number): number => {
  const total = correct + wrong;
  return total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
};

export const wpm = (correct: number, activeMs: number): number =>
  activeMs <= 0 ? 0 : Math.round(((correct / 5) / (activeMs / 60_000)) * 10) / 10;
