import { MalformedCsvError, parseCsv } from './csv.js';

const fieldsOf = (text: string) => parseCsv(text).map(({ fields }) => fields);

describe('parseCsv (RFC 4180)', () => {
  it('keeps commas, doubled quotes and line breaks inside quoted fields', () => {
    expect(fieldsOf('a,"b, c","say ""hi""","x\ny"\n1,2,3,4')).toEqual([
      ['a', 'b, c', 'say "hi"', 'x\ny'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('accepts LF and CRLF, empty fields and a last line without a line end', () => {
    expect(fieldsOf('a,,c\r\n\r\nd,e,\nf,g,h')).toEqual([
      ['a', '', 'c'],
      ['d', 'e', ''],
      ['f', 'g', 'h'],
    ]);
  });

  it('keeps a CRLF inside a quoted field', () => {
    expect(fieldsOf('"x\r\ny",z\r\n')).toEqual([['x\r\ny', 'z']]);
  });

  it('tells the line where each record begins, counting empty lines and line breaks inside quotes', () => {
    expect(
      parseCsv('sku,amount\r\n\r\nA,"1\r\n2"\r\nB,3\n\n\nC,4').map(
        ({ line }) => line,
      ),
    ).toEqual([1, 3, 5, 8]);
  });

  it('rejects a file that ends inside a quoted field', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(MalformedCsvError);
  });
});
