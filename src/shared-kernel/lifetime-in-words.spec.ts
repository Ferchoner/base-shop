import { lifetimeInWords } from './lifetime-in-words.js';

describe('lifetimeInWords', () => {
  it.each([
    [86_400, '24 horas'],
    [3_600, '1 hora'],
    [1_800, '30 minutos'],
    [5_400, '90 minutos'],
    [60, '1 minuto'],
  ])('says %i seconds as %s', (seconds, words) => {
    expect(lifetimeInWords(seconds)).toBe(words);
  });
});
