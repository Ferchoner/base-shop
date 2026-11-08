import { suggestCountClasses } from './count-class.js';

describe('suggestCountClasses (ADR-0173)', () => {
  const classes = (sales: [string, number][]) =>
    suggestCountClasses(
      sales.map(([productId, amount]) => ({ productId, amount })),
    ).map(({ productId, suggestedClass }) => `${productId}:${suggestedClass}`);

  it('gives A to the products of the first 80 % of the sales, B to the next 15 % and C to the rest', () => {
    // 1,000 in all: 500 + 250 reach 75 %, so the 100 that pass 80 % are still A; B while what came before is under
    // 95 %, and C from there.
    expect(
      classes([
        ['e', 30],
        ['a', 500],
        ['c', 100],
        ['b', 250],
        ['d', 70],
        ['f', 30],
        ['g', 20],
      ]),
    ).toEqual(['a:A', 'b:A', 'c:A', 'd:B', 'e:B', 'f:C', 'g:C']);
  });

  it('starts B and C exactly at 80 % and 95 %', () => {
    expect(
      classes([
        ['a', 80],
        ['b', 15],
        ['c', 5],
      ]),
    ).toEqual(['a:A', 'b:B', 'c:C']);
  });

  it('breaks a tie by product ID, and leaves out what sold nothing', () => {
    expect(
      classes([
        ['z', 50],
        ['m', 50],
        ['x', 0],
      ]),
    ).toEqual(['m:A', 'z:A']);
    expect(classes([])).toEqual([]);
  });

  it('gives A to a single product', () => {
    expect(classes([['solo', 1]])).toEqual(['solo:A']);
  });
});
